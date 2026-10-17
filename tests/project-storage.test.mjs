import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, realpath, mkdir, writeFile, readFile, utimes, lstat, readdir, link, symlink, rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { measureProjectStorage, projectFileKind, projectFileBlock, publicProjectStorage, publicProjectFiles, projectStorageCsv, buildProjectTrashPlan, publicProjectPlan, selectProjectGroups, executeProjectTrashPlan, runProjectStorage } from '../lib/project-storage.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-project-storage-'))); t.after(() => rm(home, { recursive: true, force: true }));
  const old = new Date(Date.now() - 3 * 86400_000), put = async (relative, text = 'fixture') => { const filename = path.join(home, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, text); await utimes(filename, old, old); return filename; };
  const root = path.join(home, 'Desktop/alpha'), child = path.join(root, 'nested');
  const cache = await put('Desktop/alpha/.cache/old.bin'), log = await put('Desktop/alpha/logs/debug.log');
  await put('Desktop/alpha/source.js'); await put('Desktop/alpha/.git/logs/HEAD'); await put('Desktop/alpha/node_modules/pkg/.cache/vendor.bin'); await put('Desktop/alpha/.private-backups/evidence.log'); await put('Desktop/alpha/.cache/auth.json'); await put('Desktop/alpha/.cache/state.db');
  const recent = await put('Desktop/alpha/.cache/recent.bin'); await utimes(recent, new Date(), new Date());
  await put('Desktop/alpha/nested/.cache/child.bin');
  const session = await put('.claude/projects/alpha/session.jsonl'), memory = await put('.claude/projects/alpha/memory/MEMORY.md');
  const managed = await put('.codex/sessions/managed.jsonl'), db = await put('.codex/state_5.sqlite');
  const report = { id: 'report', snapshotId: 'snapshot', complete: true, scopes: [], unassigned: [], errors: [], coverage: {}, groups: [{ id: 'alpha', name: 'alpha', path: root, exists: true, type: 'project', assets: [{ kind: 'session', sourcePath: session }, { kind: 'memory', sourcePath: memory }, { kind: 'session', sourcePath: db, physicalPath: managed, recordId: 'indexed', agent: 'Codex' }] }, { id: 'nested', name: 'nested', path: child, exists: true, type: 'project', assets: [] }, { id: 'broad', name: 'Desktop', path: path.join(home, 'Desktop'), exists: true, type: 'workspace', assets: [] }] };
  return { home, report, root, child, cache, log, recent, session, memory, managed, put };
}

test('complete metadata measurement splits nested projects, external sessions/memory, shared SQLite and protected code without duplicate totals', async t => {
  const f = await fixture(t), storage = await measureProjectStorage(f), stats = storage.groups.find(row => row.projectId === 'alpha');
  const bytes = async filename => (await lstat(filename)).blocks * 512;
  assert.equal(stats.categories.cache.files, 2); assert.equal(stats.categories.cache.candidateFiles, 1);
  assert.equal(stats.categories.log.files, 1); assert.equal(stats.categories.session.files, 2); assert.equal(stats.categories.memory.files, 1);
  assert.equal(stats.databaseRecords, 1); assert.equal(storage.shared.length, 1); assert.equal(storage.shared[0].bytes, await bytes(path.join(f.home, '.codex/state_5.sqlite')));
  assert.equal(stats.totalBytes, Object.values(stats.categories).reduce((n, row) => n + row.bytes, 0));
  assert.equal(stats.categories.log.bytes, await bytes(f.log));
  assert.equal(storage.groups.find(row => row.projectId === 'nested').categories.cache.files, 1);
  assert.equal(storage.groups.find(row => row.projectId === 'broad').directoryStatus, 'workspace');
  assert.equal(storage.files.some(row => row.path.includes('node_modules') || row.path.includes('.private-backups')), false);
  assert.equal(storage.files.find(row => row.path === f.managed).blocked.includes('数据库'), true);
  assert.equal(publicProjectStorage(storage, f.report).files, undefined);
  const files = publicProjectFiles(storage, 'alpha', 'cache', 0); assert.equal(files.total, 2); assert.equal(files.rows[0].ino, undefined);
});

test('links, cross-project references and unknown/missing paths remain shared or unreadable; raw databases are not charged per record', async t => {
  const f = await fixture(t); await link(f.cache, path.join(f.child, 'hardlink.bin')); await symlink(f.root, path.join(f.child, 'loop'));
  f.report.groups[1].assets.push({ kind: 'memory', sourcePath: f.memory }, { kind: 'session', sourcePath: path.join(f.home, 'missing.jsonl') });
  const storage = await measureProjectStorage(f);
  assert.ok(storage.coverage.links > 0); assert.ok(storage.shared.some(row => row.kind === 'shared-file'));
  assert.equal(storage.files.some(row => row.path === f.memory || row.path === f.cache), false);
  assert.equal(storage.groups.find(row => row.projectId === 'nested').missingFiles, 1);
  assert.equal(publicProjectStorage(storage, { ...f.report, id: 'next' }).stale, true);
});

test('frozen preview requires valid project/category IDs and explicit personal-data scope; protected records never become selectable', async t => {
  const f = await fixture(t), storage = await measureProjectStorage(f);
  const input = { ...f, storage, projectIds: ['alpha'], categories: ['cache', 'log', 'session', 'memory'] };
  await assert.rejects(buildProjectTrashPlan(input), /单独开启/);
  const plan = await buildProjectTrashPlan({ ...input, allowPersonal: true });
  assert.equal(plan.groups.find(row => row.kind === 'session').nodes.length, 1);
  assert.equal(plan.groups.find(row => row.kind === 'session').retained.length, 1);
  assert.equal(plan.groups.find(row => row.kind === 'cache').retained.length, 1);
  assert.equal(publicProjectPlan(plan).groups[0].nodes, undefined); assert.equal(publicProjectPlan(plan).home, undefined);
  await assert.rejects(buildProjectTrashPlan({ ...input, projectIds: ['forged'], allowPersonal: true }), /项目/);
  await assert.rejects(buildProjectTrashPlan({ ...input, categories: ['other'], allowPersonal: true }), /类别/);
  assert.throws(() => selectProjectGroups(plan, ['forged']), /没有/);
  assert.throws(() => selectProjectGroups({ ...plan, usedBy: 'used' }, [plan.groups[0].id]), /过期/);
  assert.throws(() => selectProjectGroups({ ...plan, createdAt: new Date(0).toISOString() }, [plan.groups[0].id]), /过期/);
});

test('exact frozen files move to Trash with intent/final receipts; new and changed neighbours, managed sessions and code survive', async t => {
  const f = await fixture(t), storage = await measureProjectStorage(f), plan = await buildProjectTrashPlan({ ...f, storage, projectIds: ['alpha'], categories: ['cache', 'log', 'memory'], allowPersonal: true });
  const later = await f.put('Desktop/alpha/.cache/new-after-preview.bin');
  await writeFile(f.log, 'changed after preview');
  const records = [], selected = selectProjectGroups(plan, plan.groups.map(row => row.id));
  const result = await executeProjectTrashPlan(plan, selected, { guard: async () => {}, personalGuard: async () => {}, onRecord: async row => records.push(row) });
  assert.equal(result.moved, 2); assert.equal(result.skipped, 1);
  for (const row of records.filter(row => row.status === 'moved')) { assert.equal(await readFile(row.trashPath, 'utf8'), 'fixture'); await assert.rejects(lstat(row.originalPath)); }
  assert.equal(records.filter(row => row.status === 'moving').length, 2);
  assert.equal(await readFile(later, 'utf8'), 'fixture'); assert.equal(await readFile(f.log, 'utf8'), 'changed after preview');
  assert.equal(await readFile(f.managed, 'utf8'), 'fixture'); assert.equal(await readFile(path.join(f.root, 'source.js'), 'utf8'), 'fixture');
});

test('active file/owner-policy refusal, cancellation and Trash replacement preserve selected files', async t => {
  const f = await fixture(t), storage = await measureProjectStorage(f), plan = await buildProjectTrashPlan({ ...f, storage, projectIds: ['alpha'], categories: ['cache', 'memory'], allowPersonal: true });
  let result = await executeProjectTrashPlan(plan, plan.groups, { guard: async () => { throw new Error('owner busy'); }, personalGuard: async () => { throw new Error('file open'); } });
  assert.equal(result.moved, 0);
  result = await executeProjectTrashPlan(plan, plan.groups, { cancelled: () => true }); assert.equal(result.status, 'cancelled'); assert.equal(result.moved, 0);
  let swapped = false;
  const elsewhere = path.join(f.home, 'elsewhere'); await mkdir(elsewhere);
  result = await executeProjectTrashPlan(plan, plan.groups.filter(row => row.kind === 'cache'), { guard: async () => {}, onRecord: async row => { if (row.status === 'moving' && !swapped) { swapped = true; await rename(path.join(f.home, '.Trash'), path.join(f.home, '.Trash-original')); await symlink(elsewhere, path.join(f.home, '.Trash')); } } });
  assert.equal(result.moved, 0); assert.equal(await readFile(f.cache, 'utf8'), 'fixture'); assert.deepEqual(await readdir(elsewhere), []);
});

test('worker is cancellable and completes once, leaving the last completed snapshot available', async t => {
  const f = await fixture(t); let called = 0;
  await new Promise(resolve => { const runner = runProjectStorage({ ...f, onProgress() {}, onDone(value) { called++; assert.ok(value.cancelled || value.type === 'result'); resolve(); } }); runner.cancel(); });
  assert.equal(called, 1);
});

test('changed association evidence, models, credentials and stale snapshots cannot become project cleanup targets', async t => {
  const f = await fixture(t); f.report.createdAt = new Date(0).toISOString();
  await f.put('Desktop/alpha/.cache/models/weights.gguf'); await f.put('Desktop/alpha/.cache/codex-runtimes/node');
  const storage = await measureProjectStorage(f);
  assert.match(storage.files.find(row => row.path === f.memory).blocked, /归类后/);
  assert.equal(storage.files.some(row => /weights\.gguf|codex-runtimes/.test(row.path)), false);
  assert.equal(projectFileKind(path.join(f.root, '.cache/auth.json'), f.root).kind, 'other');
  assert.equal(projectFileKind(path.join(f.root, '.venv-repro/lib/pkg/__pycache__/code.pyc'), f.root).kind, 'other');
  assert.equal(publicProjectStorage(storage, f.report, { id: 'new-snapshot' }).stale, true);
  const csv = projectStorageCsv({ ...storage, groups: storage.groups.map(row => ({ ...row, name: '=untrusted-name' })) });
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=untrusted-name")); assert.ok(csv.includes('共享数据库索引数'));
});

test('HTTP project workflow survives reconnect, requires reviewed IDs and personal confirmation, consumes preview once and persists per-file destinations', async t => {
  const f = await fixture(t), runtimeDirectory = path.join(f.home, '.runtime'); await mkdir(runtimeDirectory);
  const snapshot = { id: 'snapshot', complete: true, items: [], discovery: { agents: [] } };
  await writeFile(path.join(runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, aiScan: snapshot, projectAnalysis: f.report }));
  let server;
  async function start() { server = createApp({ home: f.home, runtimeDirectory, persistState: true, selectionGuard: async () => {}, personalFileGuard: async () => {} }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
  let base = await start(); t.after(() => new Promise(resolve => server.close(resolve)));
  let boot = await (await fetch(base + '/api/bootstrap')).json(); assert.ok(boot.token, boot.error);
  const post = async (endpoint, body) => fetch(base + '/api/ai/projects/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify(body) });
  async function wait(response) { const { id } = await response.json(); assert.ok(id); for (let i = 0; i < 500; i++) { const j = await (await fetch(base + '/api/jobs/' + id)).json(); if (j.status !== 'running') { assert.equal(j.status, 'complete', j.error); return id; } await delay(10); } throw new Error('timeout'); }
  assert.equal((await post('storage', { reportId: 'forged' })).status, 400);
  await wait(await post('storage', { reportId: 'report' }));
  boot = await (await fetch(base + '/api/bootstrap')).json();
  const storageId = boot.ai.projectStorage.id; assert.ok(storageId); assert.equal(boot.ai.projectStorage.files, undefined);
  await wait(await post('plan', { storageId, projectIds: ['alpha'], categories: ['memory'], allowPersonal: true }));
  boot = await (await fetch(base + '/api/bootstrap')).json(); const plan = boot.ai.projectPlan, ids = plan.groups.filter(row => row.selectable).map(row => row.id);
  assert.equal((await post('execute', { planId: plan.id, groupIds: ids, confirmation: 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH' })).status, 400);
  assert.equal((await post('execute', { planId: plan.id, groupIds: ['forged'], confirmation: 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH', personalConfirmation: 'I_UNDERSTAND_HISTORY_AND_MEMORY_WILL_BE_MOVED' })).status, 400);
  const jobId = await wait(await post('execute', { planId: plan.id, groupIds: ids, confirmation: 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH', personalConfirmation: 'I_UNDERSTAND_HISTORY_AND_MEMORY_WILL_BE_MOVED' }));
  const receipt = await (await fetch(base + '/api/ai/project-cleanups/' + jobId)).json(); assert.ok(receipt.records.some(row => row.status === 'moved')); assert.equal(receipt.receipt.moved, 1);
  assert.equal((await post('execute', { planId: plan.id, groupIds: ids, confirmation: 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH' })).status, 400);
  await new Promise(resolve => server.close(resolve)); base = await start(); boot = await (await fetch(base + '/api/bootstrap')).json();
  assert.equal(boot.ai.projectPlan, null); assert.equal(boot.ai.projectCleanup.moved, 1); assert.equal(boot.ai.projectStorage.stale, true);
});
