import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { analyzeProjects, publicProjects, projectDetails, projectsCsv, safeExcerpt } from '../lib/project-analysis.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-projects-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const project = path.join(home, 'Desktop/one-project'), nested = path.join(project, 'nested');
  const put = async (relative, text) => { const filename = path.join(home, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, text); return filename; };
  await put('Desktop/one-project/package.json', JSON.stringify({ description: 'A project purpose read from the actual manifest' }));
  await put('Desktop/one-project/nested/package.json', JSON.stringify({ description: 'Nested independent project' }));
  await put('.codex/placeholder', '');
  const db = new DatabaseSync(path.join(home, '.codex/state_5.sqlite'));
  db.exec('CREATE TABLE project_roots(project_id TEXT,path TEXT); CREATE TABLE threads(id TEXT,cwd TEXT,title TEXT,rollout_path TEXT,first_user_message TEXT); CREATE TABLE credentials(secret TEXT)');
  db.prepare('INSERT INTO project_roots VALUES (?,?)').run('p', project);
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run('session-1', path.join(project, 'src'), '=Project task title', null, 'NEVER_EXPORT_RAW_BODY');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run('session-2', nested, 'api_key=super-private-value <img src=x onerror=alert(1)>', null, 'NEVER_EXPORT_RAW_BODY');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run('session-3', null, 'No cwd title', null, 'NEVER_EXPORT_RAW_BODY');
  db.exec("INSERT INTO credentials VALUES ('NEVER_EXPORT_CREDENTIAL')"); db.close();
  // The cwd is authoritative even when the encoded directory is ambiguous.
  const claude = '.claude/projects/ambiguous/s1.jsonl';
  await put(claude, JSON.stringify({ type: 'custom-title', customTitle: 'Claude task' }) + '\n' + JSON.stringify({ cwd: project, message: { content: 'NEVER_EXPORT_TRANSCRIPT' } }) + '\n' + 'x'.repeat(270000));
  const encoded = project.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-/, '');
  await put(`.comate/projects/${encoded}/memory/overview.md`, '# Project memory heading\n\nNEVER_EXPORT_MEMORY_BODY');
  await put(`.comate/projects/${encoded}/memory/intent.md`, '---\nname: Project intent\ndescription: Long term plan of the project\ntype: project\n---\nNEVER_EXPORT_MEMORY_BODY');
  await put('.grok/sessions/placeholder', '');
  const grok = new DatabaseSync(path.join(home, '.grok/sessions/session_search.sqlite'));
  grok.exec('CREATE TABLE session_docs(session_id TEXT,cwd TEXT,title TEXT,content TEXT)');
  for (const id of ['g1', 'g2']) grok.prepare('INSERT INTO session_docs VALUES (?,?,?,?)').run(id, project, 'Grok ' + id, 'NEVER_EXPORT_RAW_BODY');
  grok.close();
  await put('.claude/logs/run.log', JSON.stringify({ level: 'ERROR', logger: 'fixture', cwd: project, message: 'NEVER_EXPORT_LOG_BODY password=private' }) + '\nENOENT WARN');
  await put('.claude/auth.json', 'NEVER_EXPORT_AUTH');
  await put('Desktop/one-project/.private-backups/fixture/opencode.json', 'NEVER_EXPORT_CONFIG');
  await put('Desktop/one-project/.private-backups/fixture/package.json', JSON.stringify({ description: 'This is a fixture, not a separate project' }));
  const item = (id, suffix, category = 'state') => ({ id, path: path.join(home, suffix), aiTool: id === 'grok' ? 'Grok' : id === 'codex' ? 'Codex' : 'Claude Code', aiKind: category === 'log' ? 'cache' : category, aiCategory: category, bytes: 1000, files: 2 });
  const snapshot = { id: 'fixture-snapshot', createdAt: new Date().toISOString(), complete: true, items: [item('codex', '.codex'), item('claude', '.claude'), item('comate', '.comate'), item('grok', '.grok'), item('logs', '.claude/logs', 'log'), item('auth', '.claude/auth.json'), item('backup', 'Desktop/one-project/.private-backups/fixture/opencode.json', 'project')] };
  return { home, project, nested, put, snapshot };
}

test('reads explicit index fields, headers and manifests; groups across agents without mixing nested projects or leaking bodies', async t => {
  const f = await fixture(t), dbBefore = await readFile(path.join(f.home, '.codex/state_5.sqlite'));
  const report = await analyzeProjects(f);
  const project = report.groups.find(row => row.path === f.project), nested = report.groups.find(row => row.path === f.nested);
  assert.ok(project); assert.ok(nested);
  // A missing cwd descendant cannot be confidently folded into its parent.
  assert.equal(nested.sessions, 1); assert.equal(project.sessions, 3);
  assert.ok(project.agents.includes('Claude Code')); assert.ok(project.agents.includes('Grok'));
  assert.ok(project.assets.some(row => row.kind === 'memory' && row.title === 'Project memory heading'));
  assert.ok(project.assets.some(row => row.kind === 'memory' && row.title === 'Project intent' && row.explanation.includes('Long term plan')));
  assert.match(project.description, /actual manifest/);
  assert.equal(report.coverage.truncatedFiles, 1);
  assert.ok(report.unassigned.some(row => row.recordId === 'session-3'));
  assert.ok(report.scopes.find(row => row.id === 'backup').explanation.includes('备份'));
  assert.equal(report.scopes.find(row => row.id === 'backup').projectId, project.id);
  assert.equal(report.groups.some(row => row.path.endsWith('/fixture')), false);
  assert.equal(report.scopes.find(row => row.id === 'logs').status, 'shared');
  const log = report.scopes.find(row => row.id === 'logs').samples[0];
  assert.equal(log.levels.ERROR, 1); assert.deepEqual(log.codes, ['ENOENT']); assert.deepEqual(log.cwdReferences, [f.project]);
  const output = JSON.stringify(report);
  assert.equal(output.includes('NEVER_EXPORT'), false); assert.equal(output.includes('super-private-value'), false);
  assert.deepEqual(await readFile(path.join(f.home, '.codex/state_5.sqlite')), dbBefore);
  assert.equal((await readFile(path.join(f.home, '.claude/auth.json'), 'utf8')), 'NEVER_EXPORT_AUTH');
});

test('database paging includes all records, shared database has no per-row byte estimate and exports escape formulas', async t => {
  const f = await fixture(t), db = new DatabaseSync(path.join(f.home, '.codex/state_5.sqlite'));
  const insert = db.prepare('INSERT INTO threads VALUES (?,?,?,?,?)');
  for (let i = 0; i < 1005; i++) insert.run('extra-' + i, f.project, 'title ' + i, null, 'NEVER_EXPORT_RAW_BODY');
  db.close();
  const report = await analyzeProjects(f), project = report.groups.find(row => row.path === f.project);
  assert.equal(project.sessions, 1008); assert.equal(project.assets.find(row => row.recordId === 'extra-1004').physicalBytes, null);
  const first = projectDetails(report, project.id), next = projectDetails(report, project.id, 1000);
  assert.equal(first.rows.length, 40); assert.equal(first.hasMore, true); assert.ok(next.rows.some(row => row.recordId === 'extra-1004'));
  const csv = projectsCsv(report); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=Project task title")); assert.equal(csv.includes('NEVER_EXPORT'), false);
  assert.equal(publicProjects(report, f.snapshot).groups[0].assets, undefined);
  assert.equal(publicProjects(report, { ...f.snapshot, id: 'next' }).stale, true);
  assert.throws(() => projectDetails(report, '../auth.json'), /未找到/);
});

test('does not follow symlinked sessions, documents or databases, and cancellation publishes no result', async t => {
  const f = await fixture(t);
  await f.put('private-target.jsonl', JSON.stringify({ cwd: '/SHOULD_NOT_BE_READ', customTitle: 'PRIVATE_LINK_TARGET' }));
  await symlink(path.join(f.home, 'private-target.jsonl'), path.join(f.home, '.claude/projects/ambiguous/link.jsonl'));
  await f.put('private-note.md', 'NEVER_EXPORT_DOC');
  await symlink(path.join(f.home, 'private-note.md'), path.join(f.project, 'README.md'));
  const report = await analyzeProjects(f); assert.ok(report.coverage.skippedLinks > 0); assert.equal(JSON.stringify(report).includes('PRIVATE_LINK_TARGET'), false);
  let stop = false;
  await assert.rejects(analyzeProjects({ ...f, cancelled: () => stop, onProgress: () => { stop = true; } }), /停止/);
  await assert.rejects(analyzeProjects({ ...f, snapshot: { ...f.snapshot, stale: true } }), /更新/);
});

test('HTTP job is snapshot-bound, persisted and metadata-only AI payload remains unchanged; paths cannot be read by request', async t => {
  const f = await fixture(t), runtimeDirectory = path.join(f.home, '.runtime'); await mkdir(runtimeDirectory);
  await writeFile(path.join(runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, aiScan: f.snapshot }));
  async function start() { const server = createApp({ home: f.home, runtimeDirectory, persistState: true }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server; }
  let server = await start(); t.after(() => new Promise(resolve => server.close(resolve)));
  let base = `http://127.0.0.1:${server.address().port}`;
  let boot = await (await fetch(base + '/api/bootstrap')).json();
  const post = async body => fetch(base + '/api/ai/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify(body) });
  assert.equal((await post({ snapshotId: 'forged' })).status, 400);
  const response = await post({ snapshotId: f.snapshot.id, path: '/arbitrary/requested/path' }); assert.equal(response.status, 202);
  const { id } = await response.json();
  for (let i = 0; i < 500; i++) { const value = await (await fetch(base + '/api/jobs/' + id)).json(); if (value.status !== 'running') { assert.equal(value.status, 'complete', value.error); break; } await delay(10); }
  boot = await (await fetch(base + '/api/bootstrap')).json(); assert.ok(boot.ai.projects?.groups.length);
  const project = boot.ai.projects.groups.find(row => row.path === f.project);
  const details = await (await fetch(base + '/api/ai/projects/' + project.id)).json(); assert.equal(details.group.path, f.project);
  assert.equal((await fetch(base + '/api/ai/projects/not-a-known-id')).status, 400);
  const scope = await (await fetch(base + '/api/ai/project-scopes/logs')).json(); assert.equal(scope.row.samples[0].levels.ERROR, 1);
  const payload = await (await fetch(base + '/api/ai/review-payload?source=ai&snapshotId=' + f.snapshot.id)).json(); assert.equal(JSON.stringify(payload).includes('Project task title'), false);
  const exported = await (await fetch(base + '/api/ai/projects/export')).text(); assert.equal(exported.includes('NEVER_EXPORT'), false);
  await new Promise(resolve => server.close(resolve)); server = await start(); base = `http://127.0.0.1:${server.address().port}`;
  const restored = await (await fetch(base + '/api/bootstrap')).json(); assert.equal(restored.ai.projects.id, boot.ai.projects.id);
});

test('short excerpts redact common credential forms and are plain data', () => {
  const sample = safeExcerpt('api_key=my-private-value password=hunter2 Bearer xyz https://user:pass@host/path sk-abcdefghijklmnopqrstuvwxyz');
  for (const secret of ['my-private-value', 'hunter2', 'xyz', 'user:pass', 'abcdefghijklmnopqrstuvwxyz']) assert.equal(sample.includes(secret), false);
});
