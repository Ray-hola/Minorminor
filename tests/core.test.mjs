import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath, readdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan, measure, eligible, publicScan } from '../lib/scanner.mjs';
import { moveToTrash, validateCandidate } from '../lib/cleanup.mjs';
import { cleanTerminal, runPreview } from '../lib/mole.mjs';
import { createApp } from '../server.mjs';
import { request } from 'node:http';

const DAY = 86_400_000;
async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minorminor-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const dir of ['Library/Caches', 'Library/Logs', 'Downloads', '.Trash']) await mkdir(path.join(home, dir), { recursive: true });
  return home;
}
async function candidate(home, relative, category) {
  const fullPath = path.join(home, relative);
  await writeFile(fullPath, 'fixture data');
  const info = await lstat(fullPath);
  return { id: 'fixture', category, name: path.basename(fullPath), path: fullPath, dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, bytes: info.blocks * 512, root: await realpath(path.dirname(fullPath)) };
}
function future(t) { const now = Date.now() + 20 * DAY; t.mock.method(Date, 'now', () => now); return new Date(now).toISOString(); }

test('eligibility keeps recent files, archives, directories and caches out of the move plan', () => {
  const now = Date.now();
  const info = { isFile: () => true, isSymbolicLink: () => false, size: 100, mtimeMs: now - 21 * DAY, ctimeMs: now - 21 * DAY };
  assert.equal(eligible('logs', 'old.log.gz', info, now), true);
  assert.equal(eligible('installers', 'old.dmg', info, now), true);
  assert.equal(eligible('installers', 'photos.zip', info, now), false);
  assert.equal(eligible('logs', 'database.sqlite', info, now), false);
  assert.equal(eligible('cache', 'old.log', info, now), false);
  assert.equal(eligible('logs', 'new.log', { ...info, ctimeMs: now }, now), false);
  assert.equal(eligible('logs', 'old.log', { ...info, isSymbolicLink: () => true }, now), false);
  assert.equal(eligible('installers', 'bundle.pkg', { ...info, isFile: () => false }, now), false);
});

test('scanner ignores symlink targets while fully traversing the allowed tree', async t => {
  const home = await fixture(t);
  await writeFile(path.join(home, 'Downloads', 'visible'), 'sample');
  await symlink(path.join(home, 'Downloads'), path.join(home, 'Library/Caches', 'linked'));
  const result = await measure(path.join(home, 'Library/Caches'));
  assert.equal(result.count, 0);
  const complete = await measure(home);
  assert.equal(complete.partial, false);
  assert.equal(complete.count, 1);
  assert.equal(complete.symlinks, 1);
});

test('scan offers only eligible direct files; public responses omit inode identities', async t => {
  const home = await fixture(t);
  await candidate(home, 'Downloads/old.dmg', 'installers');
  await candidate(home, 'Library/Logs/old.log', 'logs');
  await writeFile(path.join(home, 'Downloads', 'personal.zip'), 'keep');
  await mkdir(path.join(home, 'Downloads', 'directory.pkg'));
  future(t);
  const result = await scan(home);
  assert.equal(result.items.length, 2);
  assert.deepEqual(new Set(result.items.map(item => item.name)), new Set(['old.dmg', 'old.log']));
  assert.equal(publicScan(result).items.some(item => 'ino' in item || 'root' in item), false);
});

test('a symlinked scan root cannot enumerate candidates outside the allowed directory', async t => {
  const home = await fixture(t);
  await mkdir(path.join(home, 'elsewhere'));
  await writeFile(path.join(home, 'elsewhere', 'outside.dmg'), 'keep');
  await rm(path.join(home, 'Downloads'), { recursive: true });
  await symlink(path.join(home, 'elsewhere'), path.join(home, 'Downloads'));
  future(t);
  const result = await scan(home);
  assert.equal(result.categories.find(item => item.id === 'installers').available, false);
  assert.equal(result.items.length, 0);
  assert.equal((await measure(path.join(home, 'Downloads'))).count, 0);
});

test('explicit selection moves one file to Trash and leaves all other files intact', async t => {
  const home = await fixture(t);
  const item = await candidate(home, 'Downloads/old.dmg', 'installers');
  await writeFile(path.join(home, 'Downloads', 'keep.pkg'), 'keep');
  const createdAt = future(t);
  const result = await moveToTrash({ createdAt, items: [item] }, [item.id], home);
  assert.equal(result.moved, 1);
  assert.equal(result.results[0].originalPath, item.path);
  assert.equal(await readFile(result.results[0].trashPath, 'utf8'), 'fixture data');
  assert.equal(await readFile(path.join(home, 'Downloads', 'keep.pkg'), 'utf8'), 'keep');
  await assert.rejects(readFile(item.path), { code: 'ENOENT' });
});

test('cleanup rejects expired and forged selections without touching files', async t => {
  const home = await fixture(t);
  const item = await candidate(home, 'Downloads/old.dmg', 'installers');
  const createdAt = future(t);
  await assert.rejects(moveToTrash({ createdAt: new Date(0).toISOString(), items: [item] }, [item.id], home), /过期/);
  await assert.rejects(moveToTrash({ createdAt, items: [item] }, ['forged'], home), /不属于/);
  await assert.rejects(moveToTrash({ createdAt, items: [item] }, [item.id, item.id], home), /有效/);
  assert.equal(await readFile(item.path, 'utf8'), 'fixture data');
  assert.deepEqual(await readdir(path.join(home, '.Trash')), []);
});

test('replaced or changed candidates are retained, including symlink substitutions', async t => {
  const home = await fixture(t);
  const item = await candidate(home, 'Downloads/old.dmg', 'installers');
  const createdAt = future(t);
  await writeFile(item.path, 'changed content');
  await assert.rejects(validateCandidate(item, home), /已变化/);
  await rm(item.path);
  const target = path.join(home, 'important');
  await writeFile(target, 'do not touch');
  await symlink(target, item.path);
  const result = await moveToTrash({ createdAt, items: [item] }, [item.id], home);
  assert.equal(result.moved, 0);
  assert.equal(await readFile(target, 'utf8'), 'do not touch');
  assert.deepEqual(await readdir(path.join(home, '.Trash')), []);
});

test('cleanup refuses a symlinked root or Trash destination', async t => {
  const home = await fixture(t);
  const item = await candidate(home, 'Downloads/old.dmg', 'installers');
  const createdAt = future(t);
  await rm(path.join(home, '.Trash'), { recursive: true });
  await symlink(path.join(home, 'Library/Caches'), path.join(home, '.Trash'));
  await assert.rejects(moveToTrash({ createdAt, items: [item] }, [item.id], home), /废纸篓/);
  assert.equal(await readFile(item.path, 'utf8'), 'fixture data');
});

test('terminal output drops ANSI/OSC controls and rejects arbitrary commands', () => {
  assert.equal(cleanTerminal('\u001b[31mhello\u001b[0m\rworld\u001b]0;evil\u0007'), 'hello\nworld');
  assert.throws(() => runPreview('clean; touch /tmp/unsafe', () => {}, () => {}), /不支持/);
  assert.throws(() => runPreview('remove', () => {}, () => {}), /不支持/);
});

test('HTTP API enforces host, origin, token, command allowlist and single-flight execution', async t => {
  const home = await fixture(t);
  let finish, cancelled = false, calls = 0;
  const server = createApp({ home, previewRunner: (command, output, done) => { calls++; finish = done; output('real-time output'); return { cancel: () => { cancelled = true; done({ code: null, error: 'cancelled' }); } }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const boot = await (await fetch(`${base}/api/bootstrap`)).json();
  const post = (endpoint, body, extra = {}) => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token, ...extra }, body: JSON.stringify(body) });
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/bootstrap`, { headers: { Host: 'malicious.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await post('scan', {}, { Origin: 'https://malicious.example' })).status, 403);
  assert.equal((await post('scan', {}, { 'X-Minorminor-Token': 'wrong' })).status, 403);
  assert.equal((await post('mole', { command: 'remove' })).status, 400);
  assert.equal(calls, 0);
  const response = await post('mole', { command: 'clean' });
  assert.equal(response.status, 202);
  assert.equal(calls, 1);
  const { id } = await response.json();
  assert.equal((await post('mole', { command: 'optimize' })).status, 409);
  const job = await (await fetch(`${base}/api/jobs/${id}`)).json();
  assert.equal(job.output, 'real-time output');
  assert.equal(job.cancel, undefined);
  assert.equal((await post('cancel', { id })).status, 200);
  assert.equal(cancelled, true);
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/vendor/mole/LICENSE`)).status, 404);
  finish({ code: 0 });
});
