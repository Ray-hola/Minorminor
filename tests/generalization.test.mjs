import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, zstdCompressSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { inventory } from '../lib/scanner.mjs';
import { scanAiStorage } from '../lib/ai-storage.mjs';
import { analyzeProjects } from '../lib/project-analysis.mjs';
import { measureProjectStorage, projectFileKind, projectFileBlock } from '../lib/project-storage.mjs';
import { createProjectFileBrowser, describeProjectFile } from '../lib/file-inspector.mjs';
import { createAssociationResolver } from '../lib/association-files.mjs';
import { buildCleanPlan, supportedTarget } from '../lib/clean-plan.mjs';
import { agentInventory } from '../lib/agent-inventory.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-portable-user-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const put = async (name, value = 'fixture') => { const filename = path.join(home, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, value); return filename; };
  const scope = { id: 'home', path: home, displayPath: home, stayOnDevice: true };
  return { home, put, scope };
}

test('inventory finds ordinary and nested projects anywhere in a new home without promoting dependencies or backups', async t => {
  const f = await fixture(t);
  for (const filename of ['work/client/app/pom.xml', 'work/client/app/service/go.mod', 'work/client/app/node_modules/dependency/package.json', 'work/client/app/backups/copy/package.json', 'work/client/app/.pytest_tmp/test_case/repo/package.json', 'work/client/app/dist/export/package.json', 'work/client/app/third_party/library/package.json', 'Library/Application Support/App/package.json', '.cache/runtime/package.json', 'tool/plugins/cache/plugin/package.json', 'lib/python/site-packages/pandas/pyproject.toml']) await f.put(filename);
  const disk = await inventory(f.home, f);
  assert.deepEqual(disk.scan.projectRoots.map(row => path.relative(f.home, row.path)), ['work/client/app', 'work/client/app/service']);
  const snapshot = { id: 'empty-ai', items: [] }, report = await analyzeProjects({ ...f, snapshot, projectRoots: disk.scan.projectRoots });
  assert.equal(report.groups.length, 2); assert.ok(report.groups.every(row => row.type === 'project' && !row.agents.length));
  const storage = await measureProjectStorage({ ...f, report });
  assert.ok(storage.groups.every(row => row.directoryStatus === 'complete' && row.totalBytes > 0));
  assert.equal(storage.groups.reduce((sum, row) => sum + row.totalBytes, 0), disk.scan.totalBytes - 4 * 4096);
});

test('renamed Codex profile is discovered by structure, reads its index and recovers a gzip archive without changing the DB', async t => {
  const f = await fixture(t), profile = path.join(f.home, 'profiles/custom-name'), project = path.join(f.home, 'work/sample');
  await f.put('work/sample/package.json', '{}'); await mkdir(profile, { recursive: true });
  const filename = path.join(profile, 'state_19.sqlite'), db = new DatabaseSync(filename);
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,title TEXT,rollout_path TEXT); CREATE TABLE project_roots(project_id TEXT,path TEXT)');
  const original = path.join(profile, 'sessions/old/session-one.jsonl');
  const workspace = path.join(f.home, 'workspace-without-manifest'); await f.put('workspace-without-manifest/data.bin');
  db.prepare('INSERT INTO project_roots VALUES (?,?)').run('workspace', workspace);
  db.prepare('INSERT INTO threads VALUES (?,?,?,?)').run('one', project, 'Task', original); db.close();
  await f.put('profiles/custom-name/archived_sessions/session-one.jsonl.gz', gzipSync(JSON.stringify({ type: 'session_meta', payload: { cwd: project }, message: { content: 'PRIVATE_TRANSCRIPT' } }) + '\n'));
  const before = await readFile(filename), snapshot = await scanAiStorage(f);
  assert.ok(snapshot.discovery.profiles.some(row => row.path === profile && row.agent === 'Codex'));
  const report = await analyzeProjects({ ...f, snapshot }), group = report.groups.find(row => row.path === project);
  assert.equal(report.groups.find(row => row.path === workspace).type, 'workspace');
  assert.equal(group.sessions, 1); assert.equal(group.assets[0].pathResolution, 'archived'); assert.match(group.assets[0].physicalPath, /\.gz$/);
  const storage = await measureProjectStorage({ ...f, report }); assert.equal(storage.associationSummary.recovered, 1);
  assert.equal(storage.groups.find(row => row.path === workspace).directoryStatus, 'workspace');
  assert.equal(storage.groups.find(row => row.path === workspace).totalBytes, 0);
  const browser = createProjectFileBrowser({ ...f, report, storage }); t.after(() => browser.dispose());
  const list = await browser.list({ projectId: group.id, kind: 'session' });
  assert.equal(list.rows[0].format, 'JSONL · GZIP');
  const detail = await browser.inspect(list.rows[0].id);
  assert.equal(detail.fields.find(row => row.name === 'cwd').value, project); assert.equal(JSON.stringify(detail).includes('PRIVATE_TRANSCRIPT'), false);
  assert.deepEqual(await readFile(filename), before);
});

test('all index and session adapters use discovered profiles, including a direct Pi session override and compressed header fallback', async t => {
  const f = await fixture(t), project = path.join(f.home, 'workspace/real-project');
  await f.put('workspace/real-project/pyproject.toml');
  const profiles = [
    ['Hermes', 'data/hermes-renamed'], ['WorkBuddy', 'data/work-renamed'], ['OpenCode', 'data/code-renamed'], ['Grok', 'data/grok-renamed'],
    ['Claude Code', 'data/claude-renamed'], ['Pi', 'data/pi-direct', 'sessions'], ['Codex', 'data/codex-no-index'],
  ].map(([agent, relative, role = 'profile']) => ({ agent, path: path.join(f.home, relative), role }));
  for (const [relative, sql, insert] of [
    ['data/hermes-renamed/state.db', 'CREATE TABLE sessions(id TEXT,cwd TEXT,title TEXT)', 'INSERT INTO sessions VALUES (?,?,?)'],
    ['data/work-renamed/workbuddy.db', 'CREATE TABLE sessions(id TEXT,cwd TEXT,title TEXT)', 'INSERT INTO sessions VALUES (?,?,?)'],
    ['data/code-renamed/opencode.db', 'CREATE TABLE session(id TEXT,directory TEXT,title TEXT)', 'INSERT INTO session VALUES (?,?,?)'],
    ['data/grok-renamed/sessions/session_search.sqlite', 'CREATE TABLE session_docs(session_id TEXT,cwd TEXT,title TEXT)', 'INSERT INTO session_docs VALUES (?,?,?)'],
  ]) {
    const filename = await f.put(relative, ''); const db = new DatabaseSync(filename); db.exec(sql); db.prepare(insert).run('id', project, 'Task'); db.close();
  }
  const header = JSON.stringify({ cwd: project, message: { content: 'PRIVATE_BODY' } }) + '\n';
  await f.put('data/claude-renamed/projects/arbitrary/session.jsonl.gz', gzipSync(header));
  await f.put('data/pi-direct/session.jsonl', header);
  await f.put('data/codex-no-index/archived_sessions/session.jsonl.zst', zstdCompressSync(header));
  const snapshot = { id: 'custom', discovery: { profiles }, items: profiles.map((row, i) => ({ id: String(i), path: row.path, aiTool: row.agent, aiKind: 'state' })) };
  const report = await analyzeProjects({ ...f, snapshot }), group = report.groups.find(row => row.path === project);
  assert.equal(group.sessions, 7); assert.equal(group.agents.length, 7); assert.equal(JSON.stringify(report).includes('PRIVATE_BODY'), false);
  const storage = await measureProjectStorage({ ...f, report });
  assert.equal(storage.groups[0].categories.session.files, 3);
  assert.equal(group.assets.find(row => row.agent === 'Claude Code').associationContainer, path.join(f.home, 'data/claude-renamed/projects/arbitrary'));
});

test('automatic resolution stays within one owner, refuses ambiguous variants and never follows a redirected archive', async t => {
  const f = await fixture(t), root = path.join(f.home, 'owner'), allowed = filename => filename.startsWith(root + path.sep);
  await f.put('owner/sessions/a.jsonl.gz', 'gzip'); await f.put('owner/sessions/a.jsonl.zst', 'zstd');
  await f.put('other/b.jsonl.gz', 'other profile'); await symlink(path.join(f.home, 'other'), path.join(root, 'archive'));
  const resolve = createAssociationResolver({ home: f.home, allowed }), options = { ownerRoot: root, searchRoots: [path.join(root, 'sessions'), path.join(root, 'archive')] };
  assert.equal((await resolve(path.join(root, 'sessions/a.jsonl'), options)).pathResolution, 'ambiguous');
  const missing = path.join(root, 'sessions/b.jsonl'); assert.equal((await resolve(missing, options)).physicalPath, missing);
  const outside = path.join(f.home, 'other/b.jsonl'); assert.equal((await resolve(outside, options)).physicalPath, outside);
});

test('environment discovery and inventory associate project memory automatically and leave lossy path collisions unassigned', async t => {
  const f = await fixture(t), project = path.join(f.home, 'work/new-project');
  for (const name of ['new-project', 'same-name', 'same name']) await f.put(`work/${name}/package.json`, '{}');
  const encoded = filename => filename.replace(/[^a-zA-Z0-9]/g, '-');
  await f.put(`custom-profile/projects/${encoded(project)}/memory/note.md`, '---\nname: Project note\ntype: project\n---\nPRIVATE_BODY');
  await f.put(`custom-profile/projects/${encoded(path.join(f.home, 'work/same-name'))}/memory/note.md`, '# Ambiguous\nPRIVATE_BODY');
  await f.put('custom-pi/session.jsonl', JSON.stringify({ cwd: project }) + '\n');
  const disk = await inventory(f.home, f), snapshot = await scanAiStorage({ ...f, discoveryOptions: { env: { CLAUDE_CONFIG_DIR: path.join(f.home, 'custom-profile'), PI_CODING_AGENT_SESSION_DIR: path.join(f.home, 'custom-pi') } } });
  const report = await analyzeProjects({ ...f, snapshot, projectRoots: disk.scan.projectRoots });
  const group = report.groups.find(row => row.path === project);
  assert.ok(group.assets.some(row => row.kind === 'memory' && row.title === 'Project note'));
  assert.ok(group.assets.some(row => row.agent === 'Pi' && row.kind === 'session'));
  assert.ok(report.unassigned.some(row => row.sourcePath.includes('same-name') && row.explanation.includes('无法唯一')));
  assert.equal(JSON.stringify(report).includes('PRIVATE_BODY'), false);
});

test('virtual machine resources have useful descriptions and cannot be cleaned through a cache parent', async t => {
  const f = await fixture(t), filename = await f.put('Library/Caches/SomeApp/vm-bundle/vm-instances/new/disk.img');
  assert.match(describeProjectFile(filename, 'cache').purpose, /虚拟机磁盘/);
  assert.equal(describeProjectFile(filename, 'cache').canPreview, false);
  assert.equal(projectFileKind(filename, f.home, 'cache').kind, 'other');
  assert.match(projectFileBlock({ path: filename, kind: 'cache' }), /虚拟机/);
  assert.equal(supportedTarget(filename, f.home), false);
  const root = path.join(f.home, 'Library/Caches/SomeApp'), plan = await buildCleanPlan({ home: f.home, previewId: 'preview', contents: root + '  # cache' });
  assert.match(plan.items[0].blocked, /虚拟机/); assert.equal(plan.items[0].selectable, undefined);
  assert.match(describeProjectFile(path.join(f.home, 'vm_bundle/base.img.zst')).purpose, /压缩/);
  const listing = agentInventory({ id: 'vm', items: [{ id: 'vm', path: root, aiKind: 'cache', aiCategory: 'cache', aiTool: 'SomeApp', bytes: 10, storageType: 'virtual-machine', reason: 'Virtual machine' }] });
  assert.equal(listing.rows[0].categoryLabel, '虚拟机运行环境'); assert.equal(listing.rows[0].status, 'protected');
});
