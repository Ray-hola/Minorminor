import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat, symlink, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildCleanPlan, publicPlan, parsePreview, supportedTarget, selectPlanItems, executePlan, checkMoleTarget } from '../lib/clean-plan.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minorminor-plan-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cache = path.join(home, 'Library/Caches/MinorFixture');
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'one.cache'), 'one');
  await writeFile(path.join(cache, 'two.cache'), 'two');
  await writeFile(path.join(home, 'keep.txt'), 'keep');
  const contents = `# preview\n=== User essentials ===\n${cache}  # 8KB\n${path.join(home, 'keep.txt')}  # 4KB\n`;
  return { home, cache, contents, runtimeDirectory: path.join(home, '.runtime'), previewId: 'fixture-preview' };
}
const exists = filename => lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const guard = async () => {};

test('preview parsing preserves literal spaces and delimiters; paths never widen to home/documents/root', () => {
  const home = '/Users/fixture';
  const name = `${home}/Library/Caches/a  # b`;
  const parsed = parsePreview(`=== App caches ===\n${name}  # 4KB\n${name}  # 4KB`);
  assert.equal(parsed.length, 1); assert.equal(parsed[0].path, name);
  for (const filename of [home, `${home}/Library/Caches`, `${home}/Documents/Cache/file`, `${home}/.Trash/file`, `${home}/Library/Caches/../../Documents/file`, `${home}2/Library/Caches/file`, `${home}/Library/Caches/a\nb`]) assert.equal(supportedTarget(filename, home), false, filename);
  assert.equal(supportedTarget(`${home}/.npm/_cacache/content-v2`, home), true);
});

test('plans enumerate every nested file, keep covered rows read-only and hide execution identities', async t => {
  const f = await fixture(t);
  const nested = path.join(f.cache, 'nested'); await mkdir(nested);
  for (let i = 0; i < 205; i++) await writeFile(path.join(nested, `file-${i}`), 'x');
  const plan = await buildCleanPlan({ ...f, contents: f.contents + `${nested}  # 820KB, counted under ${f.cache}\n` });
  const item = plan.items[0];
  assert.equal(item.files, 207); assert.equal(item.directories, 2); assert.equal(item.nodes.length, 209);
  assert.equal(plan.items[1].selectable, undefined); assert.match(plan.items[1].blocked, /超出/);
  assert.equal(plan.items[2].coveredBy, item.id);
  assert.equal(publicPlan(plan).items[0].nodes, undefined); assert.equal(publicPlan(plan).items[0].parent, undefined);
});

test('only explicit IDs can delete a selected literal filename; neighbours remain intact', async t => {
  const f = await fixture(t);
  const filename = path.join(f.cache, 'literal $(touch injected) "quote".cache');
  await writeFile(filename, 'literal');
  const plan = await buildCleanPlan({ ...f, contents: `${filename}  # 4KB\n` });
  assert.throws(() => selectPlanItems(plan, ['forged']), /允许清理/);
  assert.throws(() => selectPlanItems(plan, [plan.items[0].id, plan.items[0].id]), /有效/);
  const records = [];
  const result = await executePlan(plan, selectPlanItems(plan, [plan.items[0].id]), { guard, onRecord: row => records.push(row) });
  assert.equal(result.deletedFiles, 1); assert.equal(records.length, 1); assert.equal(records[0].path, filename);
  assert.equal(await exists(filename), false);
  assert.equal(await readFile(path.join(f.cache, 'one.cache'), 'utf8'), 'one');
  assert.equal(await readFile(path.join(f.home, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(await exists(path.join(f.home, 'injected')), false);
});

test('changed directory contents, swapped files and symlinks are retained', async t => {
  const f = await fixture(t);
  const plan = await buildCleanPlan(f);
  await writeFile(path.join(f.cache, 'new.cache'), 'new after review');
  let result = await executePlan(plan, [plan.items[0]], { guard });
  assert.equal(result.deletedFiles, 0); assert.match(result.results[0].reason, /变化/);
  const second = await buildCleanPlan(f);
  await rename(f.cache, f.cache + '-old');
  await symlink(f.cache + '-old', f.cache);
  result = await executePlan(second, [second.items[0]], { guard });
  assert.equal(result.deletedFiles, 0); assert.match(result.results[0].reason, /变化/);
  assert.equal(await exists(path.join(f.cache + '-old', 'new.cache')), true);
});

test('a file created during cleanup survives; no recursive delete can consume it', async t => {
  const f = await fixture(t), plan = await buildCleanPlan(f);
  let created = false;
  const records = [];
  const outcome = await executePlan(plan, [plan.items[0]], { guard, onRecord: async row => {
    records.push(row);
    if (!created && row.type === 'file' && row.status === 'deleted') { created = true; await writeFile(path.join(f.cache, 'unreviewed-new.cache'), 'keep new'); }
  } });
  assert.equal(outcome.deletedFiles, 2); assert.equal(outcome.results[0].status, 'partial');
  assert.equal(await readFile(path.join(f.cache, 'unreviewed-new.cache'), 'utf8'), 'keep new');
  assert.equal(records.some(row => row.path.endsWith('unreviewed-new.cache')), false);
  assert.match(outcome.results[0].reason, /新文件/);
});

test('Mole policy refusal and cancellation retain paths and record explicit reasons', async t => {
  const f = await fixture(t), plan = await buildCleanPlan(f);
  let records = [];
  const refused = await executePlan(plan, [plan.items[0]], { guard: async () => { throw new Error('命中白名单'); }, onRecord: row => records.push(row) });
  assert.equal(refused.deletedFiles, 0); assert.equal(records.length, 3); assert.ok(records.every(row => row.reason === '命中白名单'));
  let stopped = false; records = [];
  const partial = await executePlan(plan, [plan.items[0]], { guard, cancelled: () => stopped, onRecord: row => { records.push(row); stopped = true; } });
  assert.equal(partial.status, 'cancelled'); assert.equal(partial.deletedFiles, 1);
  assert.equal(records.filter(row => row.status === 'skipped').length, 2);
});

test('symlink descendants block the whole item and a real Mole guard remains read-only', async t => {
  const f = await fixture(t);
  await symlink(path.join(f.home, 'keep.txt'), path.join(f.cache, 'link'));
  const plan = await buildCleanPlan(f);
  assert.match(plan.items[0].blocked, /符号链接/);
  await assert.rejects(checkMoleTarget(path.join(f.home, 'Library/Caches'), f.home));
  assert.equal(await readFile(path.join(f.home, 'keep.txt'), 'utf8'), 'keep');
});

test('the real read-only Mole policy adapter permits fixture cleanup and respects a saved whitelist', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.home, '.config/mole'), { recursive: true });
  await writeFile(path.join(f.home, '.config/mole/whitelist'), f.cache + '\n');
  const plan = await buildCleanPlan(f);
  const blocked = await executePlan(plan, [plan.items[0]]);
  assert.equal(blocked.deletedFiles, 0); assert.match(blocked.results[0].reason, /白名单/);
  await writeFile(path.join(f.home, '.config/mole/whitelist'), '');
  const allowed = await executePlan(plan, [plan.items[0]]);
  assert.equal(allowed.deletedFiles, 2); assert.equal(await exists(f.cache), false);
  assert.equal(await readFile(path.join(f.home, 'keep.txt'), 'utf8'), 'keep');
});

async function connect(t, config) {
  const server = createApp(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const boot = await (await fetch(base + '/api/bootstrap')).json();
  return { server, base, post: (endpoint, body) => fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify(body) }) };
}
async function waitJob(base, id) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const value = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (value.status !== 'running') { assert.equal(value.status, 'complete', value.error); return value; }
    await delay(10);
  }
  throw new Error('fixture timed out');
}

test('HTTP plan pagination, exact selection, one-use authorization and receipts survive restart', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 103; i++) await writeFile(path.join(f.cache, `${i}.cache`), 'x');
  let nativeExecutions = 0;
  const config = { ...f, persistState: true, selectionGuard: guard,
    previewRunner: (_command, output, done) => {
      (async () => { await mkdir(path.join(f.home, '.config/mole'), { recursive: true }); await writeFile(path.join(f.home, '.config/mole/clean-list.txt'), f.contents); output('Fixture preview'); done({ code: 0 }); })();
      return { cancel() {} };
    }, cleanupRunner: () => { nativeExecutions++; throw new Error('never run whole clean'); },
  };
  const first = await connect(t, config);
  assert.equal((await first.post('clean-plan', { previewId: 'forged' })).status, 400);
  const preview = await (await first.post('mole', { command: 'clean' })).json(); await waitJob(first.base, preview.id);
  const planning = await (await first.post('clean-plan', { previewId: preview.id })).json(); await waitJob(first.base, planning.id);
  const bootstrap = await (await fetch(first.base + '/api/bootstrap')).json(); const plan = bootstrap.cleanPlan;
  const item = plan.items.find(row => row.selectable);
  const details = await (await fetch(`${first.base}/api/clean-plan/items/${item.id}`)).json();
  assert.equal(details.total, 105); assert.equal(details.files.length, 100); assert.equal(details.hasMore, true);
  const last = await (await fetch(`${first.base}/api/clean-plan/items/${item.id}?offset=100`)).json(); assert.equal(last.files.length, 5);
  const body = { planId: plan.id, ids: [item.id], confirmation: 'DELETE_SELECTED_FILES' };
  assert.equal((await first.post('clean-plan/execute', { ...body, ids: ['forged'] })).status, 400);
  const executed = await (await first.post('clean-plan/execute', body)).json(); await waitJob(first.base, executed.id);
  assert.equal(nativeExecutions, 0); assert.equal(await exists(f.cache), false);
  assert.equal(await readFile(path.join(f.home, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await first.post('clean-plan/execute', body)).status, 400);
  const receipt = await (await fetch(`${first.base}/api/cleanups/${executed.id}/records?offset=100`)).json();
  assert.equal(receipt.total, 106); assert.equal(receipt.records.length, 6); assert.ok(receipt.records.every(row => row.status === 'deleted'));
  await new Promise(resolve => first.server.close(resolve));
  const second = await connect(t, config);
  const restored = await (await fetch(second.base + '/api/bootstrap')).json();
  assert.equal(restored.cleanup.deletedFiles, 105); assert.equal(restored.cleanPlan, null);
  assert.equal((await fetch(`${second.base}/api/cleanups/${executed.id}/export`)).status, 200);
  assert.equal((await second.post('clean-plan/execute', body)).status, 400);
});

test('expired plans and blocked or superseded selections cannot delete', async t => {
  const f = await fixture(t), plan = await buildCleanPlan(f);
  assert.throws(() => selectPlanItems(plan, [plan.items[1].id]), /允许清理/);
  plan.createdAt = new Date(Date.now() - 31 * 60_000).toISOString();
  assert.throws(() => selectPlanItems(plan, [plan.items[0].id]), /过期/);
  assert.equal(await exists(f.cache), true);
});

test('an interrupted service reconstructs confirmed per-file results without resuming deletion', async t => {
  const f = await fixture(t), id = '11111111-1111-4111-8111-111111111111';
  await mkdir(path.join(f.runtimeDirectory, 'cleanups'), { recursive: true });
  await writeFile(path.join(f.runtimeDirectory, 'latest-state.json'), JSON.stringify({ home: f.home, cleanup: { kind: 'selection', jobId: id, status: 'running', createdAt: new Date().toISOString(), results: [{ id: 'row', name: 'Fixture', path: f.cache }] } }));
  await writeFile(path.join(f.runtimeDirectory, 'cleanups', `${id}.jsonl`), JSON.stringify({ itemId: 'row', path: f.cache + '/one.cache', type: 'file', status: 'deleted', bytes: 4096 }) + '\n');
  const app = await connect(t, { ...f, persistState: true });
  const boot = await (await fetch(app.base + '/api/bootstrap')).json();
  assert.equal(boot.cleanup.status, 'interrupted'); assert.equal(boot.cleanup.deletedFiles, 1);
  assert.match(boot.cleanup.error, /不会自动继续/); assert.equal(boot.cleanPlan, null);
  assert.equal(await readFile(path.join(f.cache, 'two.cache'), 'utf8'), 'two');
});
