import path from 'node:path';
import { lstat, realpath, opendir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { projectFileKind, projectKinds } from './project-storage.mjs';
import { createDirectorySizeScanner } from './directory-sizes.mjs';
import { zstdAvailable, readCompressedSessionPrefix } from './compressed-session.mjs';
import { storagePurpose } from './storage-purpose.mjs';

const within = (file, root) => file === root || file.startsWith(root + path.sep);
const identity = s => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs });
const same = (a, b) => Object.keys(identity(a)).every(k => a[k] === b[k]);
const credential = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.pypirc|\.netrc|Keychains|auth(?:\.[^/]*)?|[^/]*(?:credentials?|tokens?|secrets?|keychain|keyblob)[^/]*|Cookies|Login Data|[^/]+\.(?:pem|key|p12|pfx))(?:\/|$)/i;
const database = /(?:\.(?:sqlite\d*|db)(?:-(?:wal|shm))?|state\.vscdb)$/i;
const binary = /\.(?:pyc|pyo|so|dylib|dll|exe|o|a|class|jar|wasm|zip|gz|tgz|xz|bz2|7z|rar|tar|dmg|app|png|jpe?g|gif|webp|ico|pdf|mp[34]|mov|woff2?|ttf|safetensors|gguf|ckpt|onnx|pth|pt|bin|pack|idx)$/i;
const textExtensions = /\.(?:md|mdx|txt|log|json|jsonl|ndjson|js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|fish|command|html|css|scss|less|vue|svelte|go|rs|c|h|cpp|hpp|java|swift|rb|php|sql|yaml|yml|toml|ini|cfg|conf|xml|csv|tsv|rst|gitignore)$/i;

export function redactFileText(value, limit = 4000) {
  return String(value).replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/g, '[私钥已隐藏]')
    .replace(/(?:https?:\/\/)[^\s<>"']+/gi, '[链接已省略]')
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/g, '[凭据已隐藏]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[凭据已隐藏]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/["']?\b(?:[a-z][a-z0-9]*[_-])*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret|secret[_-]?access[_-]?key|access[_-]?key[_-]?id|private[_-]?key|authorization|cookie|token)\b["']?\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi, '[凭据字段已隐藏]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit);
}

export function describeProjectFile(filename, kind = 'other', asset) {
  const name = path.basename(filename), ext = path.extname(name).toLowerCase();
  const compressedSession = kind === 'session' && /\.(?:jsonl|ndjson)\.(?:zst|gz)$/i.test(name);
  const compression = name.endsWith('.gz') ? 'GZIP' : 'ZSTD', vm = storagePurpose(filename);
  let purpose = '普通项目文件；仅凭路径和格式无法确认具体内容', format = ext ? ext.slice(1).toUpperCase() : '无扩展名';
  if (credential.test(filename)) purpose = '凭据或敏感配置；只展示元数据，正文不打开';
  else if (vm) { purpose = vm.purpose; format = vm.format; }
  else if (database.test(filename)) { purpose = /-(?:wal|shm)$/.test(filename) ? '数据库事务日志 / 共享内存，须与数据库一起管理' : '数据库，可能同时保存多个项目的索引、会话或状态；不按行分摊'; format = '数据库'; }
  else if (/\.(?:safetensors|gguf|ckpt|onnx|pth|pt)$/i.test(name)) purpose = '模型权重或训练检查点；体积大，删除后可能需要重新下载或训练';
  else if (/\.(?:pyc|pyo)$/i.test(name)) purpose = `Python 模块 ${name.replace(/\.cpython-\d+.*$|\.py[co]$/i, '')} 的编译字节码`;
  else if (name === '.DS_Store') purpose = 'macOS 访达保存的目录显示偏好，例如图标位置和排序';
  else if (name === '.gitignore') purpose = 'Git 忽略规则，指定不纳入版本管理的文件';
  else if (filename.includes('/.pytest_cache/')) purpose = 'pytest 测试运行状态，例如上次失败用例、节点列表';
  else if (/\/(?:\.mypy_cache|\.ruff_cache)\//.test(filename)) purpose = 'Python 类型检查 / 代码检查产生的缓存';
  else if (/\/\.git\//.test(filename)) purpose = 'Git 版本历史、对象或仓库内部索引；保留';
  else if (kind === 'memory') purpose = 'AI 长期记忆或项目约定，可能影响后续回答和工作方式';
  else if (kind === 'session') { purpose = compressedSession ? `${compression} 压缩的 AI 会话；在内存中读取开头的目录、标题和记录类型` : 'AI 会话 / 执行记录；读取时只提取标题、工作目录、记录类型等字段'; if (compressedSession) format = `JSONL · ${compression}`; }
  else if (kind === 'log') purpose = '程序运行日志，用于定位错误和诊断运行状态';
  else if (kind === 'cache') purpose = '工具或构建过程生成的缓存；具体用途需结合格式或内容核对';
  else if (/^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|Gemfile\.lock)$/.test(name)) purpose = '依赖版本锁定文件，保证环境和构建可复现';
  else if (/^(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|requirements.*\.txt)$/.test(name)) purpose = '项目 / 软件包清单，声明名称、依赖或构建配置';
  else if (/^(?:README|AGENTS|CLAUDE|GEMINI|MEMORY)(?:\.|$)/i.test(name)) purpose = /README/i.test(name) ? '项目说明文档' : '项目约定、代理指引或记忆文档';
  else if (/\.(?:zip|gz|tgz|xz|bz2|7z|rar|tar)$/i.test(name)) purpose = '压缩归档，可能包含备份、安装包或数据；不自动解包';
  else if (/\.(?:png|jpe?g|gif|webp|ico|svg)$/i.test(name)) purpose = '图片 / 界面资源';
  else if (/\.command$/i.test(name)) purpose = 'macOS 终端启动脚本；只可读取查看，不运行';
  else if (/\.(?:js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|html|css|vue|svelte|go|rs|c|h|cpp|java|swift|rb|php)$/i.test(name)) purpose = `${format} 源代码 / 脚本；属于项目内容`;
  else if (/\.(?:md|mdx|rst|txt)$/i.test(name)) purpose = '说明文档或纯文本文件';
  else if (/\.(?:json|yaml|yml|toml|ini|cfg|conf|xml)$/i.test(name)) purpose = '结构化数据 / 配置；具体意义需结合字段确认';
  const context = /\/(?:node_modules|vendor|\.venv(?:[-_][^/]*)?|venv)\//.test(filename) ? '位于依赖 / 运行环境中，按依赖文件保留。' : /\/(?:\.private-backups|backups?|acceptance-evidence|fixtures?)\//.test(filename) ? '位于备份 / 测试材料中，按原项目资料保留。' : '';
  const previewReason = credential.test(filename) ? '敏感路径，只显示元数据' : vm ? '虚拟机资源只显示元数据，请使用所属应用管理' : database.test(filename) ? '共享数据库不读取正文，请使用所属工具管理' : compressedSession ? compression === 'GZIP' || zstdAvailable ? '' : '当前 Node.js 不支持解码，只显示压缩文件元数据' : binary.test(filename) || /\.zst$/i.test(name) ? '二进制、媒体、模型或归档仅显示元数据' : !textExtensions.test(name) && !/^(?:README|LICENSE|Dockerfile|Makefile|\.gitignore)$/i.test(name) ? '未确认是文本格式，只显示元数据' : '';
  return { purpose: purpose + (context ? ' ' + context : ''), format, basis: asset ? `路径 / 格式判断；已有归类记录：${redactFileText(asset.title || asset.explanation || asset.kind, 300)}` : '根据目录位置和文件格式判断，尚未读取正文', title: asset?.title ? redactFileText(asset.title, 200) : null, canPreview: !previewReason, previewReason };
}

// Resources are issued only from a known project root, its direct children, or
// the saved category manifest. HTTP callers never supply filesystem paths.
export function createProjectFileBrowser({ home, report, storage }) {
  const directoryScanner = createDirectorySizeScanner({ home });
  const resources = new Map(), reverse = new Map(), groups = new Map(report.groups.map(g => [g.id, g]));
  const indexed = new Map(storage.files.map(f => [f.path, f]));
  const assets = new Map();
  for (const group of report.groups) for (const asset of group.assets || []) {
    const filename = asset.physicalPath || asset.sourcePath;
    if (filename && !assets.has(filename)) assets.set(filename, asset);
  }
  let device;
  async function checked(filename) {
    if (!within(filename, home) || path.resolve(filename) !== filename) throw new Error('路径超出本地项目范围');
    device ??= (await lstat(home)).dev;
    const info = await lstat(filename);
    if (info.isSymbolicLink() || info.dev !== device || await realpath(filename) !== filename) throw new Error('符号链接、跨卷或路径变化，未读取');
    return info;
  }
  function issue(value) {
    const key = value.projectId + ':' + value.path, old = reverse.get(key);
    if (old) { const resource = resources.get(old); if (resource && same(resource.identity, value.identity)) { resources.delete(old); resources.set(old, resource); return old; } resources.delete(old); }
    const id = randomUUID(); resources.set(id, value); reverse.set(key, id);
    while (resources.size > 5000) { const first = resources.keys().next().value, row = resources.get(first); reverse.delete(row.projectId + ':' + row.path); resources.delete(first); }
    return id;
  }
  function resource(id, projectId) { const r = resources.get(id); if (!r || projectId && r.projectId !== projectId) throw new Error('文件条目已过期，请重新展开清单'); return r; }
  function describe(filename, info, project, saved, root) {
    const isDirectory = info.isDirectory(), kind = saved?.kind || projectFileKind(filename, root).kind;
    const folderSize = isDirectory ? directoryScanner.result(project.path, filename, info) : null;
    const nested = isDirectory && [...groups.values()].find(g => g.id !== project.id && g.path === filename);
    const id = issue({ path: filename, projectId: project.id, identity: identity(info), directory: isDirectory, root, nested: !!nested });
    return { id, path: filename, name: path.basename(filename), directory: isDirectory, folderSize, nestedProject: nested ? { id: nested.id, name: nested.name } : null, kind, category: projectKinds[kind], bytes: isDirectory ? folderSize?.bytes ?? null : info.blocks * 512, logicalBytes: isDirectory ? folderSize?.logicalBytes ?? null : info.size, modifiedAt: new Date(info.mtimeMs).toISOString(), ...(!isDirectory ? describeProjectFile(filename, kind, assets.get(filename)) : { purpose: storagePurpose(filename)?.purpose || (nested ? '已单独统计的子项目；此处的文件夹占用包含其全部内容' : '文件夹整体占用包含所有下层文件；点击进入下一层'), basis: '后台递归统计文件元数据', canPreview: false }), blocked: saved?.blocked || (saved ? '仅供查看；整理仍需生成预览并通过实时检查' : '此浏览清单不新增清理范围'), snapshot: !!saved, changed: !!saved && !same(info, saved) };
  }
  async function list({ projectId, kind = 'tree', directoryId, offset = 0, sort = 'size', query = '' }) {
    const project = groups.get(projectId);
    if (!project) throw new Error('项目不存在');
    if (!Number.isSafeInteger(offset) || offset < 0 || !['tree', 'cache', 'log', 'session', 'memory'].includes(kind) || !['size', 'name', 'time'].includes(sort)) throw new Error('无效的文件浏览参数');
    const breadcrumbs = [], failures = [];
    let rows, directory = null, directorySummary = null, note = '';
    if (kind !== 'tree') {
      if (directoryId) throw new Error('分类清单不接受目录参数');
      rows = storage.files.filter(f => f.projectId === projectId && f.kind === kind).map(f => ({ filename: f.path, saved: f, size: f.bytes, time: f.mtimeMs }));
      note = '列出统计快照中的全部独立文件；排序沿用统计快照，文件大小会在本页实时核对。共享数据库索引不按记录分摊。';
    } else {
      if (project.type !== 'project' || !project.exists) return { storageId: storage.id, projectId, kind, rows: [], total: 0, offset: 0, hasMore: false, breadcrumbs: [], note: '此处是通用工作区、历史路径或外部目录，只浏览已关联的缓存 / 日志 / 会话 / 记忆，不展开整个主目录。' };
      let directoryInfo;
      if (directoryId) { const r = resource(directoryId, projectId); if (!r.directory || r.nested) throw new Error('请在对应子项目中展开目录'); directory = r.path; directoryInfo = await checked(directory); if (!same(directoryInfo, r.identity)) { /* Directory mtimes can change naturally; children are always revalidated. */ if (directoryInfo.ino !== r.identity.ino || directoryInfo.dev !== r.identity.dev) throw new Error('目录已被替换，请重新展开项目'); } }
      else { directory = project.path; directoryInfo = await checked(directory); }
      if (!directoryInfo.isDirectory() || !within(directory, project.path)) throw new Error('项目目录不可用');
      directorySummary = directoryScanner.result(project.path, directory, directoryInfo);
      let crumb = project.path;
      for (const part of ['', ...path.relative(project.path, directory).split(path.sep).filter(Boolean)]) { if (part) crumb = path.join(crumb, part); const info = await checked(crumb); breadcrumbs.push({ id: issue({ path: crumb, projectId, identity: identity(info), directory: true, root: project.path }), name: part || project.name }); }
      rows = [];
      for await (const entry of await opendir(directory)) {
        if (entry.isSymbolicLink()) { failures.push({ path: path.join(directory, entry.name), reason: '符号链接未跟随' }); continue; }
        rows.push({ filename: path.join(directory, entry.name), isDirectory: entry.isDirectory() });
      }
      // Listing stays responsive while the separate worker measures the tree.
      for (let i = 0; i < rows.length; i += 16) await Promise.all(rows.slice(i, i + 16).map(async row => { try { row.info = await checked(row.filename); row.size = row.info.isFile() ? row.info.blocks * 512 : directoryScanner.result(project.path, row.filename, row.info)?.bytes ?? -1; row.time = row.info.mtimeMs; } catch (e) { row.error = e.message; } }));
      for (const row of rows.filter(r => r.error)) failures.push({ path: row.filename, reason: row.error });
      rows = rows.filter(r => r.info?.isDirectory() || r.info?.isFile());
      note = '文件夹在后台递归统计，完成后显示整体磁盘占用、内容大小和文件数量，并按占用排序。文件夹占用包含下层目录及独立子项目；父子目录不能相加，项目卡片另按归类口径统计。';
    }
    const needle = String(query).slice(0, 200).toLowerCase();
    rows = rows.filter(row => !needle || row.filename.toLowerCase().includes(needle));
    rows.sort((a, b) => kind === 'tree' && Number(b.info.isDirectory()) - Number(a.info.isDirectory()) || (sort === 'name' ? 0 : sort === 'time' ? b.time - a.time : b.size - a.size) || a.filename.localeCompare(b.filename));
    const total = rows.length, page = [];
    for (const row of rows.slice(offset, offset + 100)) {
      try { const info = row.info || await checked(row.filename); page.push(describe(row.filename, info, project, row.saved || indexed.get(row.filename), project.path)); }
      catch (e) { page.push({ name: path.basename(row.filename), path: row.filename, bytes: row.saved?.bytes ?? null, logicalBytes: row.saved?.size ?? null, kind, purpose: '文件缺失或当前无法读取', error: e.message, snapshot: true, canPreview: false }); }
    }
    return { storageId: storage.id, projectId, kind, directory, directorySummary, directoryScan: kind === 'tree' ? directoryScanner.status(project.path) : null, breadcrumbs, rows: page, total, offset, hasMore: offset + 100 < total, errors: failures.slice(0, 20), errorCount: failures.length, note };
  }
  async function inspect(id) {
    const r = resource(id);
    if (r.directory) throw new Error('目录请逐层展开');
    const info = await checked(r.path);
    if (!info.isFile() || !same(info, r.identity)) throw new Error('文件已变化，请刷新文件清单后重试');
    const kind = indexed.get(r.path)?.kind || projectFileKind(r.path, r.root).kind;
    const description = describeProjectFile(r.path, kind, assets.get(r.path));
    if (!description.canPreview) return { id, ...description, mode: 'metadata', bytesRead: 0, summary: description.previewReason };
    const handle = await open(r.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let contents, bytesRead, decompressedTruncated;
    try {
      const before = await handle.stat(); if (!before.isFile() || !same(before, r.identity) || await realpath(r.path) !== r.path) throw new Error('文件身份变化，未读取');
      if (kind === 'session' && /\.(?:jsonl|ndjson)\.(?:zst|gz)$/i.test(r.path)) ({ contents, bytesRead, truncated: decompressedTruncated } = await readCompressedSessionPrefix(handle, 32768, r.path.endsWith('.gz') ? 'gzip' : 'zstd'));
      else { const buffer = Buffer.alloc(Math.min(32768, before.size)); ({ bytesRead } = await handle.read(buffer, 0, buffer.length, 0)); contents = buffer.subarray(0, bytesRead); }
      if (!same(await handle.stat(), r.identity) || !same(await checked(r.path), r.identity)) throw new Error('读取期间文件变化，请刷新后重试');
    } finally { await handle.close(); }
    if (contents.includes(0)) return { id, ...description, mode: 'metadata', bytesRead, summary: '检测到二进制内容，未展示正文' };
    const truncated = decompressedTruncated ?? bytesRead < info.size;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(contents, { stream: truncated }); }
    catch { return { id, ...description, mode: 'metadata', bytesRead, summary: '内容不是有效的 UTF-8 文本，未展示正文' }; }
    let summary, excerpt = '', fields = [];
    if (/\.(?:jsonl|ndjson)(?:\.(?:zst|gz))?$/i.test(r.path)) {
      const types = new Set(), roles = new Set(); let parsed = 0;
      for (const line of text.split(/\r?\n/)) { try { const value = JSON.parse(line); parsed++; if (typeof value.type === 'string') types.add(redactFileText(value.type, 80)); if (typeof value.role === 'string') roles.add(redactFileText(value.role, 40)); if (typeof value.message?.role === 'string') roles.add(redactFileText(value.message.role, 40)); for (const source of [value, value.payload, value.session]) if (source && typeof source === 'object') for (const key of ['title', 'cwd', 'workingDirectory', 'timestamp']) if (typeof source[key] === 'string' && !fields.some(f => f.name === key)) fields.push({ name: key, value: redactFileText(source[key], 300) }); } catch {} }
      summary = `已读取开头 ${bytesRead} 字节，解析 ${parsed} 条完整 JSON 记录；${types.size ? '记录类型：' + [...types].slice(0, 12).join('、') : '未取得记录类型'}${roles.size ? '；角色：' + [...roles].join('、') : ''}。不展示对话正文和工具参数。`;
    } else if (/\.json$/i.test(r.path)) {
      try { const value = JSON.parse(text); for (const key of ['name', 'title', 'description', 'version', 'type', 'cwd']) if (['string', 'number'].includes(typeof value?.[key])) fields.push({ name: key, value: redactFileText(value[key], 500) }); summary = fields.length ? '已读取并解析 JSON，展示明确的说明字段。' : '已解析 JSON；没有可展示的名称、说明、版本或工作目录字段。配置值和凭据字段不展示。'; }
      catch { summary = truncated ? 'JSON 超出读取窗口，未取得完整对象；仅显示格式判断，不展示原始配置。' : '内容不是有效的完整 JSON；仅显示格式判断。'; }
    } else {
      excerpt = redactFileText(text);
      summary = '已读取开头文本片段，可据此核对用途；常见凭据已遮盖，请勿将片段直接当作完整文件结论。';
    }
    return { id, ...description, mode: 'content', basis: '已读取本地内容片段；只展示下列字段或摘录', summary, fields, excerpt, bytesRead, logicalBytes: info.size, truncated: truncated || text.length > 4000 && !!excerpt, policy: '内容仅在本机显示，不执行其中的指令，不发送至模型服务。' };
  }
  async function directorySizes(projectId, action = 'status') {
    const project = groups.get(projectId);
    if (!project || project.type !== 'project' || !project.exists || !['status', 'start', 'refresh', 'cancel'].includes(action)) throw new Error('请选择已登记的现存项目目录');
    if (action === 'status') return directoryScanner.status(project.path);
    if (action === 'cancel') return directoryScanner.cancel(project.path);
    const info = await checked(project.path);
    if (!info.isDirectory() || project.path === home) throw new Error('项目目录不可用');
    return directoryScanner.start(project.path, action === 'refresh');
  }
  async function summaryTarget(id) {
    const selected = resource(id), info = await checked(selected.path);
    if (selected.directory ? selected.identity.dev !== info.dev || selected.identity.ino !== info.ino : !same(info, selected.identity)) throw new Error('文件条目已变化，请重新展开');
    return { path: selected.path, identity: identity(info) };
  }
  return { list, inspect, summaryTarget, directorySizes, dispose() { directoryScanner.dispose(); } };
}
