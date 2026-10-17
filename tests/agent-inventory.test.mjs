import test from 'node:test';
import assert from 'node:assert/strict';
import { agentInventory, inventoryCsv } from '../lib/agent-inventory.mjs';
import { supportedTarget, PLAN_TTL } from '../lib/clean-plan.mjs';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const home = '/Users/fixture';
const row = (id, suffix, aiKind = 'cache', aiCategory = aiKind) => ({ id, path: home + suffix, name: suffix.split('/').at(-1), aiTool: 'Fixture Agent', aiKind, aiCategory, bytes: 100, files: 2, selectable: false, reason: '会话 / 配置保留', evidence: [] });
function snapshot(items) { return { id: 'snapshot', createdAt: new Date().toISOString(), complete: true, errorCount: 0, items }; }
function plan(items) { return { id: 'plan', createdAt: new Date().toISOString(), items }; }
const eligible = (id, suffix) => ({ id, path: home + suffix, bytes: 20, files: 1, selectable: true });

test('inventory separates all transient candidates from the exact currently reviewable subset without widening the allowed paths', () => {
  const s = snapshot([row('cache', '/Library/Caches/agent'), row('logs', '/.agent/logs', 'cache', 'log'), row('sessions', '/.agent/sessions', 'state'), { ...row('install', '/.agent/bin', 'state'), installedComponent: true }]);
  const p = plan([eligible('part', '/Library/Caches/agent/old'), eligible('forged', '/.agent/sessions')]);
  const report = agentInventory(s, p);
  assert.equal(report.rows.find(row => row.id === 'cache').status, 'ready');
  assert.equal(report.rows.find(row => row.id === 'cache').cleanableBytes, 20);
  assert.equal(report.rows.find(row => row.id === 'logs').status, 'candidate');
  assert.equal(report.rows.find(row => row.id === 'sessions').status, 'protected');
  assert.equal(report.rows.find(row => row.id === 'install').category, 'installation');
  assert.equal(report.readyItems, 1); assert.equal(report.readyBytes, 20);
  assert.equal(report.cacheBytes, 100); assert.equal(report.logBytes, 100);
  assert.equal(supportedTarget(home + '/.agent/logs', home), false);
});

test('expired, used, stale or unreadable inventories never advertise reviewable cleanup', () => {
  const s = snapshot([row('cache', '/Library/Caches/agent')]);
  const p = plan([eligible('part', '/Library/Caches/agent/old')]);
  for (const expired of [{ ...p, usedBy: 'used' }, { ...p, createdAt: new Date(Date.now() - PLAN_TTL - 1).toISOString() }]) assert.equal(agentInventory(s, expired).readyItems, 0);
  assert.equal(agentInventory({ ...s, stale: true }, p).readyItems, 0);
  assert.equal(agentInventory(snapshot([{ ...s.items[0], skipped: 1 }]), p).rows[0].status, 'unreadable');
  assert.equal(agentInventory(s, null).rows[0].status, 'needs-preview');
  assert.equal(agentInventory(s, { ...p, previewId: 'old' }, Date.now(), 'new').readyItems, 0);
});

test('a broader native plan is not implicitly offered for a narrower discovered directory and totals are deduplicated', () => {
  const s = snapshot([row('narrow', '/Library/Caches/agent/child')]);
  assert.equal(agentInventory(s, plan([eligible('broad', '/Library/Caches/agent')])).readyItems, 0);
  const outer = row('outer', '/Library/Caches/agent');
  const report = agentInventory(snapshot([outer, ...s.items]), plan([eligible('part', '/Library/Caches/agent/child/file')]));
  assert.equal(report.readyItems, 1); assert.equal(report.readyBytes, 20);
});

test('complete CSV preserves literal paths and quotes, escapes formulas, and includes protected and unapproved rows', () => {
  const s = snapshot([{ ...row('a', '/.agent/logs', 'cache', 'log'), aiTool: '=malicious', policy: 'test', evidence: [{ detail: 'quote " and newline\n', path: '/literal' }] }, row('b', '/.agent/sessions', 'state')]);
  const report = agentInventory(s, null), csv = inventoryCsv(report);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=malicious")); assert.ok(csv.includes('"" and newline\n')); assert.ok(csv.includes('/.agent/sessions')); assert.ok(csv.includes('候选，待生成预览'));
  assert.equal(report.rows.length, 2);
});

test('HTTP inventory/export lists all scopes and joins only newly authorized native files, without deleting files or exposing contents', async t => {
  const fixtureHome = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-inventory-http-')));
  t.after(() => rm(fixtureHome, { recursive: true, force: true }));
  const cache = path.join(fixtureHome, 'Library/Caches/com.qodercn.app'), log = path.join(fixtureHome, '.qoder-cn/logs');
  for (const directory of [cache, log, path.join(fixtureHome, '.config/mole')]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(cache, 'cache.bin'), 'PRIVATE_CACHE_CONTENT'); await writeFile(path.join(log, 'debug.log'), 'PRIVATE_LOG_CONTENT');
  const server = createApp({ home: fixtureHome, runtimeDirectory: path.join(fixtureHome, '.runtime'), aiFetch: async () => { throw new Error('fixture offline'); }, previewRunner: (_command, output, done) => {
    (async () => { await writeFile(path.join(fixtureHome, '.config/mole/clean-list.txt'), `=== App caches ===\n${cache}  # 4 KB\n${log}  # 4 KB\n`); output('fixture preview'); done({ code: 0 }); })();
    return { cancel() {} };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, boot = await (await fetch(base + '/api/bootstrap')).json();
  const post = async (route, body) => (await fetch(base + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify(body) })).json();
  async function wait(id) { for (let i = 0; i < 500; i++) { const job = await (await fetch(base + '/api/jobs/' + id)).json(); if (job.status !== 'running') { assert.equal(job.status, 'complete', job.error); return; } await delay(10); } throw new Error('fixture timeout'); }
  const scan = await post('ai/scan', {}); await wait(scan.id);
  const before = await (await fetch(base + '/api/ai/inventory/export')).json(); assert.equal(before.readyItems, 0); assert.ok(before.rows.some(row => row.category === 'log'));
  const preview = await post('mole', { command: 'clean' }); await wait(preview.id); const planning = await post('clean-plan', { previewId: preview.id }); await wait(planning.id);
  const after = await (await fetch(base + '/api/ai/inventory/export')).json();
  assert.equal(after.readyItems, 1); assert.equal(after.rows.find(row => row.path === cache).status, 'ready'); assert.equal(after.rows.find(row => row.path === log).status, 'candidate');
  assert.ok(after.agents.some(row => row.name === 'Qoder'));
  const csv = await fetch(base + '/api/ai/inventory/export?format=csv'); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /\.csv/);
  const text = await csv.text(); assert.ok(text.includes(cache)); assert.ok(text.includes(log)); assert.ok(text.includes('候选，当前未授权')); assert.equal(text.includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(after).includes('PRIVATE_'), false); assert.equal(await readFile(path.join(log, 'debug.log'), 'utf8'), 'PRIVATE_LOG_CONTENT');
  const newer = await post('mole', { command: 'clean' }); await wait(newer.id);
  const superseded = await (await fetch(base + '/api/ai/inventory/export')).json(); assert.equal(superseded.readyItems, 0); assert.equal(superseded.planFresh, false);
});
