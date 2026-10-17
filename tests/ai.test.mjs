import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyAiPath, scanAiStorage, ollamaModels, deleteOllamaModel } from '../lib/ai-storage.mjs';
import { validateAiConfig, publicAiConfig, normalizeAdvice, judgeCleanup } from '../lib/ai-advisor.mjs';
import { createApp } from '../server.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-ai-test-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cache = path.join(home, 'Library/Application Support/Claude/Cache');
  await mkdir(cache, { recursive: true });
  await mkdir(path.join(home, '.claude/projects'), { recursive: true });
  await writeFile(path.join(cache, 'cache.bin'), 'regenerable');
  await writeFile(path.join(home, '.claude/projects/session.jsonl'), 'PRIVATE_TRANSCRIPT_MUST_NOT_BE_SENT');
  return { home, cache, runtimeDirectory: path.join(home, '.runtime') };
}
const jsonResponse = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const model = { name: 'fixture:latest', digest: 'sha256-fixture', size: 12000 };

test('AI classification separates caches, models and durable state without prefix matches', () => {
  const home = '/Users/fixture';
  assert.deepEqual(classifyAiPath(home + '/Library/Application Support/Claude/Cache/a', home), { aiTool: 'Claude', aiKind: 'cache' });
  assert.equal(classifyAiPath(home + '/.claude/projects/session.jsonl', home).aiKind, 'state');
  assert.equal(classifyAiPath(home + '/.cache/huggingface/hub/blobs/file', home).aiKind, 'model');
  assert.equal(classifyAiPath(home + '/Library/Caches/Codex/Default/Cache/file', home).aiTool, 'Codex');
  for (const filename of [home + '/.codex-backup/file', home + '/Library/Application Support/Claude Copy/Cache/file', '/Users/other/.claude/file', home + '/Documents/model.gguf']) assert.equal(classifyAiPath(filename, home), null);
});

test('AI scan counts physical storage once, keeps sessions and does not follow links', async t => {
  const f = await fixture(t);
  const hub = path.join(f.home, '.cache/huggingface/hub'); await mkdir(hub, { recursive: true });
  await writeFile(path.join(hub, 'weight.bin'), 'weights');
  await link(path.join(hub, 'weight.bin'), path.join(hub, 'same-weight.bin'));
  await symlink(path.join(f.home, '.claude/projects'), path.join(hub, 'external-link'));
  const snapshot = await scanAiStorage(f);
  assert.equal(snapshot.complete, true);
  const cache = snapshot.items.find(row => row.path === f.cache);
  assert.equal(cache.aiKind, 'cache'); assert.equal(cache.selectable, false);
  const state = snapshot.items.find(row => row.aiTool === 'Claude Code'); assert.equal(state.files, 1); assert.equal(state.aiKind, 'state');
  const weights = snapshot.items.find(row => row.aiTool === 'Hugging Face'); assert.equal(weights.files, 2); assert.equal(weights.bytes, 4096); assert.equal(weights.links, 1);
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_TRANSCRIPT'), false);
  assert.equal(await readFile(path.join(f.home, '.claude/projects/session.jsonl'), 'utf8'), 'PRIVATE_TRANSCRIPT_MUST_NOT_BE_SENT');
});

test('AI scan cancellation does not publish a complete result', async t => {
  const f = await fixture(t); let stopped = false;
  await assert.rejects(scanAiStorage({ ...f, cancelled: () => stopped, onProgress: () => { stopped = true; } }), /停止/);
});

test('model connection validation protects credentials, transport and the local-only Ollama boundary', () => {
  const config = validateAiConfig({ provider: 'compatible', baseUrl: 'https://api.deepseek.com/v1/', model: 'fixture', apiKey: 'test-secret' });
  assert.equal(publicAiConfig(config).configured, true); assert.equal(publicAiConfig(config).apiKey, undefined);
  assert.equal(validateAiConfig({ provider: 'compatible', baseUrl: config.baseUrl, model: 'fixture' }, config).apiKey, 'test-secret');
  assert.equal(validateAiConfig({ provider: 'compatible', baseUrl: 'https://other.example/v1', model: 'fixture' }, config).apiKey, '');
  assert.equal(publicAiConfig(validateAiConfig({ provider: 'compatible', baseUrl: 'http://127.0.0.1:1234/v1', model: 'fixture' })).configured, true);
  for (const input of [
    { provider: 'ollama', baseUrl: 'http://remote.example' },
    { provider: 'compatible', baseUrl: 'http://remote.example' },
    { provider: 'compatible', baseUrl: 'https://key:secret@example.com/v1' },
    { provider: 'compatible', baseUrl: 'https://example.com/v1?key=secret' },
    { provider: 'compatible', baseUrl: 'https://example.com/v1', apiKey: 'bad\nheader' },
  ]) assert.throws(() => validateAiConfig(input));
});

test('AI output cannot add paths, promote protected items to deletion eligibility or omit uncertainty', () => {
  const rows = [{ id: 'protected', path: '/Users/fixture/.claude', name: 'Claude', selectable: false }, { id: 'cache', path: '/Users/fixture/Library/Caches/Cache', name: 'Cache', selectable: true }];
  const result = normalizeAdvice({ items: [{ id: 'protected', recommendation: 'consider', risk: 'low', reason: 'model suggests deletion' }] }, rows);
  assert.equal(result.items[0].recommendation, 'review'); assert.equal(result.items[0].eligible, false); assert.equal(result.items[0].risk, 'high');
  assert.equal(result.items[1].recommendation, 'review'); assert.match(result.items[1].reason, /未返回/);
  assert.throws(() => normalizeAdvice({ items: [{ id: 'forged', recommendation: 'consider', reason: 'delete arbitrary file' }] }, rows), /未知/);
});

test('real AI request construction sends metadata only and no tools, paths or transcript bodies', async t => {
  const f = await fixture(t); const snapshot = await scanAiStorage(f);
  const rows = snapshot.items;
  rows[0].reason = `metadata error at ${f.home}/private/path`;
  let request;
  const result = await judgeCleanup({ home: f.home, rows, config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'fixture', apiKey: '' }, fetcher: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return jsonResponse({ message: { content: JSON.stringify({ summary: 'fixture advice', items: rows.map(row => ({ id: row.id, recommendation: 'keep', risk: 'high', reason: 'retain state', uncertainty: 'metadata only' })) }) } });
  } });
  assert.equal(result.items.length, rows.length);
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat'); assert.equal(request.body.stream, false); assert.equal(request.body.tools, undefined);
  assert.equal(request.options.body.includes(f.home), false); assert.equal(request.options.body.includes('PRIVATE_TRANSCRIPT'), false);
  assert.equal(JSON.stringify(request.body).includes('~/.claude'), true);
});

test('failed or malformed model responses never become successful advice', async () => {
  const options = { home: '/Users/fixture', rows: [{ id: 'a', name: 'a', path: '/Users/fixture/a' }], config: { provider: 'compatible', baseUrl: 'https://example.com/v1', model: 'fixture', apiKey: 'secret' } };
  await assert.rejects(judgeCleanup({ ...options, fetcher: async () => new Response('secret provider error', { status: 401 }) }), /401/);
  await assert.rejects(judgeCleanup({ ...options, fetcher: async () => jsonResponse({ choices: [{ message: { content: '{invalid' } }] }) }), /JSON/);
});

function ollamaFake({ busy = false, changed = false } = {}) {
  const calls = []; let deleted = false;
  const fetcher = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body });
    if (url.endsWith('/api/tags')) return jsonResponse({ models: deleted ? [] : [{ ...model, digest: changed ? 'changed' : model.digest }] });
    if (url.endsWith('/api/ps')) return jsonResponse({ models: busy ? [model] : [] });
    if (url.endsWith('/api/delete')) { assert.equal(options.method, 'DELETE'); assert.deepEqual(JSON.parse(options.body), { model: model.name }); deleted = true; return jsonResponse({}); }
    throw new Error('Unexpected network request');
  };
  return { calls, fetcher };
}
test('Ollama removal uses exact snapshot identity and official API; active or changed models are retained', async () => {
  const good = ollamaFake(); const models = await ollamaModels(good);
  const snapshot = { createdAt: new Date().toISOString(), ollama: { models } };
  const result = await deleteOllamaModel(snapshot, models[0].id, good);
  assert.equal(result.status, 'deleted'); assert.equal(good.calls.filter(row => row.method === 'DELETE').length, 1);
  await assert.rejects(deleteOllamaModel(snapshot, models[0].id, good), /已删除/);
  for (const fake of [ollamaFake({ busy: true }), ollamaFake({ changed: true })]) {
    const candidate = { createdAt: new Date().toISOString(), ollama: { models: [{ id: 'known', ...model }] } };
    await assert.rejects(deleteOllamaModel(candidate, 'known', fake), /正在使用|变化/);
    assert.equal(fake.calls.some(row => row.method === 'DELETE'), false);
  }
});

async function connect(t, config) {
  const server = createApp(config); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, bootstrap = await (await fetch(base + '/api/bootstrap')).json();
  return { server, base, post: (endpoint, body) => fetch(base + '/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': bootstrap.token }, body: JSON.stringify(body) }) };
}
async function waitJob(base, id) {
  for (let i = 0; i < 400; i++) { const value = await (await fetch(base + '/api/jobs/' + id)).json(); if (value.status !== 'running') return value; await delay(10); }
  throw new Error('fixture timeout');
}

test('AI HTTP flow requires metadata consent, preserves user files, and never persists or returns API keys', async t => {
  const f = await fixture(t); let aiCalls = 0;
  const aiFetch = async (url, options) => {
    if (url.includes('/api/tags')) throw new Error('No local fixture Ollama');
    aiCalls++;
    assert.equal(options.headers.Authorization, 'Bearer test-private-key');
    const user = JSON.parse(JSON.parse(options.body).messages[1].content);
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ summary: 'real protocol fixture', items: user.items.map(row => ({ id: row.id, recommendation: 'consider', risk: 'low', reason: 'fixture explanation', uncertainty: 'unknown content' })) }) } }] });
  };
  const first = await connect(t, { ...f, persistState: true, aiFetch });
  const config = { provider: 'compatible', baseUrl: 'https://example.com/v1', model: 'fixture', apiKey: 'test-private-key' };
  const configured = await (await first.post('ai/config', config)).json(); assert.equal(configured.apiKey, undefined);
  const scan = await (await first.post('ai/scan', {})).json(); assert.equal((await waitJob(first.base, scan.id)).status, 'complete');
  const boot = await (await fetch(first.base + '/api/bootstrap')).json();
  const body = { source: 'ai', snapshotId: boot.ai.scan.id, offset: 0 };
  assert.equal((await first.post('ai/review', body)).status, 400); assert.equal(aiCalls, 0);
  assert.equal((await first.post('ai/review', { ...body, snapshotId: 'forged', confirmation: 'SEND_METADATA_FOR_ADVICE' })).status, 400);
  const payload = await (await fetch(`${first.base}/api/ai/review-payload?source=ai&snapshotId=${boot.ai.scan.id}`)).json(); assert.equal(payload.items.length, 2); assert.equal(aiCalls, 0);
  await first.post('ai/config', config);
  assert.equal((await first.post('ai/review', { ...body, configRevision: payload.configRevision, confirmation: 'SEND_METADATA_FOR_ADVICE' })).status, 400);
  assert.equal(aiCalls, 0);
  const refreshedPayload = await (await fetch(`${first.base}/api/ai/review-payload?source=ai&snapshotId=${boot.ai.scan.id}`)).json();
  const judged = await (await first.post('ai/review', { ...body, configRevision: refreshedPayload.configRevision, confirmation: 'SEND_METADATA_FOR_ADVICE' })).json(); assert.equal((await waitJob(first.base, judged.id)).status, 'complete');
  const after = await (await fetch(first.base + '/api/bootstrap')).json();
  assert.equal(aiCalls, 1); assert.equal(after.ai.advice.items.every(row => row.eligible === false), true);
  assert.equal(JSON.stringify(after).includes('test-private-key'), false);
  assert.equal((await readFile(path.join(f.runtimeDirectory, 'ai-settings.json'), 'utf8')).includes('test-private-key'), false);
  assert.equal((await readFile(path.join(f.runtimeDirectory, 'latest-state.json'), 'utf8')).includes('test-private-key'), false);
  assert.equal(await readFile(path.join(f.home, '.claude/projects/session.jsonl'), 'utf8'), 'PRIVATE_TRANSCRIPT_MUST_NOT_BE_SENT');
  await new Promise(resolve => first.server.close(resolve));
  const second = await connect(t, { ...f, persistState: true, aiFetch });
  const restored = await (await fetch(second.base + '/api/bootstrap')).json();
  assert.equal(restored.ai.scan.id, boot.ai.scan.id); assert.equal(restored.ai.config.hasKey, false); assert.equal(restored.ai.config.configured, false);
  assert.equal(restored.ai.advice.items.length, 2);
  assert.equal(restored.jobs.some(row => row.id === boot.ai.scan.jobId), true);
});

test('AI model HTTP endpoint requires confirmation and audits only exact owner-managed removal', async t => {
  const f = await fixture(t), fake = ollamaFake();
  const app = await connect(t, { ...f, aiFetch: fake.fetcher, persistState: true });
  const scan = await (await app.post('ai/scan', {})).json(); await waitJob(app.base, scan.id);
  const boot = await (await fetch(app.base + '/api/bootstrap')).json();
  const body = { scanId: boot.ai.scan.id, modelId: boot.ai.scan.ollama.models[0].id };
  assert.equal((await app.post('ai/ollama/delete', body)).status, 400);
  assert.equal((await app.post('ai/ollama/delete', { ...body, modelId: 'forged', confirmation: 'DELETE_OLLAMA_MODEL' })).status, 400);
  const result = await (await app.post('ai/ollama/delete', { ...body, confirmation: 'DELETE_OLLAMA_MODEL' })).json();
  assert.equal((await waitJob(app.base, result.id)).status, 'complete');
  assert.equal(fake.calls.filter(row => row.method === 'DELETE').length, 1);
  const audit = await readFile(path.join(f.runtimeDirectory, 'ai-model-actions.jsonl'), 'utf8'); assert.deepEqual(audit.trim().split('\n').map(line => JSON.parse(line).event), ['confirmed', 'finished']);
  assert.equal(await readFile(path.join(f.home, '.claude/projects/session.jsonl'), 'utf8'), 'PRIVATE_TRANSCRIPT_MUST_NOT_BE_SENT');
});
