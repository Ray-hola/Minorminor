import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, unlink, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server.mjs';
import { commandSpec } from '../lib/mole.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minorminor-mole-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const runtimeDirectory = path.join(root, 'runtime');
  await mkdir(path.join(home, 'Library/Caches'), { recursive: true });
  const cache = path.join(home, 'Library/Caches/fixture.cache');
  await writeFile(cache, 'disposable fixture cache');
  await writeFile(path.join(home, 'keep.txt'), 'keep this file');
  return { root, home, runtimeDirectory, cache };
}
async function connect(t, config) {
  const server = createApp(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  return { server, base, post: (endpoint, body) => fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': bootstrap.token }, body: JSON.stringify(body) }) };
}
async function waitFor(getValue, predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = await getValue();
    if (predicate(value)) return value;
    await delay(10);
  }
  throw new Error('Fixture operation did not finish');
}
const job = (base, id) => fetch(`${base}/api/jobs/${id}`).then(response => response.json());
const confirm = previewId => ({ previewId, confirmation: 'PERMANENT_MOLE_CLEAN' });

test('preview and real execution have distinct fixed arguments and cannot inherit dry-run/test overrides', () => {
  const preview = commandSpec('clean', 'preview', { MOLE_DRY_RUN: '0', MOLE_TEST_MODE: '1' });
  assert.deepEqual(preview.args.slice(-2), ['clean', '--dry-run']);
  assert.equal(preview.env.MOLE_DRY_RUN, '1');
  const execute = commandSpec('clean', 'execute', { MOLE_DRY_RUN: '1', MOLE_TEST_MODE: '1', MOLE_TEST_TRASH_DIR: '/tmp/unsafe', MO_NO_OPLOG: '1' });
  assert.equal(execute.args.at(-1), 'clean');
  assert.equal(execute.args.includes('--dry-run'), false);
  assert.equal(execute.env.MOLE_DRY_RUN, '0');
  assert.equal(execute.env.MOLE_TEST_MODE, undefined);
  assert.equal(execute.env.MOLE_TEST_TRASH_DIR, undefined);
  assert.equal(execute.env.MOLE_TEST_NO_AUTH, '1');
  assert.equal(execute.env.MO_NO_OPLOG, '0');
  assert.throws(() => commandSpec('optimize', 'execute'), /只允许/);
  assert.throws(() => commandSpec('clean; rm something', 'execute'), /不支持/);
});

test('a disk scan or a forged ID cannot authorize native cleanup', async t => {
  const f = await fixture(t);
  let executions = 0;
  const { post } = await connect(t, { ...f, cleanupRunner: () => { executions++; throw new Error('must not execute'); } });
  assert.equal((await post('mole/execute-clean', { previewId: 'fake' })).status, 400);
  assert.equal((await post('mole/execute-clean', confirm('fake'))).status, 400);
  assert.equal(executions, 0);
  assert.equal(await readFile(f.cache, 'utf8'), 'disposable fixture cache');
});

test('successful fresh preview plus explicit confirmation executes once and only mutates fixture data', async t => {
  const f = await fixture(t);
  let finishPreview, executions = 0;
  const { base, post } = await connect(t, { ...f,
    previewRunner: (_command, output, done) => { finishPreview = done; output('Would clean fixture cache'); return { cancel() {} }; },
    cleanupRunner: (output, done) => {
      executions++;
      unlink(f.cache).then(() => { output('Fixture cleanup complete'); done({ code: 0 }); });
      return { cancel() {} };
    },
  });
  const { id: previewId } = await (await post('mole', { command: 'clean' })).json();
  assert.equal((await post('mole/execute-clean', confirm(previewId))).status, 400);
  finishPreview({ code: 0 });
  assert.equal((await post('mole/execute-clean', { previewId, confirmation: 'WRONG' })).status, 400);
  assert.equal(executions, 0);
  const response = await post('mole/execute-clean', confirm(previewId));
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const executed = await waitFor(() => job(base, id), value => value.status !== 'running');
  assert.equal(executed.status, 'complete');
  assert.equal(executed.mode, 'execute');
  assert.equal(executed.output, 'Fixture cleanup complete');
  assert.equal(executions, 1);
  await assert.rejects(readFile(f.cache), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.home, 'keep.txt'), 'utf8'), 'keep this file');
  assert.equal((await post('mole/execute-clean', confirm(previewId))).status, 409);
  assert.equal(executions, 1);
  const audit = await waitFor(() => readFile(path.join(f.runtimeDirectory, 'mole-actions.jsonl'), 'utf8'), value => value.includes('finished'));
  assert.deepEqual(audit.trim().split('\n').map(line => JSON.parse(line).event), ['confirmed', 'finished']);
});

test('failed and empty previews never enable real execution', async t => {
  const f = await fixture(t);
  let finishPreview, outputPreview, executions = 0;
  const { post } = await connect(t, { ...f,
    previewRunner: (_command, output, done) => { finishPreview = done; outputPreview = output; return { cancel() {} }; },
    cleanupRunner: () => { executions++; throw new Error('must not execute'); },
  });
  let { id } = await (await post('mole', { command: 'clean' })).json();
  outputPreview('Preview failed'); finishPreview({ code: 1 });
  assert.equal((await post('mole/execute-clean', confirm(id))).status, 400);
  ({ id } = await (await post('mole', { command: 'clean' })).json());
  finishPreview({ code: 0 });
  assert.equal((await post('mole/execute-clean', confirm(id))).status, 400);
  assert.equal(executions, 0);
});

test('expired preview cannot authorize execution', async t => {
  const f = await fixture(t);
  let finishPreview, executions = 0;
  const { post } = await connect(t, { ...f,
    previewRunner: (_command, output, done) => { finishPreview = done; output('Would clean fixture cache'); return { cancel() {} }; },
    cleanupRunner: () => { executions++; throw new Error('must not execute'); },
  });
  const { id } = await (await post('mole', { command: 'clean' })).json();
  finishPreview({ code: 0 });
  const now = Date.now() + 31 * 60_000;
  t.mock.method(Date, 'now', () => now);
  const response = await post('mole/execute-clean', confirm(id));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /过期/);
  assert.equal(executions, 0);
});

test('a newer failed preview supersedes an older successful preview', async t => {
  const f = await fixture(t);
  let finishPreview, executions = 0;
  const { post } = await connect(t, { ...f,
    previewRunner: (_command, output, done) => { finishPreview = done; output('Fixture preview'); return { cancel() {} }; },
    cleanupRunner: () => { executions++; throw new Error('must not execute'); },
  });
  const old = await (await post('mole', { command: 'clean' })).json();
  finishPreview({ code: 0 });
  await post('mole', { command: 'clean' }); finishPreview({ code: 1 });
  assert.equal((await post('mole/execute-clean', confirm(old.id))).status, 400);
  assert.equal(executions, 0);
});

test('cancelling a real-clean fixture records partial outcomes without promising rollback', async t => {
  const f = await fixture(t);
  let finishPreview;
  const { base, post } = await connect(t, { ...f,
    previewRunner: (_command, output, done) => { finishPreview = done; output('Would clean fixture'); return { cancel() {} }; },
    cleanupRunner: (output, done) => { output('One fixture operation may have completed'); return { cancel: () => done({ code: null, error: 'stopped' }) }; },
  });
  const { id: previewId } = await (await post('mole', { command: 'clean' })).json();
  finishPreview({ code: 0 });
  const { id } = await (await post('mole/execute-clean', confirm(previewId))).json();
  assert.equal((await post('cancel', { id })).status, 200);
  assert.equal((await job(base, id)).status, 'cancelled');
  const bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  assert.equal(bootstrap.cleanup.kind, 'mole');
  assert.equal(bootstrap.cleanup.status, 'cancelled');
  assert.match(bootstrap.cleanup.output, /may have completed/);
});

test('completed scan statistics survive server restart, without reviving cleanup authorization', async t => {
  const f = await fixture(t);
  const first = await connect(t, { ...f, persistState: true });
  const { id } = await (await first.post('scan', { scope: 'home' })).json();
  await waitFor(() => job(first.base, id), value => value.status === 'complete');
  await waitFor(() => readFile(path.join(f.runtimeDirectory, 'latest-state.json'), 'utf8').catch(() => ''), value => { try { return JSON.parse(value).scan?.count === 2; } catch { return false; } });
  await new Promise(resolve => first.server.close(resolve));
  const second = await connect(t, { ...f, persistState: true });
  const bootstrap = await (await fetch(second.base + '/api/bootstrap')).json();
  assert.equal(bootstrap.scan.count, 2);
  assert.equal(bootstrap.analysis.count, 2);
  assert.equal(bootstrap.jobs[0].restored, true);
  assert.equal(bootstrap.jobs.some(value => value.type === 'mole'), false);
  assert.equal((await second.post('mole/execute-clean', confirm(id))).status, 400);
});
