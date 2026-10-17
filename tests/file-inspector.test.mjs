import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm, symlink, rename, lstat } from 'node:fs/promises';
import { createProjectFileBrowser, describeProjectFile, redactFileText } from '../lib/file-inspector.mjs';
import { measureProjectStorage } from '../lib/project-storage.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-file-browser-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'project'), put = async (name, content = 'const answer = 42;') => { const filename = path.join(root, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, content); return filename; };
  await put('source.js'); await put('.cache/one.pyc', Buffer.from([0, 1, 2])); await put('logs/app.log', 'INFO start\npassword="danger-value"\nERROR retry');
  await put('.env.local', 'SECRET=never-open'); await put('tokens.json', '{"name":"do-not-open"}'); await put('state.sqlite', 'secret database body');
  await put('project-memory.md', '# Project plan\nRemember the agreed architecture.');
  const session = await put('session.jsonl', JSON.stringify({ type: 'session_meta', payload: { title: 'Build preview', cwd: root, api_key: 'sensitive-value' }, message: { role: 'user', content: 'private full prompt', tool_input: 'private tool args' } }) + '\n');
  await put('package.json', JSON.stringify({ name: 'alpha', description: 'File tool', version: '1.0.0', api_key: 'raw-secret', scripts: { test: 'private command' } }));
  await put('unknown', 'unclassified'); await put('nested/source.py', 'print(1)');
  const report = { id: 'report', snapshotId: 'snapshot', createdAt: new Date(Date.now() + 10000).toISOString(), complete: true, scopes: [], unassigned: [], errors: [], coverage: {}, groups: [{ id: 'project', path: root, name: 'project', type: 'project', exists: true, agents: ['Test'], scopeIds: [], sessions: 1, assets: [{ kind: 'session', sourcePath: session, title: 'Build preview', explanation: 'JSONL cwd field' }, { kind: 'memory', sourcePath: path.join(root, 'project-memory.md'), title: 'Project plan' }] }, { id: 'nested', path: path.join(root, 'nested'), name: 'nested', type: 'project', exists: true, assets: [], agents: [], scopeIds: [], sessions: 0 }, { id: 'home', path: home, name: 'home', type: 'workspace', exists: true, assets: [], agents: [], scopeIds: [], sessions: 0 }] };
  const storage = await measureProjectStorage({ home, report });
  const browser = createProjectFileBrowser({ home, report, storage });
  t.after(() => browser.dispose());
  return { home, root, put, report, storage, browser };
}

test('lazy browsing covers protected source/dependencies and every page, reports allocated/logical bytes, and leaves categories unchanged', async t => {
  const f = await fixture(t), count = f.storage.files.length;
  for (let i = 0; i < 115; i++) await f.put(`node_modules/package/file-${String(i).padStart(3, '0')}.js`);
  const top = await f.browser.list({ projectId: 'project' });
  const source = top.rows.find(r => r.name === 'source.js');
  assert.equal(source.logicalBytes, (await lstat(path.join(f.root, 'source.js'))).size);
  assert.equal(source.bytes, (await lstat(path.join(f.root, 'source.js'))).blocks * 512);
  assert.match(source.purpose, /源代码/); assert.equal(source.kind, 'other');
  assert.equal(top.rows.find(r => r.name === 'node_modules').bytes, null);
  const deps = await f.browser.list({ projectId: 'project', directoryId: top.rows.find(r => r.name === 'node_modules').id });
  const pkg = await f.browser.list({ projectId: 'project', directoryId: deps.rows[0].id });
  assert.equal(pkg.total, 115); assert.equal(pkg.rows.length, 100); assert.equal(pkg.hasMore, true);
  assert.match(pkg.rows[0].purpose, /依赖/);
  const page2 = await f.browser.list({ projectId: 'project', directoryId: deps.rows[0].id, offset: 100 });
  assert.equal(page2.rows.length, 15); assert.equal(page2.hasMore, false);
  assert.equal(new Set([...pkg.rows, ...page2.rows].map(r => r.path)).size, 115);
  const search = await f.browser.list({ projectId: 'project', directoryId: deps.rows[0].id, query: 'file-114', sort: 'name' });
  assert.equal(search.total, 1); assert.equal(search.rows[0].name, 'file-114.js');
  assert.equal(f.storage.files.length, count); assert.ok(!f.storage.files.some(r => r.path.endsWith('source.js')));
});

test('only issued scoped IDs open directories/files; symlinks, broad workspace, forged IDs and nested project traversal are refused', async t => {
  const f = await fixture(t);
  await symlink(f.home, path.join(f.root, 'escape'));
  const top = await f.browser.list({ projectId: 'project' });
  assert.equal(top.rows.some(r => r.name === 'escape'), false); assert.equal(top.errorCount, 1);
  assert.equal(top.rows.find(r => r.name === 'nested').nestedProject.id, 'nested');
  await assert.rejects(f.browser.list({ projectId: 'project', directoryId: top.rows.find(r => r.name === 'nested').id }), /子项目/);
  await assert.rejects(f.browser.list({ projectId: 'nested', directoryId: top.breadcrumbs[0].id }), /过期/);
  await assert.rejects(f.browser.list({ projectId: 'project', directoryId: '../../etc' }), /过期/);
  await assert.rejects(f.browser.inspect('/etc/passwd'), /过期/);
  assert.equal((await f.browser.list({ projectId: 'home' })).total, 0);
  await assert.rejects(f.browser.list({ projectId: 'invalid' }), /项目/);
  await assert.rejects(f.browser.list({ projectId: 'project', kind: 'other' }), /参数/);
  await assert.rejects(f.browser.list({ projectId: 'project', offset: -1 }), /参数/);
});

test('inspector reads bounded safe fields and text excerpts; credentials, database, binary, and opaque formats stay metadata-only', async t => {
  const f = await fixture(t), top = await f.browser.list({ projectId: 'project' });
  const inspect = name => f.browser.inspect(top.rows.find(r => r.name === name).id);
  for (const name of ['.env.local', 'tokens.json', 'state.sqlite', 'unknown']) { const result = await inspect(name); assert.equal(result.mode, 'metadata'); assert.equal(result.bytesRead, 0); assert.equal(result.excerpt, undefined); }
  const source = await inspect('source.js'); assert.match(source.excerpt, /answer = 42/); assert.equal(source.mode, 'content');
  const manifest = await inspect('package.json');
  assert.equal(manifest.fields.find(r => r.name === 'name').value, 'alpha'); assert.ok(!JSON.stringify(manifest).includes('raw-secret')); assert.ok(!JSON.stringify(manifest).includes('private command'));
  const session = await inspect('session.jsonl'); const sessionText = JSON.stringify(session);
  assert.ok(sessionText.includes('Build preview')); assert.ok(sessionText.includes('session_meta')); assert.ok(sessionText.includes('user'));
  for (const secret of ['sensitive-value', 'private full prompt', 'private tool args']) assert.ok(!sessionText.includes(secret));
  const logs = await f.browser.list({ projectId: 'project', kind: 'log' });
  const log = await f.browser.inspect(logs.rows[0].id); assert.match(log.excerpt, /INFO start/); assert.ok(!log.excerpt.includes('danger-value'));
  await f.put('huge.txt', 'x'.repeat(100000));
  const large = await f.browser.list({ projectId: 'project', query: 'huge' }), content = await f.browser.inspect(large.rows[0].id);
  assert.equal(content.bytesRead, 32768); assert.equal(content.excerpt.length, 4000); assert.equal(content.truncated, true);
  await f.put('invalid.txt', Buffer.from([0xff, 0xfe, 0xfd]));
  const invalid = await f.browser.list({ projectId: 'project', query: 'invalid' });
  assert.equal((await f.browser.inspect(invalid.rows[0].id)).mode, 'metadata');
});

test('stale identities and replaced parents fail closed; changed category files show current sizes and require refresh', async t => {
  const f = await fixture(t), top = await f.browser.list({ projectId: 'project' });
  const source = top.rows.find(r => r.name === 'source.js'); await f.put('source.js', 'changed source');
  await assert.rejects(f.browser.inspect(source.id), /变化/);
  const cache = await f.browser.list({ projectId: 'project', kind: 'cache' });
  await f.put('.cache/one.pyc', 'changed and longer cache');
  const changed = await f.browser.list({ projectId: 'project', kind: 'cache' }); assert.equal(changed.rows[0].changed, true);
  await rename(path.join(f.root, '.cache'), path.join(f.root, 'moved-cache'));
  await symlink(path.join(f.root, 'moved-cache'), path.join(f.root, '.cache'));
  await assert.rejects(f.browser.inspect(changed.rows[0].id), /链接|路径/);
  assert.equal(await readFile(path.join(f.root, 'source.js'), 'utf8'), 'changed source');
});

test('file purpose explains cache, logs, memory, lockfiles and protected evidence; text redaction hides common secret forms', () => {
  assert.match(describeProjectFile('/project/__pycache__/app.cpython-312.pyc', 'cache').purpose, /app.*字节码/);
  assert.match(describeProjectFile('/project/.pytest_cache/v/cache/lastfailed', 'cache').purpose, /上次失败/);
  assert.match(describeProjectFile('/project/logs/error.log', 'log').purpose, /诊断/);
  assert.match(describeProjectFile('/project/MEMORY.md', 'memory').purpose, /长期记忆/);
  assert.match(describeProjectFile('/project/package-lock.json').purpose, /锁定/);
  assert.match(describeProjectFile('/project/.private-backups/sample.js').purpose, /备份/);
  const output = redactFileText('"api_key": "secret-value"\nAuthorization: Bearer abcdef\nOPENAI_API_KEY="prefixed-secret"\nAWS_SECRET_ACCESS_KEY=aws-secret\n-----BEGIN PRIVATE KEY-----\nVERYPRIVATE\n-----END PRIVATE KEY-----\nhttps://example.com?token=hidden\nsk-12345678901234567890\ngithub_pat_12345678901234567890');
  for (const value of ['secret-value', 'abcdef', 'prefixed-secret', 'aws-secret', 'VERYPRIVATE', 'hidden', '12345678901234567890']) assert.ok(!output.includes(value));
});

test('HTTP browsing/inspection binds the current snapshot and validates host, origin and inspection token', async t => {
  const f = await fixture(t), runtimeDirectory = path.join(f.home, 'runtime'); await mkdir(runtimeDirectory);
  await writeFile(path.join(runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, projectAnalysis: f.report, projectStorage: f.storage }));
  const server = createApp({ home: f.home, port: 0, persistState: true, runtimeDirectory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`, bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  const browsePath = `/api/ai/project-storage/browse?storageId=${f.storage.id}&project=project`;
  const list = await (await fetch(base + browsePath)).json(); assert.ok(list.rows.length);
  const body = JSON.stringify({ storageId: f.storage.id, id: list.rows.find(r => r.name === 'source.js').id });
  let response = await fetch(base + '/api/ai/project-storage/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); assert.equal(response.status, 403);
  response = await fetch(base + '/api/ai/project-storage/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': bootstrap.token }, body }); assert.equal(response.status, 200); assert.match((await response.json()).excerpt, /answer = 42/);
  response = await fetch(base + browsePath, { headers: { Origin: 'https://external.example' } }); assert.equal(response.status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const request = http.get(base + browsePath, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); }); assert.equal(hostStatus, 403);
  response = await fetch(base + '/api/ai/project-storage/browse?storageId=old&project=project'); assert.equal(response.status, 400);
  const otherBrowser = createProjectFileBrowser(f); await assert.rejects(otherBrowser.inspect(list.rows[0].id), /过期/);
  otherBrowser.dispose();
});

test('folder-size HTTP worker requires the current snapshot and token, fills all folder rows, sorts by recursive size and preserves cleanup scope', async t => {
  const f = await fixture(t), runtimeDirectory = path.join(f.home, 'runtime'); await mkdir(runtimeDirectory);
  await f.put('larger/deep/payload.dat', Buffer.alloc(100000));
  for (let i = 0; i < 105; i++) await f.put(`dir-${String(i).padStart(3, '0')}/value.txt`, 'x');
  const originalTargets = f.storage.files.map(row => row.path);
  await writeFile(path.join(runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, projectAnalysis: f.report, projectStorage: f.storage }));
  const server = createApp({ home: f.home, port: 0, persistState: true, runtimeDirectory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`, bootstrap = await (await fetch(base + '/api/bootstrap')).json(), endpoint = '/api/ai/project-storage/directory-sizes';
  const post = (body, token = bootstrap.token) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': token }, body: JSON.stringify({ storageId: f.storage.id, ...body }) });
  assert.equal((await post({ projectId: 'project' }, '')).status, 403);
  assert.equal((await post({ projectId: 'home' })).status, 400);
  assert.equal((await post({ projectId: '../../etc' })).status, 400);
  assert.equal((await post({ projectId: 'project', storageId: 'stale' })).status, 400);
  const first = await (await post({ projectId: 'project' })).json(), again = await (await post({ projectId: 'project' })).json(); assert.equal(first.id, again.id);
  let status;
  for (let i = 0; i < 500; i++) { status = await (await fetch(base + endpoint + `?storageId=${f.storage.id}&project=project`)).json(); if (status.status === 'complete') break; if (status.status === 'failed') throw new Error(status.error); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(status.status, 'complete');
  const rows = await (await fetch(base + `/api/ai/project-storage/browse?storageId=${f.storage.id}&project=project`)).json();
  const folders = rows.rows.filter(row => row.directory); assert.ok(folders.every(row => row.bytes !== null && row.folderSize.status === 'complete'));
  assert.equal(folders[0].name, 'larger'); assert.equal(folders[0].folderSize.files, 1); assert.equal(folders[0].logicalBytes, 100000);
  assert.ok(rows.hasMore);
  const second = await (await fetch(base + `/api/ai/project-storage/browse?storageId=${f.storage.id}&project=project&offset=100`)).json();
  assert.equal(second.rows.find(row => row.name === 'nested').folderSize.files, 1);
  assert.ok(second.rows.filter(row => row.directory).every(row => row.bytes !== null));
  const nested = await (await fetch(base + `/api/ai/project-storage/browse?storageId=${f.storage.id}&project=project&directory=${folders[0].id}`)).json(); assert.equal(nested.rows[0].folderSize.files, 1);
  assert.deepEqual(f.storage.files.map(row => row.path), originalTargets); assert.equal(bootstrap.ai.projectPlan, null);
  assert.equal((await post({ projectId: 'project', action: 'invalid' })).status, 400);
});
