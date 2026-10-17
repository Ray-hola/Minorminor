import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink, open } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { zstdCompressSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { analyzeProjects } from '../lib/project-analysis.mjs';
import { probeAssociation } from '../lib/association-files.mjs';
import { measureProjectStorage, publicProjectStorage, publicAssociationFiles } from '../lib/project-storage.mjs';
import { createProjectFileBrowser } from '../lib/file-inspector.mjs';
import { readCompressedSessionPrefix } from '../lib/compressed-session.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-associations-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const put = async (relative, value = 'fixture') => { const file = path.join(home, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value); return file; };
  const project = path.join(home, 'project'), profile = path.join(home, '.codex');
  await put('project/package.json', '{"description":"Project"}'); await mkdir(profile);
  const dbPath = path.join(profile, 'state_5.sqlite'), db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,title TEXT,rollout_path TEXT); CREATE TABLE project_roots(project_id TEXT,path TEXT)');
  const content = Buffer.from(JSON.stringify({ type: 'session_meta', payload: { title: 'Session title', cwd: project, secret: 'PRIVATE_SECRET' }, message: { content: 'PRIVATE_BODY' } }) + '\n' + JSON.stringify({ type: 'user', message: { content: 'PRIVATE_BODY'.repeat(15000) } }) + '\n');
  const paths = {};
  for (const name of ['plain', 'compressed', 'archived', 'absent', 'ambiguous', 'linked', 'directory']) {
    const filename = path.join(profile, 'sessions/old', `rollout-${name}.jsonl`); paths[name] = filename;
    db.prepare('INSERT INTO threads VALUES (?,?,?,?)').run(name, project, name, filename);
  }
  db.close();
  await put('.codex/sessions/old/rollout-plain.jsonl', content);
  await put('.codex/sessions/old/rollout-compressed.jsonl.zst', zstdCompressSync(content));
  await put('.codex/archived_sessions/rollout-archived.jsonl.zst', zstdCompressSync(content));
  await put('.codex/archived_sessions/a/rollout-ambiguous.jsonl.zst', zstdCompressSync(content));
  await put('.codex/archived_sessions/b/rollout-ambiguous.jsonl.zst', zstdCompressSync(content));
  await symlink(paths.plain, paths.linked); await mkdir(paths.directory);
  const snapshot = { id: 'snapshot', complete: true, items: [{ id: 'codex', path: profile, aiTool: 'Codex', aiKind: 'state' }] };
  return { home, project, profile, paths, dbPath, snapshot, put, content };
}

test('exact same-profile compressed and archived rollouts restore associations without rewriting the tool database', async t => {
  const f = await fixture(t), before = await readFile(f.dbPath), report = await analyzeProjects(f);
  const assets = report.groups.find(g => g.path === f.project).assets;
  const compressed = assets.find(a => a.recordId === 'compressed'), archived = assets.find(a => a.recordId === 'archived');
  assert.equal(compressed.physicalPath, f.paths.compressed + '.zst'); assert.equal(compressed.indexedPhysicalPath, f.paths.compressed); assert.equal(compressed.pathResolution, 'compressed');
  assert.equal(archived.physicalPath, path.join(f.profile, 'archived_sessions/rollout-archived.jsonl.zst')); assert.equal(archived.pathResolution, 'archived');
  assert.equal(assets.find(a => a.recordId === 'ambiguous').pathResolution, 'ambiguous');
  assert.equal(assets.find(a => a.recordId === 'linked').physicalPath, f.paths.linked);
  assert.deepEqual(await readFile(f.dbPath), before);
  assert.equal(JSON.stringify(report).includes('PRIVATE_BODY'), false);
  const storage = await measureProjectStorage({ ...f, report }), stats = storage.groups.find(g => g.path === f.project);
  assert.equal(stats.recoveredFiles, 2); assert.equal(stats.associationCounts.recovered, 2);
  assert.equal(stats.associationCounts.missing, 1); assert.equal(stats.associationCounts.ambiguous, 1); assert.equal(stats.associationCounts.unsafe, 1); assert.equal(stats.associationCounts['not-file'], 1);
  assert.equal(stats.categories.session.files, 3);
  assert.equal(storage.files.find(row => row.path === compressed.physicalPath).managed, true);
  assert.match(storage.files.find(row => row.path === compressed.physicalPath).blocked, /数据库/);
  assert.equal(publicProjectStorage(storage, report).associations, undefined);
});

test('permission failures are distinct from missing paths and never become cleanup candidates', async t => {
  const f = await fixture(t), report = await analyzeProjects(f);
  const storage = await measureProjectStorage({ ...f, report, associationProbe: (filename, options) => filename === f.paths.plain ? { status: 'permission', code: 'EACCES', reason: 'Permission denied' } : probeAssociation(filename, options) });
  const diagnostic = storage.associations.find(row => row.path === f.paths.plain);
  assert.equal(diagnostic.status, 'permission'); assert.equal(diagnostic.code, 'EACCES');
  assert.equal(storage.associationSummary.permission, 1);
  assert.equal(storage.files.find(row => row.path === f.paths.plain).blocked, 'Permission denied');
  assert.equal(publicAssociationFiles(storage, { status: 'missing' }).total, 1);
  assert.equal(publicAssociationFiles(storage, { status: 'permission' }).total, 1);
  const searched = publicAssociationFiles(storage, { query: 'rollout-compressed' });
  assert.equal(searched.total, 1); assert.equal(searched.summary.recovered, 1); assert.equal(searched.summary.permission, 0);
  assert.throws(() => publicAssociationFiles(storage, { status: '__proto__' }), /筛选/);
  assert.throws(() => publicAssociationFiles(storage, { projectId: 'forged' }), /筛选/);
  assert.throws(() => publicAssociationFiles(storage, { offset: -1 }), /筛选/);
});

test('compressed session previews decode a bounded prefix and expose only explicit session metadata', async t => {
  const f = await fixture(t), report = await analyzeProjects(f), storage = await measureProjectStorage({ ...f, report });
  const browser = createProjectFileBrowser({ ...f, report, storage }); t.after(() => browser.dispose());
  const group = report.groups.find(g => g.path === f.project), listing = await browser.list({ projectId: group.id, kind: 'session' });
  const row = listing.rows.find(row => row.path === f.paths.compressed + '.zst');
  assert.equal(row.canPreview, true); assert.equal(row.format, 'JSONL · ZSTD');
  const detail = await browser.inspect(row.id);
  assert.equal(detail.mode, 'content'); assert.equal(detail.truncated, true); assert.equal(detail.excerpt, '');
  assert.equal(detail.fields.find(row => row.name === 'cwd').value, f.project);
  assert.equal(JSON.stringify(detail).includes('PRIVATE_BODY'), false); assert.equal(JSON.stringify(detail).includes('PRIVATE_SECRET'), false);
  assert.ok(detail.bytesRead <= 262144);
});

test('truncated or corrupt compressed data fails explicitly and leaves the file unchanged', async t => {
  const f = await fixture(t), file = await f.put('bad.jsonl.zst', Buffer.from('invalid zstd'));
  const handle = await open(file, 'r');
  try { await assert.rejects(readCompressedSessionPrefix(handle)); } finally { await handle.close(); }
  assert.equal(await readFile(file, 'utf8'), 'invalid zstd');
});

test('diagnostics API binds a storage snapshot, paginates and keeps full records out of bootstrap', async t => {
  const f = await fixture(t), report = await analyzeProjects(f), storage = await measureProjectStorage({ ...f, report }), runtimeDirectory = path.join(f.home, '.runtime');
  await mkdir(runtimeDirectory); await writeFile(path.join(runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, aiScan: f.snapshot, projectAnalysis: report, projectStorage: storage }));
  const server = createApp({ home: f.home, runtimeDirectory, persistState: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/`, boot = await (await fetch(base + 'bootstrap')).json();
  assert.equal(boot.ai.projectStorage.associations, undefined); assert.equal(boot.ai.projectStorage.associationSummary.recovered, 2);
  const query = `ai/project-storage/associations?storageId=${storage.id}&status=recovered`, response = await fetch(base + query), rows = await response.json();
  assert.equal(response.status, 200); assert.equal(rows.total, 2); assert.equal(rows.stale, false); assert.ok(rows.rows.every(row => row.indexedPath !== row.path));
  assert.equal((await fetch(base + 'ai/project-storage/associations?storageId=forged')).status, 400);
  assert.equal((await fetch(base + query, { headers: { Origin: 'http://untrusted.invalid' } })).status, 403);
  const paged = publicAssociationFiles({ ...storage, associations: Array.from({ length: 105 }, (_, i) => ({ ...storage.associations[0], id: String(i) })) });
  assert.equal(paged.rows.length, 100); assert.equal(paged.hasMore, true);
});
