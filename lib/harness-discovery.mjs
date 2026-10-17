import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const inside = (value, root) => value === root || value.startsWith(root + path.sep);
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const privateName = /(?:^|[._/\-])(?:auth|credentials?|secrets?|tokens?|cookies|keychain|keyblob|secretstorage|env)(?:[._/\-]|$)|\.(?:pem|key|p12|pfx)$/i;
const excluded = /(?:^|\/)(?:node_modules|vendor|\.git|\.Trash|\.runtime|\.private-backups|backups?|fixtures?|acceptance-evidence|\.pytest_tmp|\.venv|venv|site-packages|\.ssh|\.gnupg|Keychains)(?:\/|$)/i;
const broadPaths = new Set(['', '.config', '.cache', '.local', '.local/share', '.local/state', 'Library', 'Library/Application Support', 'Library/Caches', 'Library/Logs', 'Desktop', 'Documents', 'Downloads']);
const projectFields = new Set(['cwd', 'workdir', 'working_dir', 'working_directory', 'project_path', 'project_root', 'workspace_path']);
const fields = new Set([...projectFields, 'session_id', 'conversation_id', 'messages', 'role', 'tool_calls', 'tool_call_id', 'function_call', 'tool_result', 'model', 'model_id', 'provider', 'base_url', 'tools']);
const categories = { cache: /^(?:\.?cache|caches|cache[-_]data|tmp|temp|code cache|gpucache)$/i, log: /^(?:logs?|diagnostics)$/i, session: /^(?:sessions?|conversations?|threads?|transcripts?|history)$/i, memory: /^(?:memory|memories|knowledge)$/i, config: /^(?:config|settings|profiles?)$/i };
const featureNames = { 'agent-package': '安装描述含智能体用途', 'model-sdk': '依赖模型 SDK', 'conversation-record': '对话记录结构', 'tool-activity': '工具调用记录', 'model-metadata': '模型配置字段', 'project-reference': '显式项目路径', 'session-header': '会话头' };
export const genericCategoryNames = { cache: '缓存', log: '日志', session: '会话', memory: '记忆', config: '配置', state: '状态与数据' };
const describeFeatures = features => features.map(feature => featureNames[feature] || feature).join(' + ');
export function genericCategory(name) {
  return Object.entries(categories).find(([, pattern]) => pattern.test(name))?.[0] || (/\.(?:log)$/i.test(name) ? 'log' : 'state');
}

// Values are never retained, except explicit local project pointers. Neither
// prompts nor messages, credentials, arbitrary JSON keys or prose reach AI.
export function structuralContent(text, filename) {
  const features = new Set(), keys = new Set(), projects = new Set();
  let visited = 0;
  function visit(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 5 || visited++ > 500) return;
    if (Array.isArray(value)) { for (const row of value.slice(0, 12)) visit(row, depth + 1); return; }
    for (const [rawName, item] of Object.entries(value)) {
      const name = rawName.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()).replaceAll('-', '_');
      if (fields.has(name)) keys.add(name);
      if (projectFields.has(name) && typeof item === 'string' && path.isAbsolute(item) && !/[\x00-\x1f]/.test(item) && item.length < 4096) projects.add(path.normalize(item));
      if (name === 'role' && ['assistant', 'user', 'tool'].includes(item)) features.add('conversation-record');
      if (['tool_calls', 'tool_call_id', 'function_call', 'tool_result'].includes(name)) features.add('tool-activity');
      if (['model', 'model_id', 'provider'].includes(name)) features.add('model-metadata');
      if (name === 'type' && typeof item === 'string' && /^(?:session|session_meta|session_start|tool_call|tool_result|function_call)$/.test(item)) features.add(item.startsWith('session') ? 'session-header' : 'tool-activity');
      if (!['content', 'text', 'prompt', 'system', 'instructions', 'api_key', 'token', 'password'].includes(name)) visit(item, depth + 1);
    }
  }
  if (/\.(?:json|jsonl|ndjson)$/i.test(filename)) {
    try { visit(JSON.parse(text)); } catch { for (const line of text.split('\n').slice(0, 40)) try { visit(JSON.parse(line)); } catch { /* A bounded prefix can end mid-record. */ } }
  } else if (/\.(?:toml|ya?ml)$/i.test(filename)) {
    for (const name of fields) if (new RegExp(`^\\s*["']?${name}["']?\\s*[:=]`, 'm').test(text)) keys.add(name);
    if (keys.has('model') && (keys.has('provider') || keys.has('tools'))) features.add('model-metadata');
  }
  if (projects.size) features.add('project-reference');
  return { features: [...features].sort(), keys: [...keys].sort(), projects: [...projects].sort() };
}

export function createHarnessDiscovery({ home, env = {}, cancelled = () => false, onError = async () => {}, known = () => false, sampleLimit = 4096 }) {
  const candidates = new Map(), installs = [], observed = new Set();
  const homeDevice = lstat(home).then(info => info.dev);
  const coverage = { version: 1, exhaustive: false, directories: 0, sampledFiles: 0, prefixBytes: 0, truncatedFiles: 0, unsupportedFiles: 0, errors: 0, samplesDeferred: 0, sampleLimit, prefixLimit: 16384, libraryDepth: 3 };
  const check = () => { if (cancelled()) throw new Error('AI 专项扫描已停止'); };
  async function failure(filename, error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
    coverage.errors++; await onError({ path: filename, code: error.code || 'HARNESS_READ', reason: error.code === 'EPERM' ? '系统隐私保护阻止读取' : error.code === 'EACCES' ? '文件权限不允许读取' : error.code === 'ERR_SQLITE_ERROR' ? '数据库结构无法解析，保留并标为未知' : '候选工具特征读取失败' });
  }
  async function entries(directory) {
    check();
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== await homeDevice || await realpath(directory) !== directory) return [];
      const result = []; for await (const item of await opendir(directory)) { check(); result.push(item); }
      return result;
    } catch (error) { await failure(directory, error); return []; }
  }
  function anchor(directory) {
    const linked = installs.flatMap(row => row.locations.map(location => ({ ...row, location }))).filter(row => inside(directory, row.location)).sort((a, b) => b.location.length - a.location.length)[0];
    if (linked) return linked.location;
    const relative = path.relative(home, directory), parts = relative.split(path.sep);
    for (const index of ['Library/Application Support', 'Library/Caches', 'Library/Logs', '.config', '.local/share', '.local/state', '.cache']) {
      if (relative.startsWith(index + '/')) return path.join(home, index, relative.slice(index.length + 1).split('/')[0]);
    }
    if (parts[0]?.startsWith('.')) return path.join(home, parts[0]);
    return genericCategory(path.basename(directory)) !== 'state' ? path.dirname(directory) : directory;
  }
  function candidate(root) {
    if (!inside(root, home) || broadPaths.has(path.relative(home, root)) || excluded.test(path.relative(home, root)) || known(root)) return null;
    if (!candidates.has(root)) candidates.set(root, { path: root, features: new Set(), layout: new Map(), evidence: [], samples: [], installations: [] });
    return candidates.get(root);
  }
  function proof(row, type, filename, detail) {
    if (!row.evidence.some(item => item.path === filename && item.type === type && item.detail === detail)) row.evidence.push({ type, path: filename, detail, confidence: 'medium' });
  }
  async function sample(filename) {
    check(); if (privateName.test(filename)) return null;
    if (coverage.sampledFiles >= sampleLimit) { coverage.samplesDeferred++; return null; }
    let handle;
    try {
      const before = await lstat(filename);
      if (!before.isFile() || await realpath(filename) !== filename) return null;
      handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const after = await handle.stat();
      if (before.dev !== after.dev || before.ino !== after.ino) return null;
      if (coverage.sampledFiles >= sampleLimit) { coverage.samplesDeferred++; return null; }
      coverage.sampledFiles++;
      if (/\.(?:db|sqlite|sqlite3)$/i.test(filename)) {
        const header = Buffer.alloc(16), read = await handle.read(header, 0, 16, 0); coverage.prefixBytes += read.bytesRead;
        if (header.toString() !== 'SQLite format 3\0') { coverage.unsupportedFiles++; return { format: 'unknown-database', unsupported: true, features: [], keys: [], projects: [] }; }
        const { DatabaseSync } = await import('node:sqlite'); let db;
        try {
          db = new DatabaseSync(filename, { readOnly: true, enableExtensions: false, timeout: 500 });
          db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
          // No record queries or guessed columns in unknown databases.
          const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' LIMIT 40").all().map(row => row.name);
          const tables = names.filter(name => /^(?:sessions?|conversations?|messages?|threads?|tool_calls?|models?|memories)$/i.test(name));
          return { format: 'sqlite-schema', features: [...(tables.some(name => /session|conversation|message|thread/i.test(name)) ? ['conversation-record'] : []), ...(tables.some(name => /tool_call/i.test(name)) ? ['tool-activity'] : []), ...(tables.some(name => /model/i.test(name)) ? ['model-metadata'] : [])], keys: [], projects: [], tables };
        } finally { db?.close(); }
      }
      const bytes = Buffer.alloc(Math.min(before.size, coverage.prefixLimit)), read = await handle.read(bytes, 0, bytes.length, 0); coverage.prefixBytes += read.bytesRead;
      const truncated = before.size > read.bytesRead; if (truncated) coverage.truncatedFiles++;
      return { format: path.extname(filename).slice(1), truncated, ...structuralContent(bytes.subarray(0, read.bytesRead).toString('utf8'), filename) };
    } catch (error) { await failure(filename, error); return null; } finally { await handle?.close(); }
  }
  async function observe(directory, listing) {
    check();
    if (directory === home || !inside(directory, home) || observed.has(directory) || known(directory) || excluded.test(path.relative(home, directory))) return;
    coverage.directories++;
    const root = anchor(directory), linked = installs.some(row => row.locations.includes(root));
    const kinds = new Set(listing.filter(row => row.isDirectory() && !row.isSymbolicLink()).map(row => genericCategory(row.name)).filter(kind => kind !== 'state'));
    const isSession = path.relative(root, directory).split('/').some(name => genericCategory(name) === 'session');
    const relative = path.relative(home, directory), stateArea = relative.startsWith('.') || relative.startsWith('Library/Application Support/');
    const structuredFiles = stateArea && listing.some(row => row.isFile() && !row.isSymbolicLink() && /\.(?:jsonl|ndjson|db|sqlite|sqlite3)$/i.test(row.name));
    // A plain AGENTS.md, package dependency or cache directory proves nothing.
    if (!linked && kinds.size < 2 && !isSession && !structuredFiles && !candidates.has(root)) return;
    observed.add(directory);
    const row = candidate(root); if (!row) return;
    for (const item of listing) if (item.isDirectory() && !item.isSymbolicLink()) {
      const kind = genericCategory(item.name);
      if (kind !== 'state') row.layout.set(path.join(directory, item.name), kind);
    }
    const currentKind = genericCategory(path.basename(directory)); if (currentKind !== 'state') row.layout.set(directory, currentKind);
    if (kinds.size >= 2) proof(row, 'generic-layout', directory, `目录组合：${[...kinds].sort().map(kind => genericCategoryNames[kind]).join(' + ')}`);
    let count = 0;
    for (const item of listing.filter(item => item.isFile() && !item.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!/\.(?:jsonl|ndjson|json|toml|ya?ml|db|sqlite|sqlite3)$/i.test(item.name) || privateName.test(item.name)) continue;
      if (!isSession && !/^(?:config|settings|profile|state|session|conversation|history|message)/i.test(item.name) && !/\.(?:db|sqlite|sqlite3|jsonl|ndjson)$/i.test(item.name)) continue;
      if (count++ >= 2) { coverage.samplesDeferred++; continue; }
      const filename = path.join(directory, item.name), result = await sample(filename); if (!result) continue;
      for (const feature of result.features) row.features.add(feature);
      if (result.features.length) {
        if (row.samples.length < 24) row.samples.push({ path: filename, category: isSession ? 'session' : currentKind, ...result });
        proof(row, 'generic-content', filename, `结构特征：${describeFeatures(result.features)}${result.tables?.length ? ' · SQLite 表结构' : ''}`);
      } else if (result.unsupported) { if (row.samples.length < 24) row.samples.push({ path: filename, category: currentKind, ...result }); proof(row, 'generic-content', filename, '数据库格式尚未适配，用途待确认'); }
    }
  }
  async function installation(value, filename, { name, bundleId, locations = [], allowNeutral = false } = {}) {
    if (!value || typeof value !== 'object') return;
    const identity = typeof name === 'string' ? name : value.name;
    if (typeof identity !== 'string' || identity.length > 120) return;
    const description = [value.description, ...(Array.isArray(value.keywords) ? value.keywords.filter(word => typeof word === 'string') : [])].filter(word => typeof word === 'string').join(' ').slice(0, 4096);
    const deps = Object.keys({ ...value.dependencies, ...value.optionalDependencies });
    const runtime = /\b(?:agent|harness|assistant|coding|llm|language model)\b|智能体|编程助手/i.test(description);
    const aiDependency = deps.some(dep => /(?:^openai$|anthropic|langchain|ollama|ai-sdk)/i.test(dep));
    if (!runtime && !aiDependency && !allowNeutral) return;
    const safeIdentity = identity.replace(/[\x00-\x1f]/g, '').slice(0, 120);
    const slug = safeIdentity.split('/').pop();
    for (const field of [value.dataFolderName, value.configDir, value.dataDir, value.userDataDir, value.directories?.config, value.directories?.data]) {
      if (typeof field !== 'string' || field.includes('\0')) continue;
      const location = path.resolve(home, field.replace(/^~\//, ''));
      if (inside(location, home) && !broadPaths.has(path.relative(home, location)) && !excluded.test(path.relative(home, location)) && !privateName.test(location)) locations.push(location);
    }
    if (/^[\p{L}\p{N}._ -]+$/u.test(slug) && !['.', '..'].includes(slug)) for (const parent of ['', '.config', '.local/share', '.cache', 'Library/Application Support', 'Library/Caches', 'Library/Logs']) locations.push(path.join(home, parent, parent ? slug : '.' + slug));
    if (/^[\p{L}\p{N}._ -]+$/u.test(slug) && !['.', '..'].includes(slug)) for (const key of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
      const base = env[key]; if (typeof base === 'string' && path.isAbsolute(base) && !base.includes('\0') && inside(path.normalize(base), home)) locations.push(path.join(base, slug));
    }
    if (bundleId && /^[\w.-]+$/.test(bundleId)) for (const parent of ['Library/Application Support', 'Library/Caches', 'Library/Logs']) locations.push(path.join(home, parent, bundleId));
    const record = { name: safeIdentity, path: filename, version: typeof value.version === 'string' ? value.version.slice(0, 80) : null, features: [...(runtime ? ['agent-package'] : []), ...(aiDependency ? ['model-sdk'] : [])], locations: [...new Set(locations)].filter(location => inside(location, home) && location !== home) };
    installs.push(record);
    // Installation is evidence, never an executable to invoke or a directory
    // to delete. Ordinary project package.json files never call this hook.
    for (const location of record.locations) {
      try { const info = await lstat(location); if (!info.isDirectory() || info.dev !== await homeDevice || await realpath(location) !== location) continue; } catch { continue; }
      const row = candidate(location); if (!row) continue;
      row.installations.push({ name: record.name, path: filename, features: record.features, version: typeof value.version === 'string' ? value.version.slice(0, 80) : null });
      for (const feature of record.features) row.features.add(feature);
      proof(row, 'generic-installation', filename, `已安装包 ${safeIdentity} · ${describeFeatures(record.features) || 'AI 用途待核对'}`);
    }
  }
  async function finish() {
    // The home traversal excludes Library; inspect unknown application data
    // shallowly, sharing all directory observations and per-file read budgets.
    const pending = [];
    for (const base of ['Library/Application Support', 'Library/Caches', 'Library/Logs']) for (const item of await entries(path.join(home, base))) if (item.isDirectory() && !item.isSymbolicLink()) pending.push({ directory: path.join(home, base, item.name), depth: 0 });
    for (const record of installs) for (const directory of record.locations) pending.push({ directory, depth: 0 });
    const walked = new Set();
    while (pending.length) {
      check(); const { directory, depth } = pending.pop();
      if (walked.has(directory) || known(directory) || excluded.test(path.relative(home, directory))) continue;
      walked.add(directory); const listing = await entries(directory); await observe(directory, listing);
      if (depth < coverage.libraryDepth) for (const item of listing) if (item.isDirectory() && !item.isSymbolicLink() && !['node_modules', 'Cache', 'Caches', 'cache', 'GPUCache', 'Code Cache', 'blobs', 'models'].includes(item.name)) pending.push({ directory: path.join(directory, item.name), depth: depth + 1 });
    }
    const result = [];
    for (const row of candidates.values()) {
      if (known(row.path)) continue;
      const structure = [...row.features].filter(feature => !['agent-package', 'model-sdk'].includes(feature));
      const hint = row.installations.some(item => item.features.length);
      if (!hint && structure.length < 2 && new Set(row.layout.values()).size < 3) continue;
      const id = digest(row.path), name = row.installations[0]?.name || path.basename(row.path).replace(/^\./, '') || '未命名工具';
      const confidence = structure.length >= 2 && row.installations.length ? 'high' : structure.length >= 2 ? 'medium' : 'low';
      const fingerprint = digest(JSON.stringify({ version: 1, name, installations: row.installations.map(item => [item.name, item.version]), features: [...row.features].sort(), layout: [...new Set(row.layout.values())].sort(), keys: [...new Set(row.samples.flatMap(sample => sample.keys))].sort(), tables: [...new Set(row.samples.flatMap(sample => sample.tables || []))].sort() }));
      result.push({ id, name, path: row.path, confidence, uncertain: true, status: 'pending', fingerprint, features: [...row.features].sort(), evidence: row.evidence, samples: row.samples, installations: row.installations, layout: [...row.layout].map(([path, category]) => ({ path, category })) });
    }
    for (const record of installs) {
      if (!record.features.length) continue;
      if (result.some(row => row.installations.some(item => item.path === record.path))) continue;
      result.push({ id: digest(record.path), name: record.name, path: record.path, installationOnly: true, confidence: 'low', uncertain: true, status: 'pending', fingerprint: digest(JSON.stringify([record.name, record.version, record.features])), features: record.features, installations: [{ name: record.name, path: record.path, features: record.features }], samples: [], layout: [], evidence: [{ type: 'generic-installation', path: record.path, detail: `安装信息含 AI 用途线索；未定位数据目录 · ${describeFeatures(record.features)}`, confidence: 'low' }] });
    }
    const unique = new Map(result.map(row => [row.id, row]));
    return { candidates: [...unique.values()].sort((a, b) => a.path.localeCompare(b.path)), coverage };
  }
  return { observe, installation, finish };
}
