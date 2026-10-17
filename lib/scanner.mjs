import { opendir, lstat, statfs, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isCloudDirectory, readCloudDirectory } from './cloud-directory.mjs';
import { projectMarker } from './project-discovery.mjs';

const DAY = 86_400_000;
export const categoryDefinitions = [
  { id: 'cache', title: '应用缓存', description: '浏览器和应用的本地缓存，交由 Mole 深度预览', icon: 'layers', color: 'green', selectable: false },
  { id: 'logs', title: '历史日志', description: '14 天前的日志文件，可移到废纸篓', icon: 'file', color: 'blue', selectable: true },
  { id: 'installers', title: '下载的安装包', description: '7 天前下载的 DMG、PKG 安装文件', icon: 'box', color: 'orange', selectable: true },
  { id: 'trash', title: '废纸篓', description: '查看占用；可在访达中检查并清空', icon: 'trash', color: 'purple', selectable: false },
];
export const locations = home => ({ cache: path.join(home, 'Library/Caches'), logs: path.join(home, 'Library/Logs'), installers: path.join(home, 'Downloads'), trash: path.join(home, '.Trash') });

export async function scanScopes(home = os.homedir()) {
  let diskPath = '/';
  if (process.platform === 'darwin') {
    try { if ((await lstat('/System/Volumes/Data')).isDirectory()) diskPath = '/System/Volumes/Data'; } catch { /* Older macOS uses /. */ }
  }
  return [
    { id: 'disk', label: process.platform === 'darwin' && diskPath !== '/' ? '启动磁盘数据卷' : '本机文件系统', path: diskPath, displayPath: '/', stayOnDevice: true },
    { id: 'home', label: '整个用户目录', path: home, displayPath: home, stayOnDevice: true },
  ];
}

export function eligible(category, name, info, now = Date.now()) {
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) return false;
  const age = now - Math.max(info.mtimeMs, info.ctimeMs);
  if (category === 'logs') return age > 14 * DAY && /\.(?:log|log\.\d+|log\.gz|log\.\d+\.gz)$/i.test(name);
  if (category === 'installers') return age > 7 * DAY && /\.(?:dmg|pkg)$/i.test(name);
  return false;
}

export function describeError(error) {
  return ({ EACCES: '文件权限不允许读取', EPERM: '系统隐私保护或文件权限阻止读取', ENOENT: '文件在扫描期间消失或路径不存在', ENOTDIR: '路径在扫描期间发生变化', EIO: '文件系统读取失败', EMFILE: '系统可用文件句柄不足', ETIMEDOUT: '云端目录读取超时，未读取部分已保留', SYMLINK_ROOT: '扫描入口包含符号链接，已保留在范围之外' })[error.code] || error.message || '读取失败';
}

// Stream directories with bounded I/O concurrency; no traversal/time/depth cap.
export async function measure(target, { signal, onProgress = () => {}, onEntry = () => {}, onDirectory = () => {}, onDirectoryComplete = () => {}, onError = () => {}, stayOnDevice = true } = {}) {
  const start = Date.now();
  const stats = { bytes: 0, count: 0, visited: 0, directories: 0, skipped: 0, symlinks: 0, mountPoints: 0, duplicateDirectories: 0, errorCounts: {}, errors: [], currentPath: target, available: false };
  let lastProgress = 0;
  const publish = (force = false) => { if (force || Date.now() - lastProgress >= 250) { lastProgress = Date.now(); onProgress({ ...stats, errors: [...stats.errors], elapsedMs: Date.now() - start }); } };
  async function recordError(error, currentPath) {
    const detail = { path: currentPath, code: error.code || 'UNKNOWN', reason: describeError(error) };
    stats.skipped++;
    stats.errorCounts[detail.code] = (stats.errorCounts[detail.code] || 0) + 1;
    if (stats.errors.length < 100) stats.errors.push(detail); // Samples only; the worker logs every failure.
    await onError(detail);
    publish();
  }
  let root;
  try {
    root = await lstat(target);
    if (root.isSymbolicLink() || await realpath(target) !== path.resolve(target)) throw Object.assign(new Error('扫描入口包含符号链接'), { code: 'SYMLINK_ROOT' });
  } catch (error) { await recordError(error, target); return { ...stats, partial: true, cancelled: !!signal?.aborted, elapsedMs: Date.now() - start }; }
  const seenDirectories = new Set();
  const hardlinks = new Set();
  const directories = [];
  async function visit(currentPath, info) {
    stats.visited++;
    stats.currentPath = currentPath;
    let allocated = 0;
    if (info.isSymbolicLink()) stats.symlinks++;
    else if (info.isDirectory()) {
      if (stayOnDevice && info.dev !== root.dev) stats.mountPoints++;
      else directories.push({ path: currentPath, info });
    } else if (info.isFile()) {
      const identity = `${info.dev}:${info.ino}`;
      const duplicate = info.nlink > 1 && hardlinks.has(identity);
      if (info.nlink > 1) hardlinks.add(identity);
      allocated = duplicate ? 0 : info.blocks == null ? info.size : info.blocks * 512;
      stats.bytes += allocated;
      stats.count++;
    }
    await onEntry(currentPath, info, allocated);
    publish();
  }
  await visit(target, root);
  if (!root.isDirectory()) stats.available = true;
  publish(true);
  while (directories.length && !signal?.aborted) {
    const current = directories.pop();
    const identity = `${current.info.dev}:${current.info.ino}`;
    if (seenDirectories.has(identity)) { stats.duplicateDirectories++; await onDirectoryComplete(current.path, { cancelled: !!signal?.aborted }); continue; }
    seenDirectories.add(identity);
    let directory;
    const pending = new Set();
    try {
      if (isCloudDirectory(current.path)) {
        stats.currentPath = current.path; publish(true);
        stats.directories++; await onDirectory(current.path);
        let entries, unavailable = false;
        try { entries = await readCloudDirectory(current.path, { cancelled: () => !!signal?.aborted }); }
        catch (error) { unavailable = true; entries = error.entries || []; if (!signal?.aborted) await recordError(error, current.path); }
        if (current.path === target && !unavailable && !entries.some(entry => entry.error?.path === target)) stats.available = true;
        for (const entry of entries) {
          if (signal?.aborted) break;
          if (entry.error) { await recordError(entry.error, entry.error.path); continue; }
          const info = entry.info;
          await visit(path.join(current.path, entry.name), { ...info, isFile: () => info.file, isDirectory: () => info.directory, isSymbolicLink: () => info.link });
        }
        continue;
      }
      if (await realpath(current.path) !== current.path) throw Object.assign(new Error('目录已被符号链接替换'), { code: 'SYMLINK_ROOT' });
      directory = await opendir(current.path, { bufferSize: 128 });
      stats.directories++;
      if (current.path === target) stats.available = true;
      await onDirectory(current.path);
      for await (const entry of directory) {
        if (signal?.aborted) break;
        const fullPath = path.join(current.path, entry.name);
        const task = (async () => {
          let info;
          try { info = await lstat(fullPath); } catch (error) { await recordError(error, fullPath); return; }
          await visit(fullPath, info);
        })();
        pending.add(task);
        task.then(() => pending.delete(task), () => {});
        if (pending.size >= 16) await Promise.race(pending);
      }
    } catch (error) { await recordError(error, current.path); }
    finally {
      await Promise.all(pending);
      if (directory) await directory.close().catch(error => { if (error.code !== 'ERR_DIR_CLOSED') throw error; });
      await onDirectoryComplete(current.path, { cancelled: !!signal?.aborted });
    }
    publish();
  }
  publish(true);
  return { ...stats, partial: stats.skipped > 0 || !!signal?.aborted, cancelled: !!signal?.aborted, elapsedMs: Date.now() - start };
}

export async function diskStatus(home = os.homedir()) {
  const stats = await statfs(home);
  const total = Number(stats.blocks) * Number(stats.bsize);
  const free = Number(stats.bavail) * Number(stats.bsize);
  return { total, free, used: total - free, platform: os.platform(), arch: os.arch(), hostname: os.hostname(), memory: os.totalmem(), kernel: os.release(), home };
}

const rowLabels = { Downloads: ['下载', 'download'], Desktop: ['桌面', 'monitor'], Documents: ['文稿', 'file'], Movies: ['影片', 'play'], Pictures: ['图片', 'image'], Music: ['音乐', 'music'], Library: ['资源库', 'layers'], Applications: ['应用程序', 'box'], Users: ['用户', 'monitor'] };
// 目录行的强调色统一为中性灰：行的区分交给进度条长度与数字，
// 不再用色相编码。保留数组形态以免改动调用处。
const rowColors = ['#3D3D3D'];
export async function inventory(home = os.homedir(), { scope = { id: 'home', label: '整个用户目录', path: home, displayPath: home, stayOnDevice: true }, signal, onProgress = () => {}, onError = () => {}, jobId } = {}) {
  const startedAt = new Date().toISOString();
  const roots = locations(home);
  const categories = categoryDefinitions.map(definition => ({ ...definition, path: roots[definition.id], bytes: 0, count: 0, skipped: 0, partial: false, available: false, candidates: 0, candidateBytes: 0 }));
  const items = [];
  const rows = new Map();
  const projectRoots = new Map();
  let rootDevice;
  const logicalPath = raw => path.join(scope.displayPath, path.relative(scope.path, raw));
  const categoryFor = target => categories.find(category => target === category.path || target.startsWith(category.path + path.sep));
  function rowFor(target, info) {
    const relative = path.relative(scope.displayPath, target);
    if (!relative) return null;
    const first = relative.split(path.sep)[0];
    if (!info && rows.has(first)) return rows.get(first);
    const rootFile = !relative.includes(path.sep) && !info?.isDirectory();
    const id = rootFile ? '__root_files__' : first;
    if (!rows.has(id)) {
      const label = rowLabels[first];
      rows.set(id, { id, name: rootFile ? '根目录中的文件' : label?.[0] || first, path: rootFile ? scope.displayPath : path.join(scope.displayPath, first), icon: rootFile ? 'file' : label?.[1] || 'layers', color: rowColors[rows.size % rowColors.length], bytes: 0, count: 0, skipped: 0, partial: false, status: rootFile ? 'scanning' : 'pending', pendingDirectories: 0 });
    }
    return rows.get(id);
  }
  const measurement = await measure(scope.path, {
    signal, stayOnDevice: scope.stayOnDevice,
    onDirectory: raw => {
      const target = logicalPath(raw);
      const category = categories.find(value => value.path === target);
      if (category) category.available = true;
      const row = rowFor(target);
      if (row) row.status = 'scanning';
    },
    onDirectoryComplete: (raw, { cancelled }) => {
      const target = logicalPath(raw);
      const row = rowFor(target);
      if (row) {
        row.pendingDirectories = Math.max(0, row.pendingDirectories - 1);
        if (cancelled) row.status = 'cancelled';
        else if (row.pendingDirectories === 0) row.status = row.skipped ? 'partial' : 'complete';
      } else if (rows.has('__root_files__')) rows.get('__root_files__').status = cancelled ? 'cancelled' : 'complete';
    },
    onEntry: (raw, info, allocated) => {
      const target = logicalPath(raw);
      const marker = projectMarker(target, home, info);
      if (marker) {
        const found = projectRoots.get(marker.path) || { path: marker.path, markers: [] };
        if (!found.markers.includes(marker.marker)) found.markers.push(marker.marker);
        projectRoots.set(marker.path, found);
      }
      if (raw === scope.path) rootDevice = info.dev;
      const category = categoryFor(target);
      const row = rowFor(target, info);
      if (row && info.isDirectory()) {
        if (scope.stayOnDevice && info.dev !== rootDevice) row.status = 'mount';
        else row.pendingDirectories++;
      }
      if (info.isFile()) {
        if (row) { row.bytes += allocated; row.count++; }
        if (category) { category.bytes += allocated; category.count++; }
        if (category?.selectable && path.dirname(target) === category.path && eligible(category.id, path.basename(target), info)) {
          const item = { id: randomUUID(), category: category.id, name: path.basename(target), path: target, bytes: allocated, modifiedAt: new Date(info.mtimeMs).toISOString(), dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, root: category.path };
          items.push(item);
          category.candidates++;
          category.candidateBytes += allocated;
        }
      }
    },
    onError: async detail => {
      const logical = { ...detail, path: logicalPath(detail.path) };
      const category = categoryFor(logical.path);
      if (category) { category.skipped++; category.partial = true; category.lastError = logical; }
      const row = rowFor(logical.path);
      if (row) { row.skipped++; row.partial = true; }
      await onError(logical);
    },
    onProgress: stats => onProgress({ ...stats, currentPath: logicalPath(stats.currentPath), scope, errors: stats.errors.map(detail => ({ ...detail, path: logicalPath(detail.path) })), rows: [...rows.values()].map(row => ({ ...row })), categories: categories.map(category => ({ ...category })), candidateCount: items.length, candidateBytes: items.reduce((sum, item) => sum + item.bytes, 0) }),
  });
  const createdAt = new Date().toISOString();
  const common = { jobId, scope, startedAt, createdAt, complete: !measurement.cancelled, partial: measurement.partial, cancelled: measurement.cancelled, elapsedMs: measurement.elapsedMs, errorCount: measurement.skipped, errorCounts: measurement.errorCounts, errors: measurement.errors.map(detail => ({ ...detail, path: logicalPath(detail.path) })), symlinks: measurement.symlinks, mountPoints: measurement.mountPoints, duplicateDirectories: measurement.duplicateDirectories, visited: measurement.visited, directories: measurement.directories };
  return {
    scan: { ...common, id: randomUUID(), categories, items, projectRoots: [...projectRoots.values()].sort((a, b) => a.path.localeCompare(b.path)), totalBytes: measurement.bytes, candidateBytes: items.reduce((sum, item) => sum + item.bytes, 0), count: measurement.count },
    analysis: { ...common, rows: [...rows.values()].sort((a, b) => b.bytes - a.bytes), totalBytes: measurement.bytes, count: measurement.count },
  };
}

export async function scan(home = os.homedir(), onProgress = () => {}, options = {}) { return (await inventory(home, { ...options, onProgress })).scan; }
export async function analyze(home = os.homedir(), options = {}) { return (await inventory(home, options)).analysis; }
export function publicScan(result) { return { ...result, items: result.items.map(({ dev, ino, size, mtimeMs, ctimeMs, root, ...item }) => item) }; }
