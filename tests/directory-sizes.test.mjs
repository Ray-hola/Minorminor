import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, realpath, writeFile, lstat, rm, link, symlink, chmod } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { measureDirectorySizes, createDirectorySizeScanner } from '../lib/directory-sizes.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-folder-size-'))), root = path.join(home, 'project');
  await mkdir(root); t.after(() => rm(home, { recursive: true, force: true }));
  const put = async (name, contents) => { const filename = path.join(root, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, contents); return filename; };
  return { home, root, put };
}
async function waitFor(scanner, root, desired = 'complete') {
  for (let i = 0; i < 500; i++) { const state = scanner.status(root); if (state.status === desired) return state; if (state.status === 'failed') throw new Error(state.error); await delay(10); }
  throw new Error('Folder worker timed out');
}

test('recursive directory sizes include hidden, dependency, backup and protected files using real allocation and logical length', async t => {
  const f = await fixture(t);
  const files = [await f.put('tiny.txt', 'abc'), await f.put('sub/deeper/big.dat', Buffer.alloc(128000, 65)), await f.put('.hidden/.env', 'TOKEN=never-read'), await f.put('node_modules/lib/source.js', 'code'), await f.put('.private-backups/old.db', 'database bytes')];
  const result = await measureDirectorySizes(f), root = result.rows.find(r => r.path === f.root);
  const infos = await Promise.all(files.map(file => lstat(file)));
  assert.equal(root.bytes, infos.reduce((sum, info) => sum + info.blocks * 512, 0));
  assert.equal(root.logicalBytes, infos.reduce((sum, info) => sum + info.size, 0));
  assert.equal(root.files, 5); assert.equal(root.directories, 6); assert.equal(root.skipped, 0);
  assert.equal(result.rows.find(r => r.path === path.join(f.root, 'sub')).files, 1);
  assert.equal(result.rows.find(r => r.path === path.join(f.root, '.hidden')).logicalBytes, 'TOKEN=never-read'.length);
  assert.ok(!JSON.stringify(result).includes('TOKEN=never-read'));
  assert.equal(result.stats.bytes, root.bytes);
});

test('hard links are deduplicated within each subtree; sibling sizes are independent and links outside the root are never followed', async t => {
  const f = await fixture(t), file = await f.put('a/shared.bin', Buffer.alloc(10000, 5));
  await mkdir(path.join(f.root, 'b')); await link(file, path.join(f.root, 'b/shared.bin')); await link(file, path.join(f.root, 'a/again.bin'));
  await writeFile(path.join(f.home, 'outside.bin'), Buffer.alloc(1000000));
  await symlink(f.home, path.join(f.root, 'outside')); await symlink(f.root, path.join(f.root, 'a/loop'));
  const result = await measureDirectorySizes(f), get = name => result.rows.find(r => r.path === path.join(f.root, name)), allocated = (await lstat(file)).blocks * 512;
  assert.equal(get('').bytes, allocated); assert.equal(get('a').bytes, allocated); assert.equal(get('b').bytes, allocated);
  assert.equal(get('').logicalBytes, 10000); assert.equal(get('').files, 3); assert.equal(get('a').files, 2);
  assert.equal(get('').sharedFiles, 3); assert.equal(get('').links, 2); assert.equal(get('').skipped, 0);
  assert.equal(result.stats.bytes, allocated); assert.equal(result.rows.length, 3);
});

test('complete traversal has no file/depth cutoff and reports progress; cancellation never returns an incomplete zero-sized result', async t => {
  const f = await fixture(t); let directory = '';
  for (let i = 0; i < 35; i++) { directory = path.join(directory, 'deep'); await f.put(path.join(directory, 'value'), 'x'); }
  await mkdir(path.join(f.root, 'empty'));
  let progress;
  const result = await measureDirectorySizes({ ...f, onProgress: value => { progress = value; } });
  assert.equal(result.stats.files, 35); assert.equal(result.rows.length, 37); assert.equal(progress.files, 35);
  assert.equal(result.rows.find(r => r.path.endsWith('/empty')).bytes, 0);
  let stop = false;
  await assert.rejects(measureDirectorySizes({ ...f, cancelled: () => stop, onProgress: () => { stop = true; } }), /停止/);
  await assert.rejects(measureDirectorySizes({ ...f, root: f.home }), /范围/);
  await assert.rejects(measureDirectorySizes({ ...f, root: path.join(f.root, '..') }), /范围/);
  await symlink(f.root, path.join(f.home, 'alias'));
  await assert.rejects(measureDirectorySizes({ ...f, root: path.join(f.home, 'alias') }), /符号链接/);
});

test('unreadable descendants mark ancestor sizes as partial and keep precise errors instead of presenting zero as complete', { skip: process.getuid?.() === 0 }, async t => {
  const f = await fixture(t); await f.put('blocked/file.bin', 'unreadable'); await f.put('ok.txt', 'ok');
  const blocked = path.join(f.root, 'blocked'); await chmod(blocked, 0);
  try {
    const result = await measureDirectorySizes(f), root = result.rows.find(r => r.path === f.root);
    assert.ok(root.skipped > 0); assert.ok(result.rows.find(r => r.path === blocked).skipped > 0);
    assert.equal(root.files, 1); assert.ok(result.errors.some(e => e.code === 'EACCES' || e.code === 'EPERM'));
  } finally { await chmod(blocked, 0o700); }
});

test('background scanner reuses one job across reloads, caches every nested directory, and explicitly refreshes later changes', async t => {
  const f = await fixture(t); await f.put('nested/file.bin', Buffer.alloc(5000));
  const scanner = createDirectorySizeScanner(f); t.after(() => scanner.dispose());
  const first = scanner.start(f.root); assert.equal(scanner.start(f.root).id, first.id);
  const complete = await waitFor(scanner, f.root); assert.equal(complete.stats.files, 1);
  const dir = path.join(f.root, 'nested'), info = await lstat(dir), cached = scanner.result(f.root, dir, info);
  assert.equal(cached.files, 1); assert.equal(cached.status, 'complete');
  await f.put('nested/new.bin', 'new file'); assert.equal(scanner.start(f.root).id, first.id);
  const refresh = scanner.start(f.root, true); assert.notEqual(refresh.id, first.id);
  assert.equal((await waitFor(scanner, f.root)).stats.files, 2);
  assert.equal(scanner.result(f.root, dir, { ...info, ino: -1 }), null);
});

test('queued/background statistics can be cancelled and disposed without publishing partial directory totals', async t => {
  const f = await fixture(t); await f.put('file.txt', 'test');
  const scanner = createDirectorySizeScanner(f); t.after(() => scanner.dispose());
  scanner.start(f.root); scanner.cancel(f.root);
  await waitFor(scanner, f.root, 'cancelled');
  assert.equal(scanner.result(f.root, f.root, await lstat(f.root)), null);
  scanner.start(f.root, true); assert.equal((await waitFor(scanner, f.root)).stats.files, 1);
  scanner.dispose(); assert.throws(() => scanner.start(f.root), /过期/);
});
