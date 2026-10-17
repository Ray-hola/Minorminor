import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm, chmod, link, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { measure, inventory } from '../lib/scanner.mjs';
import { runBackgroundScan } from '../lib/background-scan.mjs';
import { moveToTrash } from '../lib/cleanup.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minorminor-full-scan-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const runtimeDirectory = path.join(root, 'runtime');
  await mkdir(home);
  return { home, runtimeDirectory, root };
}
const homeScope = home => ({ id: 'home', label: '整个用户目录', path: home, displayPath: home, stayOnDevice: true });
async function serverFixture(t, home, runtimeDirectory) {
  const server = createApp({ home, runtimeDirectory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const boot = await (await fetch(base + '/api/bootstrap')).json();
  const post = (endpoint, body) => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify(body) });
  return { base, post };
}
async function waitJob(base, id) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (job.status !== 'running') return job;
    await delay(15);
  }
  throw new Error('Fixture scan did not finish');
}

test('complete scan passes the old 60,000-entry cap and 24-level depth cap', async t => {
  const { home } = await fixture(t);
  const flat = path.join(home, '.hidden');
  await mkdir(flat);
  const total = 60_025;
  for (let index = 0; index < total; index += 128) await Promise.all(Array.from({ length: Math.min(128, total - index) }, (_, offset) => writeFile(path.join(flat, String(index + offset)), '')));
  let deep = home;
  for (let level = 0; level < 32; level++) { deep = path.join(deep, 'nested'); await mkdir(deep); }
  await writeFile(path.join(deep, 'deepest.txt'), 'deep file');
  const result = await measure(home);
  assert.equal(result.count, total + 1);
  assert.equal(result.partial, false);
  assert.equal(result.cancelled, false);
  assert.ok(result.directories >= 34);
});

test('elapsed time does not truncate traversal', async t => {
  const { home } = await fixture(t);
  for (let index = 0; index < 20; index++) await writeFile(path.join(home, `${index}.txt`), 'sample');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const result = await measure(home, { onEntry: () => { now += 60_000; } });
  assert.equal(result.count, 20);
  assert.equal(result.partial, false);
  assert.ok(result.elapsedMs > 20_000);
});

test('inventory includes hidden and previously unlisted directories, with exact top-level totals', async t => {
  const { home } = await fixture(t);
  for (const name of ['.config', 'custom-folder', 'Library/Application Support']) {
    await mkdir(path.join(home, name), { recursive: true });
    await writeFile(path.join(home, name, 'state.bin'), 'sample data');
  }
  const result = await inventory(home);
  assert.equal(result.scan.count, 3);
  assert.deepEqual(new Set(result.analysis.rows.map(row => row.id)), new Set(['.config', 'custom-folder', 'Library']));
  assert.equal(result.analysis.rows.reduce((sum, row) => sum + row.bytes, 0), result.scan.totalBytes);
  assert.equal(result.scan.complete, true);
  assert.ok(result.analysis.rows.every(row => row.status === 'complete'));
});

test('data-volume paths map to logical Mac paths without broadening cleanup candidates', async t => {
  const { root } = await fixture(t);
  const data = path.join(root, 'Data');
  const logicalHome = '/Users/minorminor-fixture';
  await mkdir(path.join(data, logicalHome, 'Downloads'), { recursive: true });
  await writeFile(path.join(data, logicalHome, 'Downloads', 'old.dmg'), 'fixture');
  const now = Date.now() + 20 * 86_400_000;
  t.mock.method(Date, 'now', () => now);
  const result = await inventory(logicalHome, { scope: { id: 'disk', label: '数据卷', path: data, displayPath: '/', stayOnDevice: true } });
  assert.equal(result.scan.items.length, 1);
  assert.equal(result.scan.items[0].path, logicalHome + '/Downloads/old.dmg');
  assert.equal(result.analysis.rows[0].path, '/Users');
});

test('hardlinks do not inflate allocated-byte totals', async t => {
  const { home } = await fixture(t);
  const original = path.join(home, 'file.bin');
  await writeFile(original, 'sample data');
  await link(original, path.join(home, 'second-name.bin'));
  const result = await measure(home);
  assert.equal(result.count, 2);
  assert.equal(result.bytes, (await lstat(original)).blocks * 512);
});

test('cancellation returns partial statistics and cannot authorize cleanup', async t => {
  const { home } = await fixture(t);
  for (let index = 0; index < 100; index++) await writeFile(path.join(home, `${index}.txt`), 'fixture');
  const controller = new AbortController();
  const measured = await measure(home, { signal: controller.signal, onEntry: (_target, info) => { if (info.isFile()) controller.abort(); } });
  assert.ok(measured.count > 0 && measured.count < 100);
  const result = await inventory(home, { signal: controller.signal });
  assert.equal(result.scan.complete, false);
  assert.equal(result.scan.cancelled, true);
  assert.ok(result.scan.count < 100);
  await assert.rejects(moveToTrash(result.scan, ['anything'], home), /取消/);
});

test('missing paths retain precise error codes and reasons', async t => {
  const { home } = await fixture(t);
  const errors = [];
  const result = await measure(path.join(home, 'missing'), { onError: error => errors.push(error) });
  assert.equal(result.skipped, 1);
  assert.equal(result.available, false);
  assert.equal(errors[0].code, 'ENOENT');
  assert.match(errors[0].reason, /不存在/);
});

test('background worker can be cancelled immediately and reports completion once', async t => {
  const { home, runtimeDirectory } = await fixture(t);
  let doneCount = 0;
  const result = await new Promise(resolve => {
    const runner = runBackgroundScan({ home, scope: homeScope(home), runtimeDirectory, jobId: randomUUID(), onProgress: () => {}, onDone: result => { doneCount++; resolve(result); } });
    runner.cancel();
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.result.scan.complete, false);
  await delay(30);
  assert.equal(doneCount, 1);
});

test('HTTP background scan survives page reconnection, serves requests and updates both views', async t => {
  const { home, runtimeDirectory } = await fixture(t);
  await mkdir(path.join(home, '.custom'));
  await writeFile(path.join(home, '.custom', 'hidden.txt'), 'fixture');
  const { base, post } = await serverFixture(t, home, runtimeDirectory);
  assert.equal((await post('scan', { scope: 'arbitrary-path' })).status, 400);
  const response = await post('analyze', { scope: 'home' });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const reconnect = await (await fetch(base + '/api/bootstrap')).json();
  assert.equal(reconnect.jobs.filter(job => job.id === id).length, 1);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  const job = await waitJob(base, id);
  assert.equal(job.status, 'complete', job.error);
  assert.equal(job.result.count, 1);
  const bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  assert.equal(bootstrap.scan.count, 1);
  assert.equal(bootstrap.analysis.rows[0].id, '.custom');
  assert.equal(bootstrap.scan.scope.id, 'home');
  assert.equal(bootstrap.jobs[0].errorLog, undefined);
});

test('every unreadable path is logged and diagnostics paginate beyond the sample window', { skip: process.getuid?.() === 0 }, async t => {
  const { home, runtimeDirectory } = await fixture(t);
  const dirs = Array.from({ length: 205 }, (_, index) => path.join(home, `blocked-${index}`));
  await Promise.all(dirs.map(async directory => { await mkdir(directory); await chmod(directory, 0); }));
  try {
    const { base, post } = await serverFixture(t, home, runtimeDirectory);
    const { id } = await (await post('scan', { scope: 'home' })).json();
    const job = await waitJob(base, id);
    assert.equal(job.status, 'complete', job.error);
    assert.equal(job.result.errorCount, 205);
    assert.equal(job.result.errors.length, 100);
    const pages = [];
    for (const offset of [0, 100, 200]) pages.push(await (await fetch(`${base}/api/jobs/${id}/errors?offset=${offset}`)).json());
    assert.deepEqual(pages.map(page => page.errors.length), [100, 100, 5]);
    assert.equal(new Set(pages.flatMap(page => page.errors.map(error => error.path))).size, 205);
    assert.equal(pages[2].hasMore, false);
    assert.ok(pages[0].errors.every(error => ['EACCES', 'EPERM'].includes(error.code)));
  } finally { await Promise.all(dirs.map(directory => chmod(directory, 0o700))); }
});
