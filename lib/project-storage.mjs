import path from 'node:path';
import { lstat, realpath, opendir, mkdir, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { checkMoleTarget, PLAN_TTL } from './clean-plan.mjs';
import { associationStatuses, probeAssociation } from './association-files.mjs';
import { storagePurpose } from './storage-purpose.mjs';

const run = promisify(execFile);
const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
export const projectKinds = { cache: '缓存', log: '日志', session: '会话', memory: '记忆', other: '代码 / 依赖 / 配置 / 备份' };
const identity = info => ({ dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, nlink: info.nlink });
const same = (info, saved) => Object.keys(identity(info)).every(key => info[key] === saved[key]);
const sensitive = /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|Keychains|\.env(?:\.[^/]*)?|auth(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|tokens?(?:\.[^/]*)?|secretStorage|keyblob|Cookies|Login Data|[^/]+\.(?:pem|key|p12|pfx))(?:\/|$)/i;
const protectedPart = /(?:^|\/)(?:node_modules|vendor|\.git|\.hg|\.svn|\.runtime|\.Trash|\.private-backups|backups?|fixtures?|acceptance-evidence|\.venv(?:[-_][^/]*)?|venv(?:[-_][^/]*)?)(?:\/|$)/i;
const databaseFile = /(?:\.(?:sqlite\d*|db)(?:-(?:wal|shm))?|state\.vscdb)$/i;
const modelData = /(?:^|\/)(?:models?|blobs|huggingface|codex-runtimes)(?:\/|$)|\.(?:safetensors|gguf|ckpt|onnx|pth|pt)$/i;
const generated = new Set(['.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache', '__pycache__', '.parcel-cache', '.turbo', '.vite']);

export function projectFileKind(filename, root, knownKind) {
  const relative = path.relative(root, filename), parts = relative.split(path.sep);
  if (storagePurpose(filename)) return { kind: 'other', guardPath: filename };
  if (protectedPart.test(relative) || sensitive.test(filename) || databaseFile.test(filename) || modelData.test(relative)) return { kind: 'other', guardPath: filename };
  if (knownKind === 'session' || knownKind === 'memory') return { kind: knownKind, guardPath: filename };
  const cache = parts.findIndex((part, i) => generated.has(part) || part === 'cache' && ['.next', '.nuxt'].includes(parts[i - 1]));
  if (cache >= 0) return { kind: 'cache', guardPath: path.join(root, ...parts.slice(0, cache + 1)) };
  const logs = parts.findIndex(part => ['logs', '.logs'].includes(part));
  if (logs >= 0 || /\.log(?:\.\d+)?$/i.test(filename)) return { kind: 'log', guardPath: logs >= 0 ? path.join(root, ...parts.slice(0, logs + 1)) : filename };
  return { kind: knownKind || 'other', guardPath: filename };
}

export function projectFileBlock(file, now = Date.now()) {
  if (storagePurpose(file.path)) return '虚拟机磁盘或运行环境保留，由所属应用管理';
  if (!['cache', 'log', 'session', 'memory'].includes(file.kind)) return '代码、依赖、配置和备份保留';
  if (file.managed) return '由共享数据库 / 工具索引管理；保留，请在所属工具中管理会话';
  if (file.associationChanged) return '文件在项目归类后发生变化，归属需要重新读取确认';
  if (file.ambiguous) return '文件关联多个项目 / 工作目录，保留';
  if (file.nlink !== 1) return '存在硬链接，共享数据保留';
  if (sensitive.test(file.path) || protectedPart.test(path.relative(file.root, file.path)) || databaseFile.test(file.path) || modelData.test(path.relative(file.root, file.path))) return '受保护的凭据、数据库、模型、安装文件或备份';
  if (now - file.mtimeMs < 24 * 3600_000) return '最近 24 小时仍有写入，保留，避免影响正在进行的工作';
  return null;
}

export async function measureProjectStorage({ home, report, cancelled = () => false, onProgress = () => {}, associationProbe = probeAssociation }) {
  if (!report?.complete || report.stale) throw new Error('请先更新项目归类');
  home = await realpath(home);
  const device = (await lstat(home)).dev, rows = new Map(), errors = [], files = [], seenDirectories = new Set(), seenExplicit = new Set(), hardlinks = new Set(), shared = new Map();
  const known = new Map(), containers = new Map(), associations = [];
  const coverage = { files: 0, bytes: 0, links: 0, skipped: 0, directories: 0, completed: 0, total: report.groups.length };
  const check = () => { if (cancelled()) throw new Error('项目占用统计已停止'); };
  let last = 0;
  function progress(currentPath, force = false) { if (force || Date.now() - last > 500) { last = Date.now(); onProgress({ ...coverage, currentPath }); } }
  function fail(filename, error) { coverage.skipped++; errors.push({ path: filename, code: error.code || 'READ_ERROR', reason: error.message }); }
  async function stat(filename) {
    check(); if (!within(filename, home) || path.resolve(filename) !== filename) return null;
    try { const info = await lstat(filename); if (info.isSymbolicLink() || info.dev !== device || await realpath(filename) !== filename) { coverage.links++; return null; } return info; }
    catch (error) { if (error.code !== 'ENOENT') fail(filename, error); return null; }
  }
  for (const group of report.groups) {
    rows.set(group.id, { projectId: group.id, path: group.path, name: group.name, type: group.type, directoryBytes: 0, externalBytes: 0, totalBytes: 0, categories: Object.fromEntries(Object.keys(projectKinds).map(kind => [kind, { bytes: 0, files: 0, candidateBytes: 0, candidateFiles: 0 }])), databaseRecords: 0, sharedDatabasePaths: [], missingFiles: 0, recoveredFiles: 0, associationCounts: Object.fromEntries(Object.keys(associationStatuses).map(status => [status, 0])), sharedFiles: 0, largestProtected: [], directoryStatus: group.type === 'workspace' ? 'workspace' : group.exists && within(group.path, home) ? 'pending' : 'unavailable' });
    for (const asset of group.assets) {
      if (databaseFile.test(asset.sourcePath)) {
        const item = shared.get(asset.sourcePath) || { path: asset.sourcePath, kind: 'database', projects: [], records: 0, bytes: null };
        if (!item.projects.includes(group.id)) item.projects.push(group.id); item.records++;
        shared.set(asset.sourcePath, item);
        const stats = rows.get(group.id); stats.databaseRecords++;
        if (!stats.sharedDatabasePaths.includes(asset.sourcePath)) stats.sharedDatabasePaths.push(asset.sourcePath);
      }
      const filename = asset.physicalPath || (!databaseFile.test(asset.sourcePath) && ['session', 'memory'].includes(asset.kind) ? asset.sourcePath : null);
      if (!filename || !['session', 'memory'].includes(asset.kind)) continue;
      const item = known.get(filename) || { owners: new Set(), kind: asset.kind, managed: false, ambiguous: false, agent: asset.agent, indexedPath: asset.indexedPhysicalPath || filename, resolution: asset.pathResolution };
      item.owners.add(group.id); item.managed ||= databaseFile.test(asset.sourcePath); item.ambiguous ||= (asset.cwdReferences?.length || 0) > 1;
      known.set(filename, item);
      const container = asset.associationContainer;
      if (container && within(container, home) && within(filename, container)) { const set = containers.get(container) || new Set(); set.add(group.id); containers.set(container, set); }
    }
  }
  for (const [filename, item] of known) {
    check(); item.access = await associationProbe(filename, { home, device });
    let status = item.access.status;
    if (item.resolution === 'ambiguous' && status === 'missing') status = 'ambiguous';
    if (status === 'readable' && ['compressed', 'archived', 'relocated'].includes(item.resolution)) status = 'recovered';
    const reason = status === 'recovered' ? item.resolution === 'compressed' ? '索引对应文件已压缩，已补读实际压缩文件' : item.resolution === 'archived' ? '会话已移至归档目录，已补读归档文件' : '同一工具目录内找到唯一同名会话，已补读' : status === 'ambiguous' ? '同一索引匹配多个会话文件，未猜测归属' : item.access.reason;
    associations.push({ id: hash(filename), path: filename, indexedPath: item.indexedPath, agent: item.agent || '未知工具', kind: item.kind, projectIds: [...item.owners], status, code: status === 'recovered' ? 'RECOVERED' : status === 'ambiguous' ? 'AMBIGUOUS' : item.access.code, reason, resolution: item.resolution, bytes: item.access.bytes ?? null });
    for (const id of item.owners) { const stats = rows.get(id); stats.associationCounts[status]++; if (status === 'recovered') stats.recoveredFiles++; else if (status !== 'readable') stats.missingFiles++; }
    progress(filename);
  }
  for (const item of shared.values()) { const info = await stat(item.path); if (info?.isFile()) { item.bytes = info.blocks * 512; for (const suffix of ['-wal', '-shm']) { const sidecar = await stat(item.path + suffix); if (sidecar?.isFile()) item.bytes += sidecar.blocks * 512; } } }
  function account(filename, info, projectId, root, external, defaultKind = 'other') {
    if (known.has(filename)) seenExplicit.add(filename);
    const stats = rows.get(projectId), explicit = known.get(filename);
    const classification = projectFileKind(filename, root, explicit?.kind || defaultKind);
    const ambiguous = explicit && (explicit.owners.size > 1 || explicit.ambiguous || !explicit.owners.has(projectId));
    const bytes = info.blocks * 512;
    coverage.files++;
    // Shared links / cross-project files are visible once in shared resources,
    // with references in each project, and never arbitrarily charged to one.
    if (info.nlink > 1 || ambiguous) {
      const id = `${info.dev}:${info.ino}`;
      if (!hardlinks.has(id)) { hardlinks.add(id); coverage.bytes += bytes; shared.set(id, { path: filename, kind: 'shared-file', projects: [...(explicit?.owners || [projectId])], bytes }); }
      const item = shared.get(id); if (!item.projects.includes(projectId)) item.projects.push(projectId);
      for (const owner of new Set([...(explicit?.owners || []), projectId])) rows.get(owner).sharedFiles++;
      return;
    }
    coverage.bytes += bytes;
    stats.totalBytes += bytes; stats[external ? 'externalBytes' : 'directoryBytes'] += bytes;
    const category = stats.categories[classification.kind] || stats.categories.other;
    category.bytes += bytes; category.files++;
    if (classification.kind === 'other') {
      if (stats.largestProtected.length < 10 || bytes > stats.largestProtected.at(-1).bytes) { stats.largestProtected.push({ path: filename, bytes }); stats.largestProtected.sort((a, b) => b.bytes - a.bytes); stats.largestProtected.length = Math.min(10, stats.largestProtected.length); }
      return;
    }
    const file = { id: hash(filename), projectId, path: filename, root, kind: classification.kind, guardPath: classification.guardPath, bytes, external, agent: explicit?.agent || '项目生成文件', managed: !!explicit?.managed, ambiguous: !!ambiguous, associationChanged: !!explicit && info.ctimeMs > Date.parse(report.createdAt), ...identity(info) };
    file.blocked = explicit?.access && explicit.access.status !== 'readable' ? explicit.access.reason : projectFileBlock(file);
    if (!file.blocked) { category.candidateBytes += bytes; category.candidateFiles++; }
    files.push(file);
  }
  async function walk(root, projectId, external) {
    const rootInfo = await stat(root); if (!rootInfo?.isDirectory()) return false;
    const pending = [root];
    while (pending.length) {
      check(); const directory = pending.pop(), info = await stat(directory); if (!info?.isDirectory()) continue;
      const id = `${info.dev}:${info.ino}`; if (seenDirectories.has(id)) continue;
      seenDirectories.add(id); coverage.directories++;
      try {
        let batch = [];
        const consume = async () => { const chunk = batch; batch = []; await Promise.all(chunk.map(async entry => {
          check(); const filename = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) { coverage.links++; return; }
          if (entry.isDirectory()) { pending.push(filename); return; }
          const file = await stat(filename); if (file?.isFile()) account(filename, file, projectId, root, external);
        })); };
        for await (const entry of await opendir(directory)) { batch.push(entry); if (batch.length >= 16) await consume(); }
        if (batch.length) await consume();
      } catch (error) { check(); fail(directory, error); }
      progress(directory);
    }
    return true;
  }
  // Nested projects are measured first; an outer project excludes their files.
  for (const group of [...report.groups].sort((a, b) => b.path.length - a.path.length)) {
    check(); const stats = rows.get(group.id);
    if (group.type === 'project' && group.exists && within(group.path, home)) { const before = errors.length; stats.directoryStatus = await walk(group.path, group.id, false) ? errors.length > before ? 'partial' : 'complete' : 'unavailable'; }
    coverage.completed++; progress(group.path, true);
  }
  for (const [directory, owners] of containers) if (owners.size === 1) {
    const projectId = [...owners][0], group = rows.get(projectId);
    // A container already inside a measured project must not be walked twice.
    if (group.directoryStatus !== 'complete' || !within(directory, group.path)) await walk(directory, projectId, true);
  }
  for (const [filename, item] of known) {
    check(); if (seenExplicit.has(filename)) continue;
    const info = await stat(filename);
    if (!info?.isFile()) continue;
    const projectId = [...item.owners][0]; account(filename, info, projectId, path.dirname(filename), true, item.kind);
  }
  check(); progress(home, true);
  return { id: randomUUID(), reportId: report.id, snapshotId: report.snapshotId, createdAt: new Date().toISOString(), complete: true, groups: [...rows.values()], files, associations, associationSummary: Object.fromEntries(Object.keys(associationStatuses).map(status => [status, associations.filter(row => row.status === status).length])), shared: [...shared.values()], errors, coverage, note: '按分配块统计，0 B 不代表文件内容为空；不跟随符号链接，不跨卷，项目目录不重复计入已独立列出的子项目。外部会话 / 记忆文件另外计入。共享数据库与跨项目文件不按行分摊；缺失 / 无法读取不当作零。移到废纸篓不会立即释放空间。' };
}

export function publicProjectStorage(storage, report, snapshot) {
  if (!storage) return null;
  return { ...storage, files: undefined, associations: undefined, stale: !!storage.stale || storage.reportId !== report?.id || !!report?.stale || !!snapshot && (snapshot.id !== storage.snapshotId || !!snapshot.stale) };
}
export function publicAssociationFiles(storage, { projectId, status = '', offset = 0, query = '' } = {}) {
  if (status && !Object.hasOwn(associationStatuses, status) || !Number.isSafeInteger(offset) || offset < 0 || projectId && !storage.groups.some(row => row.projectId === projectId)) throw new Error('无效的关联文件筛选');
  const needle = String(query).slice(0, 200).toLowerCase();
  const scoped = (storage.associations || []).filter(row => (!projectId || row.projectIds.includes(projectId)) && (!needle || `${row.path} ${row.indexedPath} ${row.agent}`.toLowerCase().includes(needle)));
  const rows = scoped.filter(row => !status || row.status === status);
  return { storageId: storage.id, checked: !!storage.associations, rows: rows.slice(offset, offset + 100), total: rows.length, offset, hasMore: offset + 100 < rows.length, summary: storage.associations ? Object.fromEntries(Object.keys(associationStatuses).map(status => [status, scoped.filter(row => row.status === status).length])) : null };
}
export function publicProjectFiles(storage, projectId, kind, offset) {
  const rows = storage.files.filter(row => (!projectId || row.projectId === projectId) && (!kind || row.kind === kind));
  return { total: rows.length, offset, rows: rows.slice(offset, offset + 100).map(({ dev, ino, size, mtimeMs, ctimeMs, nlink, root, guardPath, ...row }) => row), hasMore: offset + 100 < rows.length };
}
export function projectStorageCsv(storage) {
  const cell = value => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const header = ['项目', '完整项目路径', '已确认分配字节', '目录内字节（排除独立子项目）', '工具目录内字节', '缓存字节', '日志字节', '独立会话文件字节', '记忆字节', '代码依赖配置备份字节', '共享数据库索引数（未分摊大小）', '未读关联文件数', '目录读取状态', '统计时间'];
  const rows = storage.groups.map(row => [row.name, row.path, row.totalBytes, row.directoryBytes, row.externalBytes, ...['cache', 'log', 'session', 'memory', 'other'].map(kind => row.categories[kind].bytes), row.databaseRecords, row.missingFiles, row.directoryStatus, storage.createdAt]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function runProjectStorage({ home, report, onProgress, onDone }) {
  const buffer = new SharedArrayBuffer(4), flag = new Int32Array(buffer);
  const worker = new Worker(new URL('./project-storage-worker.mjs', import.meta.url), { workerData: { home, report, buffer }, execArgv: [] });
  let finished = false, stopping = false, timer;
  function finish(value) { if (finished) return; finished = true; clearTimeout(timer); onDone(value); }
  worker.on('message', value => value.type === 'progress' ? onProgress(value.stats) : finish(value));
  worker.on('error', error => finish({ type: 'failure', cancelled: stopping, error: error.message }));
  worker.on('exit', () => { if (!finished) finish({ type: 'failure', cancelled: stopping, error: stopping ? '项目统计已停止' : '项目统计进程提前退出' }); });
  return { cancel() { stopping = true; Atomics.store(flag, 0, 1); timer = setTimeout(() => worker.terminate(), 1500); timer.unref(); } };
}

export async function buildProjectTrashPlan({ home, report, storage, projectIds, categories, allowPersonal = false, onProgress = () => {}, cancelled = () => false }) {
  if (!storage?.complete || publicProjectStorage(storage, report).stale) throw new Error('请先完成当前项目的占用统计');
  if (!Array.isArray(projectIds) || !projectIds.length || projectIds.length > 100 || new Set(projectIds).size !== projectIds.length || projectIds.some(id => !storage.groups.some(row => row.projectId === id))) throw new Error('请选择本次统计中的项目');
  if (!Array.isArray(categories) || !categories.length || new Set(categories).size !== categories.length || categories.some(kind => !['cache', 'log', 'session', 'memory'].includes(kind))) throw new Error('请选择有效的文件类别');
  if (!allowPersonal && categories.some(kind => ['session', 'memory'].includes(kind))) throw new Error('会话和记忆需要单独开启审阅');
  const plan = { id: randomUUID(), home, reportId: report.id, storageId: storage.id, createdAt: new Date().toISOString(), groups: [], retained: [], method: '移到废纸篓，不立即释放空间' };
  const groups = new Map(); let completed = 0;
  const candidates = storage.files.filter(file => projectIds.includes(file.projectId) && categories.includes(file.kind));
  for (const file of candidates) {
    if (cancelled()) throw new Error('清理预览已停止');
    const groupId = `${file.projectId}:${file.kind}`;
    if (!groups.has(groupId)) groups.set(groupId, { id: hash(groupId), projectId: file.projectId, name: storage.groups.find(row => row.projectId === file.projectId).name, kind: file.kind, nodes: [], retained: [], bytes: 0 });
    const group = groups.get(groupId);
    try {
      const blocked = projectFileBlock(file); if (blocked) throw new Error(blocked);
      if (!within(file.path, home) || await realpath(file.path) !== file.path) throw new Error('路径已变化或包含符号链接');
      const info = await lstat(file.path);
      if (!info.isFile() || !same(info, file)) throw new Error('统计后文件已变化，请重新统计');
      const parent = await lstat(path.dirname(file.path));
      group.nodes.push({ ...file, parent: { dev: parent.dev, ino: parent.ino } }); group.bytes += file.bytes;
    } catch (error) { group.retained.push({ path: file.path, reason: error.message, bytes: file.bytes }); }
    if (++completed % 100 === 0) onProgress({ completed, total: candidates.length, currentPath: file.path });
  }
  plan.groups = [...groups.values()];
  for (const id of projectIds) {
    const stats = storage.groups.find(row => row.projectId === id);
    if (stats.databaseRecords && categories.includes('session')) plan.retained.push({ projectId: id, reason: `${stats.databaseRecords} 条共享数据库索引保留；不能按项目拆删数据库或关联记录。` });
    if (stats.missingFiles) plan.retained.push({ projectId: id, reason: `${stats.missingFiles} 个关联文件未找到 / 未读取，保留索引，不推算可释放大小。` });
  }
  return plan;
}
export function publicProjectPlan(plan) {
  if (!plan) return null;
  return { ...plan, home: undefined, groups: plan.groups.map(({ nodes, retained, ...group }) => ({ ...group, retained: retained.slice(0, 10), retainedCount: retained.length, files: nodes.length, selectable: nodes.length > 0 })), expiresAt: new Date(Date.parse(plan.createdAt) + PLAN_TTL).toISOString() };
}
export function selectProjectGroups(plan, ids) {
  if (!plan || plan.usedBy || Date.now() - Date.parse(plan.createdAt) > PLAN_TTL) throw new Error('项目预览已过期或已使用，请重新生成');
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.length > 400) throw new Error('请选择有效的项目类别');
  return ids.map(id => { const row = plan.groups.find(row => row.id === id); if (!row?.nodes.length) throw new Error('所选类别没有可整理文件'); return row; });
}
export async function checkFileUnused(filename) {
  if (process.platform !== 'darwin') throw new Error('此平台尚未接入文件占用检查，保留会话 / 记忆');
  try { const { stdout } = await run('/usr/sbin/lsof', ['-t', '--', filename], { timeout: 10000, maxBuffer: 65536 }); if (stdout.trim()) throw new Error('文件仍被进程打开，保留'); }
  catch (error) { if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return; throw error; }
}

export async function executeProjectTrashPlan(plan, selected, { guard = checkMoleTarget, personalGuard = checkFileUnused, cancelled = () => false, onRecord = async () => {}, onProgress = () => {} } = {}) {
  const trash = path.join(plan.home, '.Trash'); await mkdir(trash, { recursive: true, mode: 0o700 });
  if (await realpath(trash) !== trash || !(await lstat(trash)).isDirectory()) throw new Error('废纸篓路径异常');
  const trashIdentity = await lstat(trash), results = [], checked = new Map();
  const total = selected.reduce((n, row) => n + row.nodes.length, 0);
  outer: for (const group of selected) for (const node of group.nodes) {
    if (cancelled()) break outer;
    let record = { projectId: group.projectId, groupId: group.id, kind: group.kind, originalPath: node.path, bytes: node.bytes, status: 'skipped' };
    try {
      if (cancelled()) throw new Error('任务已停止，保留未处理文件');
      if (projectFileBlock(node)) throw new Error(projectFileBlock(node));
      if (!within(node.path, plan.home) || await realpath(path.dirname(node.path)) !== path.dirname(node.path)) throw new Error('原目录路径已变化');
      const stamp = checked.get(node.guardPath) || 0;
      if (['session', 'memory'].includes(node.kind)) await personalGuard(node.path);
      else if (Date.now() - stamp > 5000) { await guard(node.guardPath, plan.home); checked.set(node.guardPath, Date.now()); }
      if (cancelled()) throw new Error('任务已停止，保留未处理文件');
      const parent = await lstat(path.dirname(node.path)), currentTrash = await lstat(trash);
      if (parent.dev !== node.parent.dev || parent.ino !== node.parent.ino || await realpath(trash) !== trash || currentTrash.dev !== trashIdentity.dev || currentTrash.ino !== trashIdentity.ino) throw new Error('原目录或废纸篓已被替换');
      const info = await lstat(node.path);
      if (!info.isFile() || info.isSymbolicLink() || !same(info, node) || info.dev !== currentTrash.dev) throw new Error('文件已变化、跨卷或不是独立普通文件，保留');
      const destination = path.join(trash, `Minorminor-${group.projectId.slice(0, 8)}-${randomUUID()}-${path.basename(node.path).slice(-120)}`);
      // Journal the intended destination before the atomic move. A crash can be
      // inspected without retrying or guessing which files were processed.
      await onRecord({ ...record, trashPath: destination, status: 'moving' });
      const final = await lstat(node.path);
      const finalParent = await lstat(path.dirname(node.path)), finalTrash = await lstat(trash);
      if (!same(final, node) || await realpath(path.dirname(node.path)) !== path.dirname(node.path) || finalParent.dev !== node.parent.dev || finalParent.ino !== node.parent.ino || await realpath(trash) !== trash || finalTrash.dev !== trashIdentity.dev || finalTrash.ino !== trashIdentity.ino) throw new Error('移动前文件或废纸篓路径已变化，保留');
      await rename(node.path, destination);
      record = { ...record, trashPath: destination, status: 'moved' };
    } catch (error) { record.reason = error.message; }
    await onRecord(record); results.push(record);
    if (results.length % 30 === 0) onProgress({ completed: results.length, total: selected.reduce((n, row) => n + row.nodes.length, 0), currentPath: node.path });
  }
  return { status: cancelled() ? 'cancelled' : 'complete', createdAt: new Date().toISOString(), moved: results.filter(row => row.status === 'moved').length, movedBytes: results.filter(row => row.status === 'moved').reduce((n, row) => n + row.bytes, 0), skipped: results.filter(row => row.status !== 'moved').length, unprocessed: total - results.length, note: `已移到废纸篓的文件可依据原路径手动还原；${total - results.length} 个文件未处理。未清空废纸篓，不承诺立即释放空间。` };
}
