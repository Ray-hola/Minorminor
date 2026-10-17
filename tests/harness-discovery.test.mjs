import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, realpath, mkdir, writeFile, rm, symlink, readFile, opendir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { scanAiStorage } from '../lib/ai-storage.mjs';
import { analyzeProjects } from '../lib/project-analysis.mjs';
import { agentInventory } from '../lib/agent-inventory.mjs';
import { createHarnessDiscovery } from '../lib/harness-discovery.mjs';
import { harnessMetadata, analyzeHarnessCandidates, normalizeHarnessAnalysis } from '../lib/harness-analysis.mjs';
import { createApp } from '../server.mjs';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-unseen-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const name = 'unseen-' + randomBytes(6).toString('hex');
  const put = async (relative, value = 'PRIVATE_CONTENT') => { const filename = path.join(home, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, value); return filename; };
  return { home, name, put };
}
async function unknownHarness(f) {
  await f.put(`.local/lib/node_modules/${f.name}/package.json`, JSON.stringify({ name: f.name, description: 'A personal coding harness', bin: { helper: './cli.js' }, dataDir: '.personal-store', dependencies: { openai: '*' } }));
  await f.put('.personal-store/settings.json', JSON.stringify({ model: 'private-model-name', provider: 'private-provider', api_key: 'PRIVATE_API_KEY' }));
  for (const directory of ['cache', 'logs', 'memory']) await f.put(`.personal-store/${directory}/sample.bin`);
  const project = path.join(f.home, 'work/private-project'); await f.put('work/private-project/package.json', '{}');
  const session = await f.put('.personal-store/sessions/one.jsonl', JSON.stringify({ type: 'session', cwd: project, role: 'assistant', model: 'PRIVATE_MODEL', tool_calls: [], content: 'PRIVATE_TRANSCRIPT', api_key: 'PRIVATE_KEY' }) + '\n');
  return { project, session };
}
const config = { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'fixture', apiKey: '', harnessAnalysis: true };
const responseFor = (options, change = value => value) => {
  const items = JSON.parse(JSON.parse(options.body).messages[1].content).items;
  return new Response(JSON.stringify({ message: { content: JSON.stringify({ items: items.map(row => change({ id: row.id, isHarness: true, kind: 'coding-agent', name: row.name, confidence: 'high', reason: '安装身份与工具调用结构相互印证', uncertainty: '缓存是否仍被使用无法确认' })) }) } }));
};

test('a random previously unknown installed harness is discovered, partitioned and associated with a project without catalog changes', async t => {
  const f = await fixture(t), { project } = await unknownHarness(f), snapshot = await scanAiStorage(f);
  const candidate = snapshot.discovery.candidates.find(row => row.name === f.name);
  assert.ok(candidate); assert.equal(candidate.path, path.join(f.home, '.personal-store'));
  assert.equal(candidate.confidence, 'high'); assert.equal(candidate.status, 'pending');
  const rows = snapshot.items.filter(row => row.candidateId === candidate.id);
  for (const category of ['cache', 'log', 'session', 'memory', 'state']) assert.ok(rows.some(row => row.aiCategory === category), category);
  assert.ok(rows.every(row => row.selectable === false));
  const report = await analyzeProjects({ ...f, snapshot });
  assert.equal(report.groups.find(row => row.path === project).sessions, 1);
  assert.ok(report.groups.find(row => row.path === project).agents.includes(candidate.tool));
  const inventory = agentInventory(snapshot, null);
  assert.ok(inventory.rows.filter(row => row.candidateId === candidate.id).every(row => row.planItems.length === 0));
  for (const secret of ['PRIVATE_TRANSCRIPT', 'PRIVATE_KEY', 'PRIVATE_API_KEY', 'private-model-name']) assert.equal(JSON.stringify(snapshot).includes(secret), false);
});

test('installation-free arbitrary names and unknown macOS application data are discovered by content and database schema', async t => {
  const f = await fixture(t), root = `Library/Application Support/${f.name}`;
  for (const leaf of ['sessions', 'cache', 'logs']) await f.put(`${root}/${leaf}/placeholder`);
  const filename = await f.put(`${root}/state.db`, ''), db = new DatabaseSync(filename);
  db.exec('CREATE TABLE conversations(id TEXT,body TEXT); CREATE TABLE tool_calls(id TEXT); CREATE TABLE models(id TEXT); INSERT INTO conversations VALUES (\'one\',\'PRIVATE_DB_BODY\')'); db.close();
  const before = await readFile(filename);
  await f.put(`.${f.name}/sessions/thread.jsonl`, JSON.stringify({ role: 'assistant', tool_calls: [], workdir: path.join(f.home, 'work/project') }));
  await f.put(`.${f.name}-standalone/events.ndjson`, JSON.stringify({ role: 'assistant', toolCalls: [], workingDirectory: path.join(f.home, 'work/project'), modelId: 'PRIVATE_MODEL_ID' }));
  const snapshot = await scanAiStorage(f);
  assert.ok(snapshot.discovery.candidates.some(row => row.path === path.join(f.home, root) && row.samples.some(sample => sample.format === 'sqlite-schema')));
  assert.ok(snapshot.discovery.candidates.some(row => row.path === path.join(f.home, '.' + f.name)));
  assert.ok(snapshot.discovery.candidates.some(row => row.path === path.join(f.home, '.' + f.name + '-standalone') && row.features.includes('project-reference')));
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_DB_BODY'), false); assert.deepEqual(await readFile(filename), before);
});

test('unknown installed tools without data remain visible as uncertain installation evidence', async t => {
  const f = await fixture(t);
  await f.put(`.local/lib/node_modules/${f.name}/package.json`, JSON.stringify({ name: f.name, description: 'A custom coding harness', version: '1.2.3' }));
  const snapshot = await scanAiStorage(f), candidate = snapshot.discovery.candidates.find(row => row.name === f.name);
  assert.equal(candidate.installationOnly, true); assert.equal(candidate.confidence, 'low'); assert.equal(candidate.status, 'pending');
  assert.equal(snapshot.items.some(row => row.candidateId === candidate.id), false);
  assert.equal(snapshot.discovery.agents.find(row => row.name === candidate.tool).status, 'installed-only');
});

test('neutral installation names and descriptions can be identified from runtime evidence without AI words in the manifest', async t => {
  const f = await fixture(t);
  await f.put(`.local/lib/node_modules/${f.name}/package.json`, JSON.stringify({ name: f.name, description: 'Terminal workspace', dataDir: '.neutral-store' }));
  await f.put('.neutral-store/sessions/one.jsonl', JSON.stringify({ role: 'assistant', toolCalls: [], projectRoot: path.join(f.home, 'work/client') }));
  const snapshot = await scanAiStorage(f), candidate = snapshot.discovery.candidates.find(row => row.name === f.name);
  assert.ok(candidate); assert.equal(candidate.installationOnly, undefined); assert.equal(candidate.features.includes('agent-package'), false);
  assert.equal(candidate.features.includes('tool-activity'), true); assert.equal(candidate.installations.length, 1); assert.equal(candidate.confidence, 'high');
});

test('a native app without an Electron package is linked to data by installation identity and structured content', async t => {
  const f = await fixture(t);
  await f.put(`Applications/${f.name}.app/Contents/Info.plist`, `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.${f.name}</string></dict></plist>`);
  await f.put(`Library/Application Support/${f.name}/sessions/one.jsonl`, '{"role":"assistant","tool_calls":[],"model":"local"}');
  const snapshot = await scanAiStorage(f), candidate = snapshot.discovery.candidates.find(row => row.path === path.join(f.home, 'Library/Application Support', f.name));
  assert.ok(candidate); assert.ok(candidate.installations.some(row => row.path.endsWith('Info.plist'))); assert.equal(candidate.confidence, 'high');
});

test('generic installed tools honor XDG locations without exposing unrelated environment variables', async t => {
  const f = await fixture(t);
  await f.put(`.local/lib/node_modules/${f.name}/package.json`, JSON.stringify({ name: f.name, description: 'Terminal workspace' }));
  await f.put(`portable-data/${f.name}/sessions/one.jsonl`, '{"role":"assistant","tool_calls":[]}');
  const snapshot = await scanAiStorage({ ...f, discoveryOptions: { env: { XDG_DATA_HOME: path.join(f.home, 'portable-data'), PRIVATE_TOKEN: 'NEVER_EXPORT_ENV' } } });
  const candidate = snapshot.discovery.candidates.find(row => row.path === path.join(f.home, 'portable-data', f.name));
  assert.ok(candidate); assert.ok(candidate.installations.length); assert.equal(candidate.name, f.name);
  assert.equal(JSON.stringify(snapshot).includes('NEVER_EXPORT_ENV'), false);
});

test('unsupported database formats remain unknown evidence instead of being reported as permission failures', async t => {
  const f = await fixture(t);
  for (const name of ['cache', 'logs', 'memory']) await f.put('.opaque/' + name + '/file');
  await f.put('.opaque/state.db', 'PRIVATE_ENCRYPTED_OR_CUSTOM_DATABASE');
  const snapshot = await scanAiStorage(f), candidate = snapshot.discovery.candidates.find(row => row.path === path.join(f.home, '.opaque'));
  assert.equal(snapshot.discovery.coverage.generic.unsupportedFiles, 1); assert.equal(snapshot.discovery.coverage.generic.errors, 0);
  assert.equal(candidate.samples[0].format, 'unknown-database'); assert.equal(candidate.status, 'pending');
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_ENCRYPTED_OR_CUSTOM_DATABASE'), false);
});

test('ordinary projects, instruction files, generic SDK dependencies and redirected samples do not prove a harness', async t => {
  const f = await fixture(t);
  await f.put('work/project/package.json', JSON.stringify({ name: f.name, description: 'AI coding agent', dependencies: { openai: '*' } }));
  await f.put('work/project/AGENTS.md', 'Follow these instructions');
  await f.put(`work/project/node_modules/${f.name}/package.json`, JSON.stringify({ name: f.name, description: 'AI coding agent' }));
  await f.put('.ordinary/cache/file'); await f.put('.ordinary/logs/file');
  await f.put('.ordinary/auth.json', JSON.stringify({ role: 'assistant', tool_calls: [], cwd: f.home }));
  for (const backup of ['.private-backups', 'acceptance-evidence', 'backups', 'fixtures', '.pytest_tmp']) await f.put(`work/project/${backup}/copy/sessions/thread.jsonl`, JSON.stringify({ type: 'session', cwd: f.home, role: 'assistant', tool_calls: [], model: 'fixture' }));
  const source = await f.put('private.jsonl', JSON.stringify({ type: 'session', cwd: f.home, tool_calls: [] }));
  await mkdir(path.join(f.home, '.ordinary/sessions')); await symlink(source, path.join(f.home, '.ordinary/sessions/sample.jsonl'));
  const snapshot = await scanAiStorage(f);
  assert.equal(snapshot.discovery.candidates.some(row => row.installations.length || row.features.length), false);
  assert.ok(snapshot.discovery.candidates.every(row => row.confidence === 'low'));
  assert.equal(snapshot.discovery.candidates.some(row => /backups|fixtures|acceptance-evidence|pytest_tmp/.test(row.path)), false);
});

test('bounded sampling is reported and cancellation still interrupts discovery', async t => {
  const f = await fixture(t); for (const name of ['one', 'two', 'three']) await f.put(`.custom/sessions/${name}.jsonl`, '{"role":"assistant","tool_calls":[]}');
  const collector = createHarnessDiscovery({ home: f.home, sampleLimit: 1 });
  const listing = []; for await (const item of await opendir(path.join(f.home, '.custom/sessions'))) listing.push(item);
  await collector.observe(path.join(f.home, '.custom/sessions'), listing);
  const result = await collector.finish(); assert.equal(result.coverage.sampledFiles, 1); assert.ok(result.coverage.samplesDeferred >= 1);
  await assert.rejects(scanAiStorage({ ...f, cancelled: () => true }), /停止/);
});

test('AI sees structure only, cannot invent paths or enable deletion, and unchanged device fingerprints reuse prior judgments', async t => {
  const f = await fixture(t); await unknownHarness(f); const snapshot = await scanAiStorage(f); let calls = 0, payload;
  const fetcher = async (url, options) => { calls++; payload = options.body; return responseFor(options, value => ({ ...value, path: '/delete/me', selectable: true, execute: 'rm -rf /' })); };
  const knowledge = await analyzeHarnessCandidates({ snapshot, config, fetcher });
  assert.equal(calls, 1); assert.equal(snapshot.discovery.candidates[0].status, 'ai-supported');
  for (const secret of [f.home, '.personal-store', 'private-project', 'PRIVATE_TRANSCRIPT', 'PRIVATE_KEY', 'PRIVATE_API_KEY']) assert.equal(payload.includes(secret), false, secret);
  assert.equal(snapshot.items.some(row => row.selectable), false);
  assert.equal(JSON.stringify(knowledge).includes('/delete/me'), false); assert.equal(JSON.stringify(knowledge).includes('rm -rf'), false);
  const next = await scanAiStorage(f); await analyzeHarnessCandidates({ snapshot: next, config, knowledge, fetcher });
  assert.equal(calls, 1); assert.equal(next.discovery.candidates[0].analysisCached, true);
  const metadata = harnessMetadata(next.discovery.candidates[0]); assert.equal(metadata.samples.some(row => 'projects' in row || 'path' in row), false);
  next.discovery.candidates[0].fingerprint += '-changed'; await analyzeHarnessCandidates({ snapshot: next, config, knowledge, fetcher }); assert.equal(calls, 2);
});

test('missing models, failed models, invalid outputs, omissions and negative judgments remain explicit', async t => {
  const f = await fixture(t); await unknownHarness(f); const snapshot = await scanAiStorage(f), candidate = snapshot.discovery.candidates[0];
  await analyzeHarnessCandidates({ snapshot, config: { ...config, model: '' }, fetcher: () => { throw new Error('MUST NOT CALL'); } }); assert.equal(candidate.status, 'pending');
  await analyzeHarnessCandidates({ snapshot, config, fetcher: async () => new Response('private provider body', { status: 500 }) }); assert.equal(candidate.status, 'analysis-failed'); assert.ok(candidate.analysisError);
  assert.throws(() => normalizeHarnessAnalysis({ items: [{ id: 'unknown', isHarness: true }] }, [candidate]), /未知/);
  assert.equal(normalizeHarnessAnalysis({ items: [] }, [candidate])[0].isHarness, null);
  await analyzeHarnessCandidates({ snapshot, config, fetcher: async (url, options) => responseFor(options, value => ({ ...value, isHarness: false, kind: 'library' })) });
  assert.equal(candidate.status, 'ai-rejected'); assert.equal(candidate.uncertain, true); assert.ok(snapshot.items.every(row => !row.selectable));
});

test('the normal synchronized HTTP flow automatically analyzes and persists unknown harnesses only after model opt-in', async t => {
  const f = await fixture(t), { session } = await unknownHarness(f), original = await readFile(session); let calls = 0;
  const app = createApp({ home: f.home, runtimeDirectory: path.join(f.home, '.runtime'), persistState: true, aiFetch: async (url, options) => {
    if (url.endsWith('/api/tags')) return new Response('{"models":[]}');
    calls++; return responseFor(options);
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port, bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  const post = async (route, body) => { const response = await fetch(base + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': bootstrap.token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await post('ai/config', config)).status, 200);
  const started = await post('sync', { scope: 'home' }); assert.equal(started.status, 202);
  let job;
  for (let i = 0; i < 250; i++) { job = await (await fetch(base + '/api/jobs/' + started.body.id)).json(); if (job.status !== 'running') break; await delay(20); }
  assert.equal(job.status, 'complete', JSON.stringify(job));
  const state = await (await fetch(base + '/api/bootstrap')).json(), candidate = state.ai.scan.discovery.candidates.find(row => row.name === f.name);
  assert.equal(candidate.status, 'ai-supported'); assert.equal(calls, 1); assert.equal(state.ai.config.harnessAnalysis, true);
  assert.ok(state.ai.projects.groups.some(row => row.agents.includes(candidate.tool)));
  assert.equal((await post('ai/harnesses/analyze', { snapshotId: 'forged' })).status, 400);
  const saved = JSON.parse(await readFile(path.join(f.home, '.runtime/latest-state.json'), 'utf8'));
  assert.equal(saved.harnessKnowledge.length, 1); assert.equal(JSON.stringify(saved).includes('PRIVATE_TRANSCRIPT'), false);
  assert.equal((await post('ai/projects/execute', { planId: 'invented', confirmation: 'yes' })).status, 400);
  assert.deepEqual(await readFile(session), original);
});
