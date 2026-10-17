import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, open, opendir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createCodexSessionResolver } from './association-files.mjs';
import { projectMarkers, projectDirectoryEligible } from './project-discovery.mjs';
import { projectProfiles, databaseAdapters, sessionDirectories } from './project-adapters.mjs';
import { readCompressedSessionPrefix } from './compressed-session.mjs';
import { storagePurpose } from './storage-purpose.mjs';
import { structuralContent } from './harness-discovery.mjs';

const inside = (value, root) => value === root || value.startsWith(root + path.sep);
const key = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const secretName = /(?:^|[._\-/])(?:auth|credentials?|secrets?|tokens?|cookies|keychain|keyblob|secretstorage|\.env)(?:[._\-/]|$)|\.(?:pem|key|p12|pfx)$/i;
const markers = [...projectMarkers];
const backupPart = /\/(?:\.private-backups|backups?|fixtures?|acceptance-evidence)(?:\/|$)/i;
const kinds = { session: '会话记录', memory: '项目记忆', workspace: '工作区索引', scope: '已发现的数据范围' };

// Content is untrusted data. Persist only short, redacted, explicit fields; never
// execute commands, follow instructions, or send excerpts to a model service.
export function safeExcerpt(value, limit = 240) {
  return String(value ?? '').slice(0, 4096)
    .replace(/(?:https?:\/\/)[^\s<>]+/gi, '[链接已省略]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/g, '[凭据已隐藏]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[凭据已隐藏]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie)\s*[=:]\s*[^\s,;}]+/gi, '[凭据字段已隐藏]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export async function analyzeProjects({ home, snapshot, projectRoots = [], cancelled = () => false, onProgress = () => {} }) {
  if (!snapshot || snapshot.stale) throw new Error('请先更新 AI 工具占用快照');
  home = await realpath(home);
  const groups = new Map(), roots = new Set(), seenAssets = new Set(), ownerCache = new Map(), errors = [], annotations = [];
  const manifestRoots = new Set();
  const profiles = projectProfiles(snapshot, home);
  const coverage = { sources: [], contentFiles: 0, prefixBytes: 0, truncatedFiles: 0, skippedLinks: 0, dbRecords: 0, scopeCount: snapshot.items.length, localOnly: true, sessionPrefixLimit: 262144, documentPrefixLimit: 12288, logPrefixLimit: 32768 };
  let completed = 0;
  const check = () => { if (cancelled()) throw new Error('项目归类已停止'); };
  const progress = async currentPath => { check(); onProgress({ completed: ++completed, currentPath, records: coverage.dbRecords, contentFiles: coverage.contentFiles }); await pause(); };
  const error = (filename, e) => { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) errors.push({ path: filename, code: e.code || 'READ_ERROR', reason: safeExcerpt(e.message) }); };
  async function stat(filename) {
    check(); if (!inside(filename, home)) return null;
    try {
      const value = await lstat(filename);
      if (value.isSymbolicLink() || await realpath(filename) !== filename) { coverage.skippedLinks++; return null; }
      return value;
    } catch (e) { error(filename, e); return null; }
  }
  const allowed = filename => snapshot.items.some(row => inside(filename, row.path));
  const resolveCodexSession = createCodexSessionResolver({ home, allowed, cancelled });
  async function prefix(filename, limit) {
    if (secretName.test(filename)) return null;
    const before = await stat(filename);
    if (!before?.isFile()) return null;
    let file;
    try {
      file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const current = await file.stat();
      if (before.dev !== current.dev || before.ino !== current.ino) throw new Error('文件在读取前发生变化');
      if (/\.(?:jsonl|ndjson)\.(?:zst|gz)$/i.test(filename)) {
        const result = await readCompressedSessionPrefix(file, limit, filename.endsWith('.gz') ? 'gzip' : 'zstd');
        coverage.contentFiles++; coverage.prefixBytes += result.bytesRead;
        if (result.truncated) coverage.truncatedFiles++;
        return { text: result.contents.toString('utf8'), truncated: result.truncated, bytesRead: result.bytesRead, size: current.size };
      }
      const buffer = Buffer.alloc(Math.min(current.size, limit));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      coverage.contentFiles++; coverage.prefixBytes += bytesRead;
      if (current.size > bytesRead) coverage.truncatedFiles++;
      return { text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: current.size > bytesRead, bytesRead, size: current.size };
    } catch (e) { error(filename, e); return null; } finally { await file?.close(); }
  }
  async function children(directory) {
    if (!(await stat(directory))?.isDirectory()) return [];
    try { const values = []; for await (const entry of await opendir(directory)) { check(); if (entry.isSymbolicLink()) { coverage.skippedLinks++; continue; } values.push(entry); } return values; }
    catch (e) { error(directory, e); return []; }
  }
  async function* files(directory) {
    const pending = [directory];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of await children(current)) {
        const filename = path.join(current, entry.name);
        if (entry.isDirectory() && !['node_modules', '.git', 'vendor', 'security', 'auth'].includes(entry.name)) pending.push(filename);
        else if (entry.isFile()) yield filename;
      }
    }
  }
  async function owner(raw) {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\0')) return null;
    const original = path.normalize(raw);
    // A package.json inside a captured test home is a fixture component, not a
    // new user project. Keep it under the enclosing project's backup section.
    const boundary = inside(original, home) ? original.match(backupPart) : null;
    const filename = boundary ? original.slice(0, boundary.index) : original;
    if (ownerCache.has(filename)) return ownerCache.get(filename);
    let root = filename;
    // A stronger nested manifest wins over an enclosing workspace registration.
    if (inside(filename, home) && !secretName.test(filename)) {
      const info = await stat(filename);
      let directory = info?.isFile() ? path.dirname(filename) : filename;
      if (info) for (;;) {
        let found = false;
        for (const marker of markers) if (await stat(path.join(directory, marker))) { found = true; break; }
        if (found || roots.has(directory)) { root = directory; if (found) { roots.add(directory); manifestRoots.add(directory); } break; }
        if (directory === home || !inside(path.dirname(directory), home)) break;
        directory = path.dirname(directory);
      }
    }
    ownerCache.set(filename, root); return root;
  }
  async function groupFor(raw) {
    const root = await owner(raw);
    if (!root) return null;
    const id = key(root);
    if (!groups.has(id)) {
      const info = inside(root, home) ? await stat(root) : null;
      const broad = root === home || path.dirname(root) === home && !manifestRoots.has(root);
      groups.set(id, { id, path: root, name: path.basename(root), exists: !!info, type: broad ? 'workspace' : !inside(root, home) ? 'external' : info ? 'project' : 'missing', description: '', evidence: [], assets: [], scopeIds: [], agents: [], sessions: 0 });
    }
    return groups.get(id);
  }
  async function asset(raw, value) {
    const group = await groupFor(raw); if (!group) return null;
    const identity = `${value.agent}:${value.kind}:${value.sourcePath}:${value.recordId || ''}`;
    if (seenAssets.has(identity)) return group;
    seenAssets.add(identity);
    const physical = value.physicalPath && allowed(value.physicalPath) ? await stat(value.physicalPath) : null;
    const row = { id: key(identity), kindLabel: kinds[value.kind], ...value, workingDirectory: path.normalize(raw), title: safeExcerpt(value.title), explanation: safeExcerpt(value.explanation + (path.normalize(raw) !== group.path ? ' 按最近的项目根目录归类；原始工作目录另列。' : ''), 600), physicalBytes: physical?.isFile() ? physical.blocks * 512 : null };
    group.assets.push(row); if (!group.agents.includes(value.agent)) group.agents.push(value.agent);
    if (value.kind === 'session') group.sessions++;
    return group;
  }
  async function database(filename, agent, table, columns, cwdColumn, kind = 'session') {
    if (!allowed(filename) || !(await stat(filename))?.isFile()) return false;
    const source = { agent, path: filename, table, status: 'reading', records: 0 };
    coverage.sources.push(source);
    let db;
    try {
      const { DatabaseSync } = await import('node:sqlite');
      db = new DatabaseSync(filename, { readOnly: true, enableExtensions: false, timeout: 1500 });
      db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN;');
      const schema = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name));
      if (!schema.has(cwdColumn)) throw new Error(`不支持的 ${table} 表结构，未读取正文`);
      const chosen = columns.filter(column => schema.has(column));
      const select = chosen.map(column => ['title', 'name', 'display_name'].includes(column) ? `substr("${column}",1,240) AS "${column}"` : `"${column}"`).join(',');
      const query = db.prepare(`SELECT ${select} FROM "${table}" LIMIT 500 OFFSET ?`);
      for (let offset = 0; ; offset += 500) {
        check(); const rows = query.all(offset);
        for (const row of rows) {
          const cwd = row[cwdColumn];
          if (kind === 'workspace' && typeof cwd === 'string') roots.add(path.normalize(cwd));
          const physical = agent === 'Codex' && kind === 'session' ? await resolveCodexSession(filename, row.rollout_path) : { physicalPath: row.rollout_path };
          const entry = { agent, kind, sourcePath: filename, recordId: String(row.id || row.session_id || cwd || source.records), title: row.title || row.name || row.display_name || '', ...physical, explanation: `${table}.${cwdColumn} 记录工作目录；${kind === 'session' ? '这是会话索引，保留对话与恢复状态' : '这是项目 / 工作区登记记录'}。数据库本体由多个项目共享，不按行推算可释放空间。${physical.pathResolution && physical.pathResolution !== 'ambiguous' ? '已找到索引对应的压缩 / 归档会话，按实际文件统计。' : ''}` };
          if (!await asset(cwd, entry)) annotations.push({ ...entry, title: safeExcerpt(entry.title), status: 'unknown', explanation: `${table}.${cwdColumn} 未提供有效的绝对目录；保留此记录，归属待确认。` });
          source.records++; coverage.dbRecords++;
        }
        await progress(filename);
        if (rows.length < 500) break;
      }
      source.status = 'complete'; return true;
    } catch (e) { source.status = 'unreadable'; error(filename, e); return false; } finally { db?.close(); }
  }

  // Explicit, versioned adapters read only directory/title/index columns. In
  // particular OpenCode's accounts/credentials and message tables are untouched.
  // Ordinary projects are discovered during the same full disk inventory.
  for (const found of projectRoots) {
    if (!projectDirectoryEligible(found.path, home) || profiles.some(profile => inside(found.path, profile.path)) || snapshot.items.some(row => (row.installation || row.installedComponent) && inside(found.path, row.path))) continue;
    if (!(await stat(found.path))?.isDirectory()) continue;
    roots.add(found.path);
    manifestRoots.add(found.path);
    const group = await groupFor(found.path);
    if (group) group.evidence.push({ path: found.path, field: '项目标记', markers: found.markers });
  }
  for (const profile of profiles.filter(row => row.agent === 'Codex')) {
    const versions = (await children(profile.path)).filter(entry => /^state_\d+\.sqlite$/.test(entry.name)).sort((a, b) => Number(b.name.match(/\d+/)[0]) - Number(a.name.match(/\d+/)[0]));
    if (versions[0]) {
      const filename = path.join(profile.path, versions[0].name);
      await database(filename, 'Codex', 'project_roots', ['project_id', 'path'], 'path', 'workspace');
      await database(filename, 'Codex', 'threads', ['id', 'cwd', 'title', 'rollout_path'], 'cwd');
    }
  }
  for (const profile of profiles) for (const [relative, table, columns, cwd, kind] of databaseAdapters[profile.agent] || []) await database(path.join(profile.path, relative), profile.agent, table, columns, cwd, kind);

  // Add shallow directory names to disambiguate Claude/Comate's lossy encoding.
  const knownPaths = new Set([...roots, ...[...groups.values()].map(group => group.path)]);
  knownPaths.add(home);
  for (const root of [...knownPaths]) for (let parent = path.dirname(root); inside(parent, home); parent = path.dirname(parent)) { knownPaths.add(parent); if (parent === home) break; }
  for (const entry of await children(home)) if (entry.isDirectory() && !entry.name.startsWith('.')) knownPaths.add(path.join(home, entry.name));
  const encoded = new Map();
  for (const root of knownPaths) {
    const name = root.replace(/[^a-zA-Z0-9]/g, '-');
    for (const variant of [name, name.replace(/^-/, '')]) {
      if (!encoded.has(variant)) encoded.set(variant, []);
      encoded.get(variant).push(root);
    }
  }
  const sessionSources = profiles.flatMap(profile => profile.generic ? (profile.sessionPaths || []).filter(directory => inside(directory, profile.path)).map(directory => ({ ...profile, directory, encoded: false })) : (profile.role === 'sessions' ? [''] : sessionDirectories[profile.agent] || []).map(relative => ({ ...profile, directory: path.join(profile.path, relative), encoded: relative === 'projects' })));
  const seenSources = new Set();
  for (const { directory, agent, path: profilePath, encoded: projectContainer, generic } of sessionSources) {
    if (seenSources.has(directory)) continue;
    seenSources.add(directory);
    if (!allowed(directory) || !(await stat(directory))?.isDirectory()) continue;
    // Codex's SQLite index already points to its rollouts; use header fallback
    // only when that index was unavailable, avoiding duplicate session counts.
    if (agent === 'Codex' && coverage.sources.some(row => row.agent === 'Codex' && path.dirname(row.path) === profilePath && row.table === 'threads' && row.status === 'complete')) continue;
    const source = { agent, path: directory, status: 'complete', records: 0, method: '会话头与项目目录；正文只抽读前 256 KiB' }; coverage.sources.push(source);
    for await (const filename of files(directory)) {
      const local = path.relative(directory, filename).split(path.sep), candidates = encoded.get(local[0]) || [];
      let cwd = candidates.length === 1 ? candidates[0] : null, title = '', method = cwd ? '项目目录编码与现存 / 已登记的唯一完整路径匹配' : '';
      const associationContainer = projectContainer && local.length > 1 ? path.join(directory, local[0]) : undefined;
      if (/\.(?:jsonl|ndjson)(?:\.(?:zst|gz))?$/i.test(filename) && !/rollback|prompt_history/.test(filename)) {
        const head = await prefix(filename, coverage.sessionPrefixLimit);
        if (!head) continue;
        const cwdReferences = new Set();
        if (generic) {
          const features = structuralContent(head.text, filename.replace(/\.(?:gz|zst)$/i, ''));
          for (const reference of features.projects) cwdReferences.add(reference);
          if (cwdReferences.size === 1) { cwd = [...cwdReferences][0]; method = '自动发现的会话结构与唯一显式项目路径；工具身份待确认'; }
        }
        for (const line of head.text.split('\n')) {
          if (generic) break;
          let record; try { record = JSON.parse(line); } catch { continue; }
          const explicit = record.cwd || (record.type === 'session_meta' ? record.payload?.cwd : null);
          if (typeof explicit === 'string' && explicit.startsWith('/') && !explicit.includes('\0')) { cwdReferences.add(path.normalize(explicit)); if (cwdReferences.size === 1) { cwd = explicit; method = '会话头中首个 cwd 字段'; } }
          if (record.type === 'custom-title' || record.type === 'ai-title') title ||= record.customTitle || record.aiTitle || '';
        }
        if (cwd) {
          // WorkBuddy's database and JSONL use the same session UUID.
          const recordId = path.basename(filename).replace(/\.(?:jsonl|ndjson)(?:\.(?:zst|gz))?$/i, '');
          const group = await groupFor(cwd);
          const existing = group?.assets.find(row => row.agent === agent && row.kind === 'session' && row.recordId === recordId && inside(row.sourcePath, profilePath));
          if (existing) { const info = await stat(filename); existing.physicalPath = filename; existing.physicalBytes = info?.blocks * 512 || 0; existing.associationContainer = associationContainer; existing.cwdReferences = [...cwdReferences]; }
          else await asset(cwd, { agent, kind: 'session', sourcePath: filename, physicalPath: filename, recordId, title, associationContainer, cwdReferences: [...cwdReferences], generic: !!generic, uncertain: !!generic, explanation: `${method}；这是对话 / 工具调用的会话文件，默认保留。只读取前 ${head.bytesRead} 字节的目录与标题字段${head.truncated ? '，后续正文未读取' : ''}。${cwdReferences.size > 1 ? '样本包含多个工作目录，按首个目录归类，不代表整个会话只属于此项目。' : ''}` });
          source.records++;
        } else annotations.push({ sourcePath: filename, status: 'unknown', explanation: '会话头未找到 cwd，目录编码无法唯一还原；不猜测项目归属。' });
      } else if (filename.endsWith('.md') && local.includes('memory')) {
        if (!cwd) { annotations.push({ sourcePath: filename, status: 'unknown', explanation: '项目记忆目录编码无法唯一还原；未读取正文。' }); continue; }
        const head = await prefix(filename, coverage.documentPrefixLimit);
        const heading = head?.text.split('\n').find(line => /^#\s+/.test(line));
        const frontmatter = head?.text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
        const field = name => { const value = frontmatter.match(new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, 'm'))?.[1]?.trim() || ''; return /^[>|]/.test(value) ? '' : safeExcerpt(value.replace(/^['"]|['"]$/g, '')); };
        const description = field('description'), type = field('type');
        await asset(cwd, { agent, kind: 'memory', sourcePath: filename, physicalPath: filename, associationContainer, title: field('name') || heading?.replace(/^#+\s*/, '') || path.basename(filename), explanation: `${method}；项目记忆 / 笔记，读取标题与 frontmatter 指定字段，保留。${description ? '内容说明：' + description + '。' : ''}${type ? '记忆类型：' + type + '。' : ''}${head?.truncated ? '正文为抽读。' : ''}` }); source.records++;
      }
      if (source.records % 100 === 0) await progress(filename);
    }
  }
  for (const profile of profiles.filter(row => row.agent === 'Grok')) {
    const grokDirectory = path.join(profile.path, 'sessions');
    if (allowed(grokDirectory)) for (const entry of await children(grokDirectory)) if (entry.isDirectory()) {
      let cwd; try { cwd = decodeURIComponent(entry.name); } catch { continue; }
      if (!cwd.startsWith('/')) continue;
      for (const session of await children(path.join(grokDirectory, entry.name))) if (session.isDirectory()) {
        const filename = path.join(grokDirectory, entry.name, session.name, 'summary.json'), head = await prefix(filename, 32768);
        let data; try { data = JSON.parse(head?.text); } catch { continue; }
        const group = await groupFor(data.info?.cwd || cwd);
        if (!group?.assets.some(row => row.agent === 'Grok' && row.recordId === session.name)) await asset(data.info?.cwd || cwd, { agent: 'Grok', kind: 'session', sourcePath: filename, physicalPath: filename, recordId: session.name, title: data.generated_title, explanation: 'Grok summary.json 的 info.cwd / URL 编码目录记录工作目录；读取生成标题，不读取 chat_history 正文。这里只计 summary 文件大小。' });
      }
    }
  }

  // VS Code family: workspace.json is a directory pointer. state.vscdb can contain
  // secrets and remains unopened, even when beside this index.
  const workspaceRoots = new Map();
  for (const profile of profiles) workspaceRoots.set(path.join(profile.path, 'User/workspaceStorage'), profile.agent);
  for (const [directory, agent] of workspaceRoots) if (allowed(directory)) for (const entry of await children(directory)) if (entry.isDirectory()) {
    const filename = path.join(directory, entry.name, 'workspace.json'), head = await prefix(filename, 32768);
    let data; try { data = JSON.parse(head?.text); } catch { continue; }
    let cwd; try { if (typeof data.folder === 'string' && data.folder.startsWith('file:')) cwd = fileURLToPath(data.folder); } catch {}
    if (cwd) await asset(cwd, { agent, kind: 'workspace', sourcePath: filename, physicalPath: filename, title: '编辑器工作区', explanation: 'workspace.json.folder 明确指向此目录；相邻 state.vscdb / 扩展状态未读取，也不按此记录推算整个工作区缓存大小。' });
  }

  const scopeRows = [];
  for (const row of snapshot.items) {
    check(); const category = row.installation || row.installedComponent ? 'installation' : row.aiCategory || row.aiKind;
    let group = null;
    // These rows are already physically located in a project. Do not apply a
    // session's cwd to its whole shared parent directory or its shared database.
    const projectLocation = category === 'project' || [...groups.values()].some(group => group.type === 'project' && inside(row.path, group.path));
    if (projectLocation) {
      const root = await owner(path.dirname(row.path));
      if (root) { group = await groupFor(root); if (group) { group.scopeIds.push(row.id); if (!group.agents.includes(row.aiTool)) group.agents.push(row.aiTool); } }
    }
    const backup = /(?:^|\/)(?:\.private-backups|backups?|fixtures?|acceptance-evidence)(?:\/|$)/i.test(row.path);
    let explanation = secretName.test(row.path) ? '认证 / 凭据数据，未打开正文，保留。' : category === 'installation' ? '工具程序、运行依赖或内嵌组件；不是项目缓存，保留。' : category === 'model' ? '模型 / 数据集文件，可供多个项目共享；不按项目分摊。' : category === 'cache' ? '工具生成的可重建缓存；文件名与目录规则识别，未读取缓存正文。' : category === 'log' ? '工具运行 / 诊断日志；下方仅展示有边界的结构化抽读结果。' : category === 'project' ? '项目内的 Agent 配置 / 规则资源，保留；配置正文未读取。' : '会话索引、应用状态、配置或资源；多个项目可能共用，保留。';
    if (backup) explanation = '路径处于备份 / 测试夹具目录；这是备份或测试副本，不代表独立的活跃 Agent。' + explanation;
    if (storagePurpose(row.path)) explanation = storagePurpose(row.path).purpose;
    if (row.discoveryMode === 'generic') explanation = `自动发现的工具候选；${({ session: '会话', memory: '记忆', cache: '缓存', log: '日志' })[category] || '状态与配置'}用途由结构推断，身份与用途仍需确认。` + explanation;
    const sharedIndex = coverage.sources.some(source => source.status === 'complete' && inside(source.path, row.path));
    if (sharedIndex) explanation += '此范围含项目 / 会话索引；各项目关联记录列在项目视图中，不能把整个父目录分配给其中一个项目。';
    const details = { id: row.id, sourcePath: row.path, agent: row.aiTool, category, projectId: group?.id || null, status: group ? 'project' : sharedIndex || ['cache', 'log', 'model', 'installation'].includes(category) ? 'shared' : 'unknown', explanation, bytes: row.bytes, files: row.files, samples: [] };
    if (category === 'log' && !secretName.test(row.path) && !row.skipped) {
      let sampled = 0;
      const info = await stat(row.path);
      const candidates = info?.isFile() ? (async function* () { yield row.path; })() : files(row.path);
      for await (const filename of candidates) {
        if (!/\.(?:log|jsonl|ndjson|txt)$/i.test(filename) || secretName.test(filename)) continue;
        const head = await prefix(filename, coverage.logPrefixLimit); if (!head) continue;
        const levels = {}, components = new Set(), codes = new Set(), cwds = new Set();
        for (const line of head.text.split('\n')) {
          for (const match of line.matchAll(/\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL)\b/gi)) { const level = match[0].toUpperCase(); levels[level] = (levels[level] || 0) + 1; }
          for (const match of line.matchAll(/\b(?:ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT|ENOSPC)\b/g)) codes.add(match[0]);
          try { const data = JSON.parse(line); for (const field of ['logger', 'component']) if (typeof data[field] === 'string') components.add(safeExcerpt(data[field], 60)); if (typeof data.cwd === 'string' && data.cwd.startsWith('/')) cwds.add(safeExcerpt(data.cwd, 500)); } catch {}
        }
        details.samples.push({ path: filename, bytesRead: head.bytesRead, truncated: head.truncated, levels, components: [...components].slice(0, 15), codes: [...codes], cwdReferences: [...cwds].slice(0, 15), note: '每个日志范围最多抽读 2 个文件的前 32 KiB；这里只提取级别、组件、错误码及 cwd 引用，不以样本分配整个日志的项目归属。' });
        if (++sampled >= 2) break;
      }
    }
    scopeRows.push(details);
    if (scopeRows.length % 40 === 0) await progress(row.path);
  }
  // Project documentation is evidence, not an instruction to the analyzer.
  for (const group of groups.values()) {
    if (!group.exists || group.type !== 'project' || !inside(group.path, home)) continue;
    for (const name of ['package.json', 'README.md', 'README.zh-CN.md', 'README_CN.md']) {
      const filename = path.join(group.path, name), head = await prefix(filename, coverage.documentPrefixLimit);
      if (!head) continue;
      let description = '';
      if (name === 'package.json') { try { description = JSON.parse(head.text).description || ''; } catch {} }
      else {
        let inFence = false;
        const prose = head.text.split('\n').map(line => line.trim()).filter(line => {
          if (/^```|^~~~/.test(line)) { inFence = !inFence; return false; }
          return !inFence && line.length > 20 && !/^(?:#|<|!|\[|\||>|[-*]\s|[├└│])/u.test(line);
        });
        // Prefer introductory prose over dated release/status callouts. Expose
        // it as a quote from the document, never as a generated interpretation.
        description = prose.find(line => !/^(?:\*\*|\d{4}[-年])/.test(line)) || prose[0] || '';
      }
      if (description) { group.description = safeExcerpt(description, 350); group.evidence.push({ path: filename, field: name === 'package.json' ? 'description' : '开头说明摘录', bytesRead: head.bytesRead, truncated: head.truncated }); break; }
    }
    await progress(group.path);
  }
  check();
  coverage.directoryOnlyTools = [...new Set(snapshot.items.map(row => row.aiTool))].filter(tool => !coverage.sources.some(source => source.agent === tool && source.status === 'complete') && ![...groups.values()].some(group => group.assets.some(asset => asset.agent === tool && asset.kind !== 'scope')));
  return { id: randomUUID(), snapshotId: snapshot.id, createdAt: new Date().toISOString(), complete: true, groups: [...groups.values()].sort((a, b) => (a.type === 'project' ? 0 : 1) - (b.type === 'project' ? 0 : 1) || b.sessions - a.sessions || a.path.localeCompare(b.path)), scopes: scopeRows, unassigned: annotations, coverage, errors, policy: '本地规则归类；读取索引指定字段、会话头、项目说明和少量日志样本，未通读所有正文。项目归类不授权删除；会话 / 记忆 / 项目文件保留，缓存与日志仍走 Mole 逐文件审阅。' };
}

export function publicProjects(report, snapshot) {
  if (!report) return null;
  return { ...report, stale: !!report.stale || report.snapshotId !== snapshot?.id || !!snapshot?.stale, scopes: undefined, unassigned: undefined, groups: report.groups.map(({ assets, ...group }) => ({ ...group, assetCount: assets.length, titles: [...new Set(assets.filter(row => row.title && !/^(?:guardian review|code review|reviewer)$/i.test(row.title)).map(row => row.title))].slice(0, 3) })), sharedScopes: report.scopes.filter(row => row.status === 'shared').length, unknownScopes: report.scopes.filter(row => row.status === 'unknown').length, unassignedFiles: report.unassigned.length };
}

export function projectDetails(report, id, offset = 0) {
  const group = report.groups.find(row => row.id === id);
  const rows = group ? [...group.assets, ...report.scopes.filter(row => row.projectId === id).map(row => ({ ...row, kind: 'scope', kindLabel: kinds.scope }))] : id === 'shared' || id === 'unknown' ? [...report.scopes.filter(row => row.status === id), ...(id === 'unknown' ? report.unassigned : [])] : null;
  if (!rows) throw new Error('未找到此项目归类');
  return { group: group ? { ...group, assets: undefined } : { id, name: id === 'shared' ? '应用共享资源' : '暂无法确认归属' }, total: rows.length, offset, rows: rows.slice(offset, offset + 40), hasMore: offset + 40 < rows.length, policy: report.policy };
}

export function projectsCsv(report) {
  const cell = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const rows = [['项目 / 工作区', '项目路径', '工具', '内容类型', '数据文件 / 目录', '记录 ID', '标题 / 内容说明', '归类依据', '关联普通文件的当前分配字节', '范围快照字节（勿与文件字节相加）', '索引原始工作目录']];
  for (const group of report.groups) for (const row of group.assets) rows.push([group.name, group.path, row.agent, row.kindLabel, row.physicalPath || row.sourcePath, row.recordId, row.title, row.explanation, row.physicalBytes, '', row.workingDirectory]);
  for (const row of report.scopes) { const group = report.groups.find(group => group.id === row.projectId); rows.push([group?.name || (row.status === 'shared' ? '应用共享' : '归属待确认'), group?.path, row.agent, row.category, row.sourcePath, '', row.explanation, '目录位置 / 类型规则', '', row.bytes, '']); }
  for (const row of report.unassigned) rows.push(['归属待确认', '', row.agent, row.kindLabel || '未归类的会话 / 记忆', row.sourcePath, row.recordId, row.title, row.explanation, '', '', row.workingDirectory]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
