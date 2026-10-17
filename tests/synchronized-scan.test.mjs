import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { runSynchronizedScan } from '../lib/synchronized-scan.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-sync-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), runtimeDirectory = path.join(root, 'runtime');
  await mkdir(home);
  const put = async (name, value) => { const filename = path.join(home, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, value); return filename; };
  return { root, home, runtimeDirectory, put, scope: { id: 'home', label: '整个用户目录', path: home, displayPath: home, stayOnDevice: true } };
}
async function until(fn) { for (let i = 0; i < 1000; i++) { const result = await fn(); if (result) return result; await delay(10); } throw new Error('task timeout'); }
function batch(name, jobId) {
  const createdAt = new Date(1000).toISOString(), aiId = `${name}-ai`, reportId = `${name}-projects`;
  return {
    scan: { id: name, createdAt, jobId, complete: true, items: [], categories: [], totalBytes: 0, count: 0 },
    analysis: { createdAt, complete: true, rows: [], count: 0 },
    aiScan: { id: aiId, jobId, createdAt, complete: true, items: [], discovery: { agents: [] }, errorCount: 0, bytes: 0, files: 0 },
    projectAnalysis: { id: reportId, snapshotId: aiId, createdAt, complete: true, groups: [], scopes: [], unassigned: [], errors: [], coverage: {} },
    projectStorage: { id: `${name}-storage`, snapshotId: aiId, reportId, createdAt, complete: true, groups: [], files: [], shared: [], errors: [], coverage: {} },
  };
}
async function app(t, f, options = {}) {
  const calls = [];
  const server = createApp({ ...f, persistState: true, aiFetch: async url => { calls.push(url); return Response.json({ models: [] }); }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const get = async endpoint => (await fetch(`${base}/api/${endpoint}`)).json();
  const token = (await get('bootstrap')).token;
  const post = (endpoint, body, headers = {}) => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': token, ...headers }, body: JSON.stringify(body) });
  return { server, base, get, post, calls };
}
async function seed(f, extra = {}) {
  await mkdir(f.runtimeDirectory, { recursive: true });
  await writeFile(path.join(f.runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, ...batch('old'), ...extra }));
}

test('one worker scans files, discovers agents, associates sessions and sizes every project without mutating files', async t => {
  const f = await fixture(t), project = path.join(f.home, 'Desktop/alpha');
  await f.put('Desktop/alpha/package.json', '{"description":"Alpha project"}');
  const cache = await f.put('Desktop/alpha/.cache/build.bin', 'cache payload');
  await f.put('Desktop/alpha/logs/task.log', 'fixture log');
  await f.put('work/plain-project/go.mod', 'module example.test/plain');
  const encoded = project.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-/, '');
  await f.put(`.claude/projects/${encoded}/memory/overview.md`, '# Project memory');
  const session = await f.put(`.claude/projects/${encoded}/s1.jsonl`, JSON.stringify({ cwd: project, type: 'user', message: { content: 'PRIVATE_TRANSCRIPT' } }) + '\n');
  const before = await readFile(session), stages = new Set();
  const outcome = await new Promise(resolve => runSynchronizedScan({ ...f, jobId: randomUUID(), onProgress: stats => stages.add(stats.stage), onDone: resolve }));
  assert.equal(outcome.type, 'result', outcome.error);
  assert.deepEqual([...stages], ['disk', 'ai', 'projects', 'storage']);
  const r = outcome.result;
  assert.equal(r.scan.count, r.analysis.count);
  assert.equal(r.scan.totalBytes, r.analysis.totalBytes);
  assert.equal(r.projectAnalysis.snapshotId, r.aiScan.id);
  assert.equal(r.projectStorage.reportId, r.projectAnalysis.id);
  assert.equal(r.projectStorage.snapshotId, r.aiScan.id);
  const group = r.projectAnalysis.groups.find(row => row.path === project);
  assert.ok(group, 'the session cwd locates its project');
  const size = r.projectStorage.groups.find(row => row.projectId === group.id);
  for (const kind of ['cache', 'log', 'session', 'memory']) assert.ok(size.categories[kind].bytes > 0, kind);
  assert.ok(size.totalBytes > 0);
  const ordinary = r.projectAnalysis.groups.find(row => row.path === path.join(f.home, 'work/plain-project'));
  assert.ok(ordinary, 'ordinary projects are discovered without agent history');
  assert.deepEqual(ordinary.agents, []);
  assert.equal(r.projectStorage.groups.find(row => row.projectId === ordinary.id).directoryStatus, 'complete');
  assert.deepEqual(await readFile(session), before);
  assert.equal(await readFile(cache, 'utf8'), 'cache payload');
  assert.equal(JSON.stringify(r.projectAnalysis).includes('PRIVATE_TRANSCRIPT'), false);
});

test('worker cancellation finishes once and never publishes a partial batch', async t => {
  const f = await fixture(t); let finishes = 0;
  const outcome = await new Promise(resolve => { const runner = runSynchronizedScan({ ...f, jobId: randomUUID(), onProgress() {}, onDone: value => { finishes++; resolve(value); } }); runner.cancel(); });
  await delay(30);
  assert.equal(finishes, 1); assert.equal(outcome.type, 'failure'); assert.equal(outcome.cancelled, true); assert.equal(outcome.result, undefined);
});

test('sync API protects requests, reuses the active task and atomically persists/publishes a coherent batch', async t => {
  const f = await fixture(t); await seed(f); let control;
  const a = await app(t, f, { syncRunner: options => { control = options; return { errorLog: path.join(f.runtimeDirectory, 'unused'), cancel() {} }; } });
  assert.equal((await a.post('sync', {}, { 'X-Minorminor-Token': 'expired' })).status, 403);
  assert.equal((await a.post('sync', {}, { Origin: 'http://untrusted.invalid' })).status, 403);
  assert.equal((await a.post('sync', { scope: 'arbitrary-path' })).status, 400);
  const response = await a.post('sync', { scope: 'home' }); assert.equal(response.status, 202); const { id } = await response.json();
  await until(() => control);
  assert.equal((await (await a.post('sync', { scope: 'home' })).json()).id, id);
  assert.equal((await a.post('sync', { scope: 'disk' })).status, 409);
  assert.equal((await a.post('ai/projects', { snapshotId: 'old-ai' })).status, 409);
  control.onProgress({ stage: 'storage', stageIndex: 4, stageLabel: '项目占用', files: 3 });
  const during = await a.get('bootstrap');
  assert.equal(during.scan.id, 'old'); assert.equal(during.ai.scan.id, 'old-ai'); assert.equal(during.ai.projectStorage.id, 'old-storage');
  await control.onDone({ type: 'result', result: batch('new', id), errorCountsByPhase: { disk: 0, ai: 0, projects: 0, storage: 0 } });
  const boot = await a.get('bootstrap');
  assert.equal(boot.scan.id, 'new'); assert.equal(boot.ai.projects.stale, false); assert.equal(boot.ai.projectStorage.stale, false);
  const snapshots = [boot.scan, boot.analysis, boot.ai.scan, boot.ai.projects, boot.ai.projectStorage];
  assert.ok(snapshots.every(row => row.syncId === id));
  assert.equal(new Set(snapshots.map(row => row.synchronizedAt)).size, 1);
  assert.ok(snapshots.every(row => row.createdAt === new Date(1000).toISOString()), 'association evidence timestamps retain their original meaning');
  assert.deepEqual(a.calls, ['http://127.0.0.1:11434/api/tags']);
  const saved = JSON.parse(await readFile(path.join(f.runtimeDirectory, 'latest-state.json'), 'utf8'));
  assert.equal(saved.synchronization.status, 'complete');
  assert.ok([saved.scan, saved.analysis, saved.aiScan, saved.projectAnalysis, saved.projectStorage].every(row => row.syncId === id));
  assert.equal((await a.get(`jobs/${id}`)).status, 'complete');
});

test('failed or cancelled synchronization preserves the previous complete snapshots', async t => {
  const f = await fixture(t); await seed(f); let control, cancelled = 0;
  const a = await app(t, f, { syncRunner: options => { control = options; return { cancel() { cancelled++; } }; } });
  let { id } = await (await a.post('sync', { scope: 'home' })).json(); await until(() => control);
  await control.onDone({ type: 'failure', error: 'fixture failure' });
  assert.equal((await a.get(`jobs/${id}`)).status, 'failed');
  assert.equal((await a.get('bootstrap')).ai.projectStorage.id, 'old-storage');
  control = null;
  ({ id } = await (await a.post('sync', { scope: 'home' })).json()); await until(() => control);
  assert.equal((await a.post('cancel', { id })).status, 200); assert.equal(cancelled, 1);
  await control.onDone({ type: 'result', result: batch('cancelled', id) });
  assert.equal((await a.get(`jobs/${id}`)).status, 'cancelled');
  const boot = await a.get('bootstrap'); assert.equal(boot.scan.id, 'old'); assert.equal(boot.ai.projectStorage.id, 'old-storage');
  assert.equal(JSON.parse(await readFile(path.join(f.runtimeDirectory, 'latest-state.json'), 'utf8')).scan.id, 'old');
});

test('cancelling during optional model detection cannot commit the completed worker batch', async t => {
  const f = await fixture(t); await seed(f); let control, finishModels;
  const a = await app(t, f, { syncRunner: options => { control = options; return { cancel() {} }; }, aiFetch: () => new Promise(resolve => { finishModels = () => resolve(Response.json({ models: [] })); }) });
  const { id } = await (await a.post('sync', { scope: 'home' })).json(); await until(() => control);
  const completing = control.onDone({ type: 'result', result: batch('new', id) });
  await until(() => finishModels);
  await a.post('cancel', { id }); finishModels(); await completing;
  assert.equal((await a.get(`jobs/${id}`)).status, 'cancelled'); assert.equal((await a.get('bootstrap')).scan.id, 'old');
});

test('AI project synchronization remains usable when Ollama is absent', async t => {
  const f = await fixture(t); let control;
  const a = await app(t, f, { syncRunner: options => { control = options; return { cancel() {} }; }, aiFetch: async () => { throw new Error('connection refused'); } });
  const { id } = await (await a.post('sync', { scope: 'home' })).json(); await until(() => control);
  await control.onDone({ type: 'result', result: batch('new', id) });
  const boot = await a.get('bootstrap');
  assert.equal((await a.get(`jobs/${id}`)).status, 'complete');
  assert.equal(boot.ai.scan.ollama.available, false); assert.equal(boot.ai.projects.stale, false); assert.equal(boot.ai.projectStorage.stale, false);
});

test('a persistence failure cannot expose an unsaved batch as completed', async t => {
  const f = await fixture(t); await seed(f); let control;
  const a = await app(t, f, { syncRunner: options => { control = options; return { cancel() {} }; } });
  const { id } = await (await a.post('sync', { scope: 'home' })).json(); await until(() => control);
  await mkdir(path.join(f.runtimeDirectory, 'latest-state.json.tmp'));
  await control.onDone({ type: 'result', result: batch('unsaved', id) });
  assert.equal((await a.get(`jobs/${id}`)).status, 'failed');
  const boot = await a.get('bootstrap'); assert.equal(boot.scan.id, 'old'); assert.equal(boot.ai.projectStorage.id, 'old-storage');
  assert.equal(JSON.parse(await readFile(path.join(f.runtimeDirectory, 'latest-state.json'), 'utf8')).scan.id, 'old');
});

test('interrupted sync restores the last batch and phase-filtered diagnostics paginate independently', async t => {
  const f = await fixture(t), id = randomUUID();
  await seed(f, { synchronization: { id, type: 'sync', status: 'running', errorCountsByPhase: { disk: 1, ai: 102, projects: 0, storage: 0 }, stats: { skipped: 103 } } });
  await mkdir(path.join(f.runtimeDirectory, 'scans'));
  const rows = [{ phase: 'disk', path: '/disk', code: 'EACCES' }, ...Array.from({ length: 102 }, (_, i) => ({ phase: 'ai', path: `/ai/${i}`, code: 'EACCES' }))];
  await writeFile(path.join(f.runtimeDirectory, 'scans', `${id}.sync.errors.jsonl`), rows.map(JSON.stringify).join('\n'));
  const a = await app(t, f), boot = await a.get('bootstrap');
  assert.equal(boot.synchronization.status, 'interrupted'); assert.equal(boot.scan.id, 'old');
  assert.equal(boot.jobs.find(row => row.id === id).status, 'interrupted');
  const first = await a.get(`jobs/${id}/errors?phase=ai`), last = await a.get(`jobs/${id}/errors?phase=ai&offset=100`);
  assert.equal(first.total, 102); assert.equal(first.errors.length, 100); assert.equal(first.hasMore, true); assert.equal(first.errors[0].path, '/ai/0');
  assert.equal(last.errors.length, 2); assert.equal(last.hasMore, false); assert.equal(last.errors[0].path, '/ai/100');
  assert.equal((await a.get(`jobs/${id}/errors?phase=disk`)).total, 1);
});
