import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents, classifyKnownAiPath } from '../lib/agent-discovery.mjs';
import { scanAiStorage } from '../lib/ai-storage.mjs';

async function fixture(t) {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-discovery-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = async (relative, body = 'PRIVATE_CONTENT_NEVER_READ_OR_RETURNED') => {
    const filename = path.join(home, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, body); return filename;
  };
  return { home, file };
}
const agent = (result, name) => result.agents.find(row => row.name === name);

test('signatures find renamed Grok, Hermes and Comate roots, OpenCode DB and deeply nested Pi project resources', async t => {
  const f = await fixture(t);
  for (const name of ['config.toml', 'active_sessions.json', 'agent_id', 'logs/debug.log']) await f.file('arbitrary/gateway/' + name);
  for (const name of ['config.yaml', 'SOUL.md', 'state.db', 'image_cache/picture']) await f.file('arbitrary/assistant/' + name);
  for (const name of ['.baidu-cx', 'ctrl-servers.json', 'auth/key']) await f.file('arbitrary/editor/' + name);
  await f.file('arbitrary/chat/.grokbot-data-root-v1'); await f.file('arbitrary/opencode-store/opencode.db');
  const deep = 'Projects/' + Array(31).fill('nested').join('/');
  await f.file(deep + '/.pi/settings.json'); await f.file(deep + '/document.md');
  const result = await scanAiStorage({ home: f.home });
  for (const tool of ['Grok', 'Grok Bot', 'Hermes', 'Comate', 'OpenCode', 'Pi']) {
    assert.equal(agent(result.discovery, tool).status, 'data-found', tool);
    assert.ok(agent(result.discovery, tool).evidence.some(row => /signature/.test(row.type)), tool);
  }
  assert.ok(result.items.some(row => row.aiTool === 'Hermes' && row.aiKind === 'cache' && row.path.endsWith('/image_cache')));
  assert.ok(result.items.some(row => row.aiTool === 'Pi' && row.path.endsWith('/.pi')));
  assert.equal(result.items.some(row => row.path.endsWith('/document.md')), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CONTENT_NEVER'), false);
  assert.ok(result.items.every(row => row.selectable === false));
});

test('XDG and agent path overrides discover custom data without exporting environment values or config bodies', async t => {
  const f = await fixture(t);
  const config = await f.file('xdg-config/opencode/opencode.jsonc'); await f.file('xdg-cache/opencode/models.json');
  await f.file('custom/pi/sessions/thread.jsonl'); await f.file('custom/hermes/config.yaml');
  const result = await scanAiStorage({ home: f.home, discoveryOptions: { env: { XDG_CONFIG_HOME: f.home + '/xdg-config', XDG_CACHE_HOME: f.home + '/xdg-cache', PI_CODING_AGENT_DIR: f.home + '/custom/pi', HERMES_HOME: f.home + '/custom/hermes', SECRET_TOKEN: 'not-exported' } } });
  assert.ok(result.items.some(row => row.aiTool === 'OpenCode' && row.aiKind === 'cache'));
  assert.ok(agent(result.discovery, 'Pi').evidence.some(row => row.type === 'environment'));
  assert.equal(JSON.stringify(result).includes('not-exported'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_CONTENT_NEVER'), false);
  assert.equal(await readFile(config, 'utf8'), 'PRIVATE_CONTENT_NEVER_READ_OR_RETURNED');
});

test('installation metadata connects Comate dataFolderName and Pi branded config without executing entrypoints', async t => {
  const f = await fixture(t);
  const resources = 'Applications/Comate.app/Contents/Resources/app/';
  await f.file(resources + 'product.json', JSON.stringify({ applicationName: 'comate', dataFolderName: '.renamed-comate' }));
  await f.file('.renamed-comate/data/db');
  const command = await f.file('tools/pi-fork/dist/cli.js', 'throw new Error("MUST_NOT_EXECUTE")');
  await f.file('tools/pi-fork/package.json', JSON.stringify({ name: 'custom-pi', piConfig: { name: 'tau', configDir: '.tau' } }));
  await f.file('.tau/agent/sessions/thread'); await mkdir(f.home + '/bin'); await symlink(command, f.home + '/bin/pi');
  const result = await discoverAgents({ home: f.home, binaryDirectories: [f.home + '/bin'] });
  assert.ok(agent(result, 'Comate').evidence.some(row => row.type === 'product'));
  assert.ok(agent(result, 'Pi').evidence.some(row => row.type === 'package' && /piConfig/.test(row.detail)));
  assert.ok(result.roots.some(row => row.path === f.home + '/.tau/agent'));
  assert.deepEqual(classifyKnownAiPath(f.home + '/.renamed-comate/data/db', f.home, result.roots), { aiTool: 'Comate', aiKind: 'state' });
  assert.equal(classifyKnownAiPath(f.home + '/.renamed-comate-copy/file', f.home, result.roots), null);
});

test('ASAR root package identity finds a renamed Pi desktop installation without treating SDK dependencies as standalone Pi', async t => {
  const f = await fixture(t);
  const data = Buffer.from(JSON.stringify({ name: '@earendil-works/pi-coding-agent', piConfig: { configDir: '.pi' } }));
  const header = Buffer.from(JSON.stringify({ files: { 'package.json': { size: data.length, offset: '0' } } }));
  const prefix = Buffer.alloc(16); prefix.writeUInt32LE(8 + header.length, 4); prefix.writeUInt32LE(header.length, 12);
  await f.file('Applications/Custom.app/Contents/Resources/app.asar', Buffer.concat([prefix, header, data]));
  let result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Pi').status, 'installed-only');
  await f.file('Applications/Custom.app/Contents/Resources/app.asar', Buffer.from('bad archive'));
  await f.file('Projects/sdk/package.json', JSON.stringify({ name: 'other-app', dependencies: { '@mariozechner/pi-coding-agent': '*' } }));
  result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Pi').status, 'not-found');
});

test('generic instruction files, empty .pi and node dependency fixtures never identify an agent', async t => {
  const f = await fixture(t);
  await f.file('project/AGENTS.md'); await f.file('project/SKILL.md'); await f.file('project/CLAUDE.md');
  await mkdir(f.home + '/project/.pi');
  await f.file('project/node_modules/dependency/.pi/settings.json');
  const result = await discoverAgents({ home: f.home });
  assert.equal(result.roots.length, 0);
  assert.equal(agent(result, 'Pi').status, 'not-found');
  assert.ok(result.coverage.excluded.some(row => row.name === 'node_modules'));
});

test('an isolated OpenCode database identifies exact DB files without swallowing neighbouring project content', async t => {
  const f = await fixture(t);
  await f.file('project/opencode.db'); await f.file('project/opencode.db-wal');
  await f.file('project/valuable-document'); await f.file('project/src/code.js');
  const result = await scanAiStorage({ home: f.home });
  assert.equal(result.files, 2);
  assert.ok(result.items.every(row => row.type === 'file' && row.aiTool === 'OpenCode'));
  assert.equal(classifyKnownAiPath(f.home + '/project/valuable-document', f.home, result.discovery.roots), null);
});

test('Pi global packages outside PATH reveal custom config directories; ordinary project SDK dependencies stay excluded', async t => {
  const f = await fixture(t);
  await f.file('.nvm/versions/node/v24/lib/node_modules/@mariozechner/pi-coding-agent/package.json', JSON.stringify({ name: '@mariozechner/pi-coding-agent', piConfig: { configDir: '.custom-pi' } }));
  await f.file('.custom-pi/agent/sessions/thread');
  const result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Pi').status, 'data-found');
  assert.ok(result.roots.some(row => row.path === f.home + '/.custom-pi/agent'));
  assert.ok(agent(result, 'Pi').evidence.some(row => row.type === 'package' && row.path.includes('/.nvm/')));
  assert.ok(result.coverage.packageDirectories.some(row => row.includes('/.nvm/')));
});

test('a verified OpenClaw Pi TUI library is component-only, protected, and counted under its host', async t => {
  const f = await fixture(t);
  const base = '.local/lib/node_modules/openclaw/';
  await f.file(base + 'package.json', JSON.stringify({ name: 'openclaw', dependencies: { '@earendil-works/pi-tui': '0.85.1' } }));
  const component = base + 'node_modules/@earendil-works/pi-tui/';
  await f.file(component + 'package.json', JSON.stringify({ name: '@earendil-works/pi-tui', version: '0.85.1' }));
  await f.file(component + 'dist/index.js', 'throw new Error("MUST_NOT_EXECUTE")');
  const result = await scanAiStorage({ home: f.home });
  const pi = agent(result.discovery, 'Pi');
  assert.equal(pi.status, 'component-only'); assert.deepEqual(pi.roots, []);
  assert.equal(pi.components.length, 1); assert.equal(pi.components[0].host, 'openclaw');
  assert.equal(pi.components[0].kind, '终端界面库');
  const item = result.items.find(row => row.installedComponent);
  assert.equal(item.aiTool, 'OpenClaw'); assert.equal(item.aiKind, 'state'); assert.equal(item.selectable, false);
  assert.equal(item.files, 2); assert.match(item.reason, /安装组件/);
  assert.equal(JSON.stringify(result).includes('MUST_NOT_EXECUTE'), false);
});

test('a declared but absent Pi dependency and lookalike package names never count as an installed component', async t => {
  const f = await fixture(t);
  await f.file('.local/lib/node_modules/openclaw/package.json', JSON.stringify({ name: 'openclaw', dependencies: { '@earendil-works/pi-tui': '*' } }));
  await f.file('project/node_modules/@earendil-works/pi-tui/package.json', JSON.stringify({ name: 'napi-postinstall' }));
  const result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Pi').status, 'not-found');
  assert.equal(agent(result, 'Pi').components, undefined);
});

test('untrusted package names cannot impersonate a recognized host via JavaScript prototype properties', async t => {
  const f = await fixture(t);
  await f.file('project/package.json', JSON.stringify({ name: '__proto__' }));
  await f.file('project/node_modules/@earendil-works/pi-tui/package.json', JSON.stringify({ name: '@earendil-works/pi-tui', version: '0.1' }));
  await f.file('Applications/Unknown.app/Contents/Resources/package.json', JSON.stringify({ name: 'constructor' }));
  const result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Pi').status, 'component-only');
  assert.ok(result.agents.every(row => typeof row.name === 'string'));
  assert.equal(result.roots.length, 0);
});

test('a complete Pi coding package embedded in a project stays a component without claiming standalone installation', async t => {
  const f = await fixture(t);
  await f.file('project/package.json', JSON.stringify({ name: 'custom-agent-host' }));
  await f.file('project/node_modules/@mariozechner/pi-coding-agent/package.json', JSON.stringify({ name: '@mariozechner/pi-coding-agent', version: '0.1', piConfig: { configDir: '.custom-pi' } }));
  const result = await discoverAgents({ home: f.home });
  const pi = agent(result, 'Pi');
  assert.equal(pi.status, 'component-only'); assert.deepEqual(pi.roots, []);
  assert.equal(pi.components[0].kind, '内嵌编码引擎'); assert.equal(pi.components[0].host, 'custom-agent-host');
  assert.equal(pi.evidence.some(row => row.type === 'package'), false);
});

test('nested ASAR Pi components are identified by their actual manifests, never promoted to standalone Pi', async t => {
  const f = await fixture(t);
  const data = Buffer.from(JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '0.7' }));
  const header = Buffer.from(JSON.stringify({ files: { node_modules: { files: { '@earendil-works': { files: { 'pi-coding-agent': { files: { 'package.json': { size: data.length, offset: '0' } } } } } } } } }));
  const prefix = Buffer.alloc(16); prefix.writeUInt32LE(8 + header.length, 4); prefix.writeUInt32LE(header.length, 12);
  await f.file('Applications/Embedded.app/Contents/Resources/app.asar', Buffer.concat([prefix, header, data]));
  const result = await discoverAgents({ home: f.home });
  const pi = agent(result, 'Pi');
  assert.equal(pi.status, 'component-only'); assert.equal(pi.components[0].host, 'Embedded');
  assert.equal(pi.components[0].path.endsWith('/node_modules/@earendil-works/pi-coding-agent/package.json'), true);
});

test('symlinked signatures and redirected ancestors are not traversed; nested roots count each file once', async t => {
  const f = await fixture(t), outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-outside-')));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(outside + '/hermes');
  for (const marker of ['SOUL.md', 'config.yaml', 'state.db']) await writeFile(outside + '/hermes/' + marker, 'external');
  await symlink(outside + '/hermes', f.home + '/.hermes');
  await f.file('.grok/config.toml'); await f.file('.grok/agent_id'); await f.file('.grok/active_sessions.json');
  const cache = await f.file('.grok/logs/log.txt');
  const result = await scanAiStorage({ home: f.home });
  assert.equal(agent(result.discovery, 'Hermes').status, 'not-found');
  assert.ok(result.discovery.coverage.linksSkipped > 0);
  assert.equal(result.files, 4);
  assert.equal(result.bytes, (await stat(cache)).blocks * 512 * 4);
  assert.equal(result.items.find(row => row.path.endsWith('/logs')).files, 1);
  assert.equal(result.items.find(row => row.path.endsWith('/.grok')).files, 3);
});

test('discovery remains cancellable during project traversal and reports a phase before counting storage', async t => {
  const f = await fixture(t); await f.file('project/.pi/settings.json');
  let cancelled = false;
  await assert.rejects(scanAiStorage({ home: f.home, cancelled: () => cancelled, onProgress: value => { assert.equal(value.phase, 'discover'); cancelled = true; } }), /停止/);
});

test('expanded agent aliases partition runtime logs, nested profile caches and protected session/config data', async t => {
  const f = await fixture(t);
  await f.file('.qoder-cn/logs/debug.log'); await f.file('.qoder-cn/.cache/cache.bin'); await f.file('.qoder-cn/.auth/token');
  await f.file('.dsh/sessions/chat'); await f.file('.serena/serena_config.yml'); await f.file('.serena/language_servers/server'); await f.file('.serena/logs/runtime.log');
  await f.file('Library/Application Support/com.qodercn.app.stable/Partitions/profile/Cache/data');
  await f.file('Library/Application Support/codearts/app-logs/debug.log'); await f.file('Library/Application Support/codearts/secretStorage/token');
  await f.file('Library/Application Support/qianfan-desktop-app/log/debug.log'); await f.file('Library/Application Support/qianfan-desktop-app/auth.json');
  const result = await scanAiStorage({ home: f.home });
  for (const name of ['Qoder', 'DeepSeek dsh', 'Serena', 'CodeArts', 'DuMate / 千帆']) assert.equal(agent(result.discovery, name).status, 'data-found');
  for (const suffix of ['/logs', '/app-logs', '/log']) assert.ok(result.items.some(row => row.path.endsWith(suffix) && row.aiCategory === 'log' && row.aiKind === 'cache'));
  assert.ok(result.items.some(row => row.path.endsWith('/Partitions/profile/Cache') && row.aiCategory === 'cache'));
  assert.equal(result.items.some(row => row.path.endsWith('/.auth') && row.aiKind === 'cache'), false);
  assert.ok(result.items.every(row => row.selectable === false));
  assert.equal(JSON.stringify(result).includes('PRIVATE_CONTENT_NEVER'), false);
});

test('other agent SDKs are detected by actual manifest identity and stay embedded rather than standalone installations', async t => {
  const f = await fixture(t);
  await f.file('project/package.json', JSON.stringify({ name: 'host' }));
  for (const name of ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk', '@opencode-ai/sdk']) await f.file(`project/node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0' }));
  const result = await discoverAgents({ home: f.home });
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) { const row = agent(result, name); assert.equal(row.status, 'component-only'); assert.equal(row.components[0].host, 'host'); assert.deepEqual(row.roots, []); }
});

test('global CLI and IDE extension installations are identified exactly and preserve protected installation files', async t => {
  const f = await fixture(t);
  await f.file('.local/lib/node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2' }));
  await f.file('.comate/extensions/renamed/package.json', JSON.stringify({ publisher: 'baidu', name: 'baidu-cc', version: '2.1' }));
  await f.file('.comate/extensions/continue.continue-fake/package.json', JSON.stringify({ publisher: 'fake', name: 'continue', version: '1.0' }));
  const result = await scanAiStorage({ home: f.home });
  assert.ok(agent(result.discovery, 'DeepSeek dsh').evidence.some(row => row.type === 'package'));
  assert.ok(agent(result.discovery, 'Ducc / Baidu CC').evidence.some(row => row.type === 'extension'));
  assert.equal(agent(result.discovery, 'Continue').status, 'not-found');
  assert.ok(result.items.some(row => row.aiTool === 'Ducc / Baidu CC' && row.installation && row.aiCategory === 'installation' && row.aiKind === 'state'));
  assert.equal(result.files, 3);
});

test('Python tool environments are found from installed distribution headers without exposing package or session bodies', async t => {
  const f = await fixture(t);
  const root = '.local/share/uv/tools/browser-use';
  await f.file(root + '/lib/python3.12/site-packages/browser_use-1.0.dist-info/METADATA', 'Metadata-Version: 2.3\nName: browser-use\nVersion: 1.0\n\nPRIVATE_DISTRIBUTION_BODY');
  const result = await scanAiStorage({ home: f.home });
  assert.ok(agent(result.discovery, 'Browser Use').evidence.some(row => row.type === 'python-package'));
  assert.equal(agent(result.discovery, 'Browser Use').status, 'installed-only');
  assert.equal(result.discovery.coverage.pythonDistributions, 1);
  assert.equal(result.items[0].aiCategory, 'installation');
  assert.equal(JSON.stringify(result).includes('PRIVATE_DISTRIBUTION_BODY'), false);
});

test('compiled agents inside another agent are recorded as host-owned installation files, without executing them', async t => {
  const f = await fixture(t);
  const binary = '.comate/.baidu-cx/baidu-cx/codex/bin/codex';
  await f.file(binary, 'throw new Error("DO_NOT_EXECUTE_THIS_BINARY")'); await f.file('.comate/projects/user-document');
  const result = await scanAiStorage({ home: f.home });
  const codex = agent(result.discovery, 'Codex');
  assert.equal(codex.status, 'component-only'); assert.equal(codex.components[0].host, 'Comate');
  assert.ok(codex.evidence.some(row => row.type === 'embedded-command' && row.confidence === 'medium'));
  const row = result.items.find(row => row.path.endsWith(binary));
  assert.equal(row.aiTool, 'Comate'); assert.equal(row.aiCategory, 'installation'); assert.equal(row.selectable, false);
  assert.equal(result.files, 2); assert.equal(JSON.stringify(result).includes('DO_NOT_EXECUTE_THIS_BINARY'), false);
});

test('a standalone global agent is not duplicated as a component of a generic lib directory', async t => {
  const f = await fixture(t);
  await f.file('.local/lib/node_modules/@anthropic-ai/claude-code/package.json', JSON.stringify({ name: '@anthropic-ai/claude-code', version: '1.0' }));
  const result = await discoverAgents({ home: f.home });
  assert.equal(agent(result, 'Claude Code').status, 'installed-only');
  assert.equal(agent(result, 'Claude Code').components, undefined);
});
