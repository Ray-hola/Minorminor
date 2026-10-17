import { opendir, lstat, realpath, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHarnessDiscovery, genericCategoryNames } from './harness-discovery.mjs';

const run = promisify(execFile);
export const within = (value, parent) => value === parent || value.startsWith(parent + path.sep);
import { agentRules as rules, cacheLeaves, storageCategory, packageIdentities, componentIdentities, extensionIdentities, pythonIdentities, commandIdentities, signatureRules, additionalCaches, installationRoots, installationNames, embeddedCommands } from './agent-catalog.mjs';
export { cacheLeaves } from './agent-catalog.mjs';
const modelTools = new Set(['Ollama', 'Hugging Face', 'PyTorch']);
const ignoredNames = new Set(['node_modules', '.git', '.hg', '.svn', '.Trash', 'vendor', '.venv', 'venv', '__pycache__', '.pnpm-store', '.npm', '.bun', '.runtime']);
const expand = (value, home) => typeof value === 'string' && value.length && !value.includes('\0') ? path.resolve(value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value) : null;
const evidence = (type, filename, detail, confidence = 'high') => ({ type, path: filename, detail, confidence });
const homePackageDirectories = home => ['.local/lib/node_modules', '.npm-global/lib/node_modules', '.bun/install/global/node_modules', 'Library/pnpm/global/5/node_modules', '.local/share/pnpm/global/5/node_modules'].map(relative => path.join(home, relative));
const appTool = name => rules.find(([, , apps = [], bundles = []]) => apps.includes(name) || bundles.includes(name))?.[0];
const cacheKind = (tool, name) => ['cache', 'log'].includes(storageCategory(tool, name)) ? 'cache' : 'state';
const hostTool = name => packageIdentities.get(name);

export function classifyKnownAiPath(filename, home, discoveredRoots = []) {
  // Discovery supplies attribution, never permission to delete a path.
  const found = discoveredRoots.filter(root => within(filename, root.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (found) return { aiTool: found.aiTool, aiKind: found.aiKind };
  if (!within(filename, home)) return null;
  const relative = path.relative(home, filename);
  for (const [tool, roots = [], apps = [], bundles = []] of rules) {
    for (const root of roots) if (within(relative, root)) return { aiTool: tool, aiKind: modelTools.has(tool) || root.endsWith('/models') ? 'model' : 'state' };
    for (const root of additionalCaches.get(tool) || []) if (within(relative, root)) return { aiTool: tool, aiKind: tool === 'LM Studio' ? 'model' : 'cache' };
    for (const name of apps) {
      const base = `Library/Application Support/${name}`;
      if (within(relative, base)) return { aiTool: tool, aiKind: cacheKind(tool, relative.slice(base.length + 1).split('/')[0]) };
    }
    for (const category of ['Caches', 'Logs']) for (const name of [...apps, ...bundles]) {
      const base = `Library/${category}/${name}`;
      if (within(relative, base) || within(relative, base + '.ShipIt')) return { aiTool: tool, aiKind: 'cache' };
    }
  }
  return null;
}

// Known-tool identities use installation metadata and filenames. The separate
// generic collector reads bounded structural samples and discards body values.
async function metadataJson(filename) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024 || await realpath(filename) !== filename) return null;
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch { return null; }
}

async function asarMetadata(filename) {
  let handle;
  try {
    if (await realpath(filename) !== filename) return [];
    handle = await open(filename, 'r');
    const stat = await handle.stat(), prefix = Buffer.alloc(16);
    await handle.read(prefix, 0, 16, 0);
    const length = prefix.readUInt32LE(12), base = 8 + prefix.readUInt32LE(4);
    if (!length || length > 32 * 1024 * 1024 || base < 16 + length || base > stat.size) return [];
    const bytes = Buffer.alloc(length); await handle.read(bytes, 0, length, 16);
    const tree = JSON.parse(bytes.toString()), results = [];
    const pending = [['', tree]];
    while (pending.length) {
      const [name, entry] = pending.pop();
      if (entry.files) { for (const [child, value] of Object.entries(entry.files)) pending.push([name ? `${name}/${child}` : child, value]); continue; }
      const embedded = [...componentIdentities.keys()].some(pkg => name.endsWith(`node_modules/${pkg}/package.json`));
      if (name !== 'package.json' && !embedded) continue;
      const offset = base + Number(entry.offset);
      if (entry.unpacked || !Number.isSafeInteger(offset) || offset < base || entry.size > 1024 * 1024 || offset + entry.size > stat.size) continue;
      const data = Buffer.alloc(entry.size); await handle.read(data, 0, data.length, offset);
      results.push({ value: JSON.parse(data.toString()), path: `${filename}/${name}`, embedded });
    }
    return results;
  } catch { return []; } finally { await handle?.close(); }
}

export async function discoverAgents({ home, env = {}, applicationDirectories = [path.join(home, 'Applications')], binaryDirectories = [], packageDirectories = [], cancelled = () => false, onProgress = () => {}, onError = async () => {} }) {
  const roots = new Map(), profiles = new Map(), agents = new Map(rules.map(([name]) => [name, { name, evidence: [], status: 'not-found' }]));
  const generic = createHarnessDiscovery({ home, env, cancelled, onError, known: filename => {
    for (let current = filename; within(current, home); current = path.dirname(current)) { if (roots.has(current)) return true; if (current === home) break; }
    return false;
  } });
  const exclusions = new Map(), coverage = { directoryCount: 0, linksSkipped: 0, errors: 0, excluded: [], home, applicationDirectories, binaryDirectories, packageDirectories: [], metadataOnly: true, packageManifests: 0, dependencyIndexes: 0, applicationCount: 0, extensionManifests: 0, pythonDistributions: 0 };
  const check = () => { if (cancelled()) throw new Error('AI 专项扫描已停止'); };
  const reportError = async (filename, error) => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return; coverage.errors++; await onError({ path: filename, code: error.code || 'ERROR', reason: error.message }); };
  function note(tool, item) {
    if (!agents.has(tool)) agents.set(tool, { name: tool, evidence: [], status: 'not-found' });
    const rows = agents.get(tool).evidence;
    if (!rows.some(row => row.path === item.path && row.detail === item.detail)) rows.push(item);
  }
  async function add(tool, filename, kind, proof) {
    check(); filename = path.resolve(filename);
    try {
      const stat = await lstat(filename);
      if (stat.isSymbolicLink() || await realpath(filename) !== filename) { coverage.linksSkipped++; return false; }
      if (!stat.isDirectory() && !stat.isFile()) return false;
      note(tool, proof);
      if (!roots.has(filename)) roots.set(filename, { path: filename, aiTool: tool, aiKind: kind, aiCategory: proof.type.startsWith('project-') ? 'project' : kind === 'cache' ? filename.includes('/Library/Logs/') || storageCategory(tool, path.basename(filename)) === 'log' ? 'log' : 'cache' : kind, evidence: [] });
      const root = roots.get(filename);
      if (!root.evidence.some(row => row.path === proof.path && row.detail === proof.detail)) root.evidence.push(proof);
      return true;
    } catch (error) { await reportError(filename, error); return false; }
  }
  async function children(filename) {
    check();
    try {
      if (await realpath(filename) !== filename) { coverage.linksSkipped++; return []; }
      const rows = []; for await (const child of await opendir(filename)) rows.push(child);
      return rows;
    } catch (error) { await reportError(filename, error); return []; }
  }
  async function dataRoot(tool, filename, kind = 'state', proof = evidence('known-path', filename, '已存在的工具标准数据目录', 'medium'), split = false) {
    if (!await add(tool, filename, kind, proof)) return;
    if (kind !== 'state') return;
    if (!proof.type.startsWith('project-')) profiles.set(`${tool}:${filename}`, { path: filename, agent: tool, role: proof.detail.includes('PI_CODING_AGENT_SESSION_DIR') ? 'sessions' : 'profile' });
    const entries = await children(filename);
    for (const entry of entries) if (!entry.isSymbolicLink() && (split || cacheKind(tool, entry.name) === 'cache')) {
      await add(tool, path.join(filename, entry.name), cacheKind(tool, entry.name), proof);
    }
    if (split && entries.length) roots.delete(filename);
    // Nested Electron profiles have separate caches. Never descend into User,
    // sessions, projects, workspace, credentials or arbitrary user folders here.
    const containers = entries.filter(entry => entry.isDirectory() && ['Data', 'Default', 'Library', 'Public', 'Partitions'].includes(entry.name));
    const pending = containers.map(entry => ({ path: path.join(filename, entry.name), profiles: entry.name === 'Partitions' }));
    while (pending.length) {
      check(); const current = pending.pop();
      for (const entry of await children(current.path)) {
        if (entry.isSymbolicLink()) continue;
        const child = path.join(current.path, entry.name), category = storageCategory(tool, entry.name);
        if (['cache', 'log'].includes(category)) await add(tool, child, 'cache', proof);
        else if (entry.isDirectory() && (current.profiles || ['Data', 'Default', 'Library', 'Public', 'Partitions'].includes(entry.name))) pending.push({ path: child, profiles: entry.name === 'Partitions' });
      }
    }
    for (const entry of entries) if (entry.isDirectory() && ['models', '.models'].includes(entry.name)) await add(tool, path.join(filename, entry.name), 'model', proof);
    for (const entry of entries) if (entry.isDirectory() && installationNames.get(tool)?.includes(entry.name)) {
      const child = path.join(filename, entry.name);
      if (await add(tool, child, 'state', proof)) { roots.get(child).installation = true; roots.get(child).aiCategory = 'installation'; }
    }
  }

  // First locate standard anchors and all actual aliases under macOS indexes.
  for (const [tool, locations = [], apps = [], bundles = []] of rules) {
    for (const relative of locations) await dataRoot(tool, path.join(home, relative), modelTools.has(tool) || relative.endsWith('/models') ? 'model' : 'state');
    for (const relative of additionalCaches.get(tool) || []) await dataRoot(tool, path.join(home, relative), tool === 'LM Studio' ? 'model' : 'cache');
    for (const name of apps) await dataRoot(tool, path.join(home, 'Library/Application Support', name), 'state', undefined, true);
    for (const category of ['Caches', 'Logs']) for (const name of [...apps, ...bundles]) for (const suffix of ['', '.ShipIt']) await dataRoot(tool, path.join(home, 'Library', category, name + suffix), 'cache');
  }
  for (const [tool, locations] of installationRoots) for (const relative of locations) {
    const filename = path.join(home, relative), proof = evidence('installation-path', filename, '所属工具的安装文件或运行依赖，保留', 'medium');
    if (await add(tool, filename, 'state', proof)) { roots.get(filename).installation = true; roots.get(filename).aiCategory = 'installation'; }
  }
  const overrides = [
    ['OpenCode', 'OPENCODE_CONFIG_DIR', 'state'], ['OpenCode', 'OPENCODE_CONFIG', 'state'],
    ['Pi', 'PI_CODING_AGENT_DIR', 'state'], ['Pi', 'PI_CODING_AGENT_SESSION_DIR', 'state'],
    ['Hermes', 'HERMES_HOME', 'state'], ['Codex', 'CODEX_HOME', 'state'], ['Claude Code', 'CLAUDE_CONFIG_DIR', 'state'],
  ];
  for (const [tool, key, kind] of overrides) {
    const filename = expand(env[key], home);
    if (filename) await dataRoot(tool, filename, kind, evidence('environment', filename, `${key} 指定的位置`));
  }
  for (const [key, leaf, kind] of [['XDG_CONFIG_HOME', 'opencode', 'state'], ['XDG_DATA_HOME', 'opencode', 'state'], ['XDG_STATE_HOME', 'opencode', 'state'], ['XDG_CACHE_HOME', 'opencode', 'cache']]) {
    const base = expand(env[key], home); if (base) await dataRoot('OpenCode', path.join(base, leaf), kind, evidence('environment', path.join(base, leaf), `${key}/opencode`));
  }

  async function packageIdentity(value, filename, installed = false) {
    if (!value || typeof value !== 'object') return;
    let tool = packageIdentities.get(value.name);
    if (value.piConfig && typeof value.piConfig.configDir === 'string') tool = 'Pi';
    if (!tool) { if (installed) await generic.installation(value, filename, { allowNeutral: true }); return; }
    const proof = evidence('package', filename, `安装包标识：${String(value.name).slice(0, 180)}${value.piConfig ? ' · piConfig' : ''}`);
    note(tool, proof);
    if (installed && !filename.includes('.asar/')) {
      const root = path.dirname(filename);
      if (await add(tool, root, 'state', proof)) { roots.get(root).installation = true; roots.get(root).aiCategory = 'installation'; }
    }
    if (tool === 'Pi') {
      const configName = value.piConfig?.configDir || '.pi';
      if (typeof configName === 'string' && /^\.[a-zA-Z0-9_-]+$/.test(configName)) {
        const appName = typeof value.piConfig?.name === 'string' ? value.piConfig.name.toUpperCase() : 'PI';
        const custom = expand(env[`${appName}_CODING_AGENT_DIR`], home);
        await dataRoot('Pi', custom || path.join(home, configName, 'agent'), 'state', proof);
      }
    }
  }

  async function componentIdentity(value, filename, host) {
    const match = componentIdentities.get(value?.name);
    if (!match) return;
    const [tool, kind] = match;
    if (!agents.has(tool)) agents.set(tool, { name: tool, evidence: [], status: 'not-found' });
    const target = agents.get(tool);
    target.components ||= [];
    if (target.components.some(row => row.path === filename)) return;
    const component = { name: value.name, version: typeof value.version === 'string' ? value.version.slice(0, 80) : '未知版本', path: filename, host: host?.name || '未确定宿主', kind };
    target.components.push(component);
    const proof = evidence('component', filename, `${kind}：${component.name}@${component.version} · 宿主：${component.host}`);
    note(tool, proof);
    const owner = host?.tool || hostTool(host?.name);
    if (owner && !filename.includes('.asar/')) {
      const root = path.dirname(filename);
      if (await add(owner, root, 'state', proof)) { roots.get(root).installedComponent = true; roots.get(root).aiCategory = 'installation'; }
    }
  }
  async function agentModules(directory, host) {
    check(); coverage.dependencyIndexes++;
    for (const pkg of componentIdentities.keys()) {
      const filename = await realpath(path.join(directory, pkg, 'package.json')).catch(() => null);
      if (filename) await componentIdentity(await metadataJson(filename), filename, host);
    }
    const store = path.join(directory, '.pnpm');
    for (const entry of await children(store)) {
      const pkg = [...componentIdentities.keys()].find(name => entry.name.startsWith(name.replace('/', '+') + '@'));
      if (!pkg) continue;
      const filename = await realpath(path.join(store, entry.name, 'node_modules', pkg, 'package.json')).catch(() => null);
      if (filename) await componentIdentity(await metadataJson(filename), filename, host);
    }
  }

  // An installed global package may be absent from this server's PATH. Inspect
  // known package identities in standard npm/Bun/pnpm and version-manager indexes.
  const packages = [...homePackageDirectories(home), ...packageDirectories];
  for (const [base, suffix] of [[path.join(home, '.nvm/versions/node'), 'lib/node_modules'], [path.join(home, '.fnm/node-versions'), 'installation/lib/node_modules']]) {
    for (const entry of await children(base)) if (entry.isDirectory()) packages.push(path.join(base, entry.name, suffix));
  }
  coverage.packageDirectories = [...new Set(packages)];
  for (const directory of coverage.packageDirectories) {
    // Look inside globally installed hosts even when the library is omitted
    // from this process's PATH. Only manifest identities are read.
    for (const entry of await children(directory)) {
      if (entry.name.startsWith('.')) continue;
      const candidates = entry.name.startsWith('@') ? (await children(path.join(directory, entry.name))).map(child => path.join(directory, entry.name, child.name)) : [path.join(directory, entry.name)];
      for (const candidate of candidates) {
        const filename = await realpath(path.join(candidate, 'package.json')).catch(() => null);
        if (!filename) continue;
        const value = await metadataJson(filename);
        if (!value) continue;
        coverage.packageManifests++;
        await packageIdentity(value, filename, true);
        if (!packageIdentities.has(value.name) && componentIdentities.has(value.name)) await componentIdentity(value, filename, { name: '全局组件安装' });
        else await agentModules(path.join(path.dirname(filename), 'node_modules'), { name: typeof value.name === 'string' ? value.name : '未知安装包' });
      }
    }
  }
  for (const [relative, name, tool] of [['.hermes/hermes-agent', 'hermes-agent', 'Hermes'], ['.local/share/hermes-workspace', 'hermes-workspace', 'Hermes'], ['.workbuddy/app', 'WorkBuddy', 'WorkBuddy']]) {
    await agentModules(path.join(home, relative, 'node_modules'), { name, tool });
  }
  for (const [host, tool, relative] of embeddedCommands) {
    const filename = path.join(home, relative);
    try {
      const info = await lstat(filename); if (!info.isFile() || await realpath(filename) !== filename) continue;
      const proof = evidence('embedded-command', filename, `内嵌命令入口：${path.basename(filename)} · 宿主：${host}；未执行，未核验版本`, 'medium');
      note(tool, proof);
      const target = agents.get(tool); target.components ||= [];
      target.components.push({ name: path.basename(filename), version: '未核验', path: filename, host, kind: '内嵌命令入口' });
      if (await add(host, filename, 'state', proof)) { roots.get(filename).installedComponent = true; roots.get(filename).aiCategory = 'installation'; }
    } catch (error) { await reportError(filename, error); }
  }
  // IDE extension identities are checked in actual package manifests, not in
  // extension directory names or unverified dependency declarations.
  const extensionIndexes = ['.vscode/extensions', '.cursor/extensions', '.comate/extensions', '.codearts/extensions', '.trae/extensions', '.trae-cn/extensions', '.qoder/extensions', '.qoder-cn/extensions'];
  coverage.extensionIndexes = extensionIndexes.map(relative => path.join(home, relative));
  for (const index of coverage.extensionIndexes) for (const entry of await children(index)) {
    const filename = await realpath(path.join(index, entry.name, 'package.json')).catch(() => null);
    if (!filename) continue;
    const value = await metadataJson(filename); if (!value) continue;
    coverage.extensionManifests++;
    const extension = `${value.publisher}.${value.name}`.toLowerCase(), tool = extensionIdentities.get(extension);
    if (tool) {
      const proof = evidence('extension', filename, `扩展标识：${extension} · ${typeof value.version === 'string' ? value.version.slice(0, 80) : '未知版本'}`);
      note(tool, proof);
      if (await add(tool, path.dirname(filename), 'state', proof)) { roots.get(path.dirname(filename)).installation = true; roots.get(path.dirname(filename)).aiCategory = 'installation'; }
      for (const [, , apps = []] of rules) for (const app of apps) await dataRoot(tool, path.join(home, 'Library/Application Support', app, 'User/globalStorage', extension), 'state', proof);
    } else await generic.installation(value, filename, { name: extension });
    await agentModules(path.join(path.dirname(filename), 'node_modules'), { name: extension, tool });
  }
  // Read only Name/Version headers in installed Python distribution metadata.
  // Package caches and arbitrary Python projects are not installations.
  coverage.pythonIndexes = ['.local/share/uv/tools', '.local/share/pipx/venvs', 'Library/Application Support/pipx/venvs'].map(relative => path.join(home, relative));
  const environments = [path.join(home, '.hermes/hermes-agent/venv')];
  for (const index of coverage.pythonIndexes) for (const entry of await children(index)) if (entry.isDirectory()) environments.push(path.join(index, entry.name));
  for (const environment of environments) for (const version of await children(path.join(environment, 'lib'))) {
    if (!version.name.startsWith('python')) continue;
    const site = path.join(environment, 'lib', version.name, 'site-packages');
    for (const entry of await children(site)) {
      if (!entry.name.endsWith('.dist-info')) continue;
      const filename = await realpath(path.join(site, entry.name, 'METADATA')).catch(() => null); if (!filename) continue;
      let handle;
      try {
        handle = await open(filename, 'r'); const buffer = Buffer.alloc(65536); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const headers = buffer.subarray(0, bytesRead).toString().split(/\r?\n\r?\n/, 1)[0], name = headers.match(/^Name: (.+)$/m)?.[1]?.trim().toLowerCase().replaceAll('_', '-');
        coverage.pythonDistributions++; const tool = pythonIdentities.get(name);
        if (!tool) { await generic.installation({ name, description: headers.match(/^Summary: (.+)$/m)?.[1] }, filename); continue; }
        const version = headers.match(/^Version: (.+)$/m)?.[1]?.trim().slice(0, 80) || '未知版本';
        const proof = evidence('python-package', filename, `Python 安装包：${name}@${version}`); note(tool, proof);
        if (await add(tool, environment, 'state', proof)) { roots.get(environment).installation = true; roots.get(environment).aiCategory = 'installation'; }
      } catch (error) { await reportError(filename, error); } finally { await handle?.close(); }
    }
  }
  for (const directory of applicationDirectories) for (const child of await children(directory)) {
    check(); if (!child.isDirectory() || !child.name.endsWith('.app')) continue;
    coverage.applicationCount++;
    const bundle = path.join(directory, child.name);
    if (await realpath(bundle).catch(() => '') !== bundle) { coverage.linksSkipped++; continue; }
    const resources = path.join(bundle, 'Contents/Resources'), name = child.name.slice(0, -4);
    let tool = appTool(name), bundleId;
    const plist = path.join(bundle, 'Contents/Info.plist');
    if (process.platform === 'darwin') try { bundleId = (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { timeout: 2000, maxBuffer: 4096 })).stdout.trim(); } catch { /* Optional installation metadata. */ }
    tool = appTool(bundleId) || tool;
    const productFile = path.join(resources, 'app/product.json'), product = await metadataJson(productFile);
    if (product?.applicationName === 'comate') tool = 'Comate';
    if (tool) {
      const proof = evidence('application', plist, `${child.name}${bundleId ? ` · ${bundleId}` : ''}`);
      note(tool, proof);
      if (bundleId) {
        await dataRoot(tool, path.join(home, 'Library/Application Support', bundleId), 'state', proof, true);
        for (const category of ['Caches', 'Logs']) for (const suffix of ['', '.ShipIt']) await dataRoot(tool, path.join(home, 'Library', category, bundleId + suffix), 'cache', proof);
      }
      if (typeof product?.dataFolderName === 'string' && /^\.[\w-]+$/.test(product.dataFolderName)) await dataRoot(tool, path.join(home, product.dataFolderName), 'state', evidence('product', productFile, `dataFolderName = ${product.dataFolderName}`));
    }
    if (!tool && (await lstat(plist).catch(() => null))?.isFile() && await realpath(plist).catch(() => null) === plist) await generic.installation({ name }, plist, { name, bundleId, allowNeutral: true });
    for (const filename of [path.join(resources, 'app/package.json'), path.join(resources, 'package.json')]) {
      const value = await metadataJson(filename);
      await packageIdentity(value, filename, true);
      if (!tool && value) await generic.installation({ ...value, dataFolderName: product?.dataFolderName || value.dataFolderName }, filename, { name, bundleId, allowNeutral: true });
      await agentModules(path.join(path.dirname(filename), 'node_modules'), { name, tool });
    }
    for (const row of await asarMetadata(path.join(resources, 'app.asar'))) {
      if (row.embedded) await componentIdentity(row.value, row.path, { name, tool });
      else { await packageIdentity(row.value, row.path, false); if (!tool && !packageIdentities.has(row.value?.name)) await generic.installation({ ...row.value, dataFolderName: product?.dataFolderName || row.value?.dataFolderName }, row.path, { name, bundleId }); }
    }
  }

  // Inspect executable locations without running the agent. A symlink is evidence
  // of installation only; it is never used as a storage root to traverse or clean.
  for (const directory of binaryDirectories) for (const child of await children(directory)) {
    const tool = commandIdentities.get(child.name);
    if (!tool || child.isDirectory()) continue;
    const filename = path.join(directory, child.name), target = await realpath(filename).catch(() => null);
    if (!target) continue;
    note(tool, evidence('executable', filename, `命令入口${target !== filename ? ` → ${target}` : ''}`, 'medium'));
    let parent = path.dirname(target);
    while (parent !== path.dirname(parent)) {
      const metadata = path.join(parent, 'package.json'), value = await metadataJson(metadata);
      if (value) { await packageIdentity(value, metadata, true); break; }
      parent = path.dirname(parent);
    }
  }

  // Unlimited-depth metadata discovery under home, with explicit, reported
  // exclusions for dependencies, VCS, runtime output and Library indexes above.
  const pending = [home], known = new Set(roots.keys()), device = (await lstat(home)).dev;
  function alreadyKnown(filename) {
    let parent = filename;
    while (true) {
      if (known.has(parent)) return true;
      const next = path.dirname(parent);
      if (next === parent || parent === home) return false;
      parent = next;
    }
  }
  async function visit(current) {
    check();
    let stat;
    try { stat = await lstat(current); } catch (error) { await reportError(current, error); return; }
    if (stat.isSymbolicLink()) { coverage.linksSkipped++; return; }
    if (stat.dev !== device) { exclusions.set('其他挂载卷', (exclusions.get('其他挂载卷') || 0) + 1); return; }
    const entries = await children(current), names = new Set(entries.filter(entry => !entry.isSymbolicLink()).map(entry => entry.name));
    coverage.directoryCount++;
    if (coverage.directoryCount % 100 === 0) onProgress({ phase: 'discover', directories: coverage.directoryCount, currentPath: current });
    let identified = false;
    if (current !== home && [...names].some(name => /^state_\d+\.sqlite$/.test(name)) && (names.has('sessions') || names.has('archived_sessions'))) {
      await dataRoot('Codex', current, 'state', evidence('signature', current, 'Codex 版本化 state 索引与会话目录组合')); identified = true;
    }
    for (const [tool, markers] of signatureRules) {
      if (markers.every(marker => names.has(marker))) {
        await dataRoot(tool, current, 'state', evidence('signature', current, `专属标记组合：${markers.join(' + ')}`)); identified = true;
      }
    }
    if (names.has('opencode.db')) {
      const proof = evidence('signature', path.join(current, 'opencode.db'), 'OpenCode 会话数据库 opencode.db');
      if (names.has('storage') && names.has('tool-output') && current !== home) {
        await dataRoot('OpenCode', current, 'state', proof); identified = true;
      } else {
        // A database copied into a project/backup does not make its neighbours
        // agent data. Attribute only the exact database and its SQLite sidecars.
        for (const name of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm']) if (names.has(name)) await add('OpenCode', path.join(current, name), 'state', proof);
      }
    }
    for (const config of ['opencode.json', 'opencode.jsonc']) if (names.has(config)) await add('OpenCode', path.join(current, config), 'state', evidence('project-config', path.join(current, config), 'OpenCode 项目配置文件名'));
    if (path.basename(current) === '.pi' && ['settings.json', 'extensions', 'prompts', 'themes', 'SYSTEM.md', 'APPEND_SYSTEM.md'].some(marker => names.has(marker))) {
      await dataRoot('Pi', current, 'state', evidence('project-signature', current, '项目 .pi/ 内含 Pi 配置或扩展资源')); identified = true;
    } else if (names.has('sessions') && names.has('models.json') && names.has('settings.json') && names.has('auth.json')) {
      await dataRoot('Pi', current, 'state', evidence('signature', current, 'Pi 数据特征组合：sessions + models.json + settings.json + auth.json', 'medium')); identified = true;
    }
    if (path.basename(current) === '.opencode' && ['plugins', 'plugin', 'skills', 'commands', 'command', 'package.json', 'agents'].some(marker => names.has(marker))) {
      await dataRoot('OpenCode', current, 'state', evidence('project-signature', current, '项目 .opencode/ 内含插件、命令或 agent 资源')); identified = true;
    }
    if (identified && current !== home) return;
    await generic.observe(current, entries);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) { coverage.linksSkipped++; continue; }
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (entry.name === 'node_modules' && !coverage.packageDirectories.includes(child)) {
        const manifest = await metadataJson(path.join(current, 'package.json'));
        await agentModules(child, { name: typeof manifest?.name === 'string' ? manifest.name : path.basename(current) });
      }
      const exclusion = ignoredNames.has(entry.name) ? entry.name : current === home && entry.name === 'Library' ? 'Library（使用应用索引）' : alreadyKnown(child) ? '已识别数据目录（另行统计）' : null;
      if (exclusion) { exclusions.set(exclusion, (exclusions.get(exclusion) || 0) + 1); continue; }
      pending.push(child);
    }
  }
  while (pending.length) {
    check();
    const batch = pending.splice(-24);
    const settled = await Promise.allSettled(batch.map(visit));
    const failure = settled.find(row => row.status === 'rejected');
    if (failure) throw failure.reason;
  }
  // Recheck strong markers at anchored roots too; those were deliberately not
  // descended into by the project-discovery walk.
  for (const [tool, markers] of signatureRules) for (const root of [...roots.values()].filter(root => root.aiTool === tool && root.aiKind === 'state' && !root.installation && !root.installedComponent)) {
    const names = new Set((await children(root.path)).filter(row => !row.isSymbolicLink()).map(row => row.name));
    if (markers.every(marker => names.has(marker))) {
      const proof = evidence('signature', root.path, `专属标记组合：${markers.join(' + ')}`); note(tool, proof); root.evidence.push(proof);
    }
  }
  coverage.excluded = [...exclusions].map(([name, directories]) => ({ name, directories }));
  const inferred = await generic.finish();
  coverage.generic = inferred.coverage;
  coverage.metadataOnly = inferred.coverage.sampledFiles === 0;
  coverage.contentMode = 'bounded-structure';
  coverage.errors += inferred.coverage.errors;
  for (const candidate of inferred.candidates) {
    const tool = `${candidate.name}（候选）`;
    candidate.tool = tool;
    note(tool, evidence('generic-discovery', candidate.path, `自动发现 · ${candidate.confidence === 'high' ? '安装与内容相互印证' : '用途待确认'}`, candidate.confidence));
    const target = agents.get(tool); target.discoveryMode = 'generic'; target.candidateIds ||= []; target.candidateIds.push(candidate.id);
    for (const proof of candidate.evidence) note(tool, proof);
    if (candidate.installationOnly) continue;
    const scopes = [{ path: candidate.path, category: 'state' }, ...candidate.layout.filter(row => within(row.path, candidate.path) && row.category !== 'config')];
    for (const scope of scopes) {
      if (roots.has(scope.path)) continue;
      const kind = ['cache', 'log'].includes(scope.category) ? 'cache' : 'state';
      if (await add(tool, scope.path, kind, evidence('generic-category', scope.path, `结构推断：${genericCategoryNames[scope.category]} · 待确认`, 'medium'))) Object.assign(roots.get(scope.path), { aiCategory: scope.category, discoveryMode: 'generic', candidateId: candidate.id, uncertain: true, confidence: candidate.confidence });
    }
    profiles.set(`${tool}:${candidate.path}`, { path: candidate.path, agent: tool, role: 'profile', generic: true, sessionPaths: candidate.layout.filter(row => row.category === 'session').map(row => row.path) });
  }
  const resultRoots = [...roots.values()];
  for (const agent of agents.values()) {
    agent.roots = resultRoots.filter(root => root.aiTool === agent.name).map(root => root.path);
    agent.status = agent.roots.some(filename => !roots.get(filename).installation && !roots.get(filename).installedComponent) ? 'data-found' : agent.evidence.some(row => !['component', 'embedded-command'].includes(row.type)) ? 'installed-only' : agent.components?.length ? 'component-only' : 'not-found';
  }
  return { version: 5, profiles: [...profiles.values()], roots: resultRoots, agents: [...agents.values()], candidates: inferred.candidates, coverage };
}

export function localDiscoveryOptions(home) {
  if (home !== os.homedir()) return {};
  return { env: process.env, applicationDirectories: ['/Applications', path.join(home, 'Applications')], packageDirectories: ['/opt/homebrew/lib/node_modules', '/usr/local/lib/node_modules'], binaryDirectories: [...new Set([...(process.env.PATH || '').split(path.delimiter).filter(value => path.isAbsolute(value)), path.join(home, '.local/bin'), path.join(home, '.comate/bin'), path.join(home, '.grok/bin'), path.join(home, '.qoder-cn/entry'), path.join(home, '.qoder-cn/bin')])] };
}
