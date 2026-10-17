import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, realpath, opendir, open } from 'node:fs/promises';

const within = (file, root) => file === root || file.startsWith(root + path.sep);
export const associationStatuses = { readable: '可读取', recovered: '已补读', missing: '路径失效', permission: '权限受限', unsafe: '安全跳过', ambiguous: '存在多个匹配', 'not-file': '不是普通文件', error: '读取错误' };

export async function probeAssociation(filename, { home, device } = {}) {
  let handle;
  try {
    if (typeof filename !== 'string' || !within(filename, home) || path.resolve(filename) !== filename) return { status: 'unsafe', code: 'OUTSIDE_SCOPE', reason: '路径不在当前用户目录内，未读取' };
    const info = await lstat(filename);
    if (info.isSymbolicLink() || await realpath(filename) !== filename) return { status: 'unsafe', code: 'SYMLINK', reason: '符号链接或祖先路径发生重定向，未跟随' };
    if (device !== undefined && info.dev !== device) return { status: 'unsafe', code: 'CROSS_DEVICE', reason: '其他挂载卷，未跨卷读取' };
    if (!info.isFile()) return { status: 'not-file', code: 'NOT_FILE', reason: '索引指向的不是普通文件' };
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const current = await handle.stat();
    if (current.dev !== info.dev || current.ino !== info.ino || current.size !== info.size || current.ctimeMs !== info.ctimeMs) return { status: 'error', code: 'CHANGED', reason: '文件在核对期间发生变化，请重新扫描' };
    return { status: 'readable', code: 'OK', reason: '文件存在，已验证可读访问', bytes: current.blocks * 512 };
  } catch (error) {
    const status = ['ENOENT', 'ENOTDIR'].includes(error.code) ? 'missing' : ['EACCES', 'EPERM'].includes(error.code) ? 'permission' : 'error';
    return { status, code: error.code || 'READ_ERROR', reason: status === 'missing' ? '索引中的文件或上级目录已不存在' : status === 'permission' ? '系统隐私保护或文件权限拒绝读取' : error.message };
  } finally { await handle?.close(); }
}

// Exact names, within an adapter's explicit owner and session/archive roots.
// An index entry never grants access to another profile or a backup copy.
export function createAssociationResolver({ home, allowed, cancelled = () => false }) {
  const indexes = new Map();
  const key = filename => path.basename(filename).replace(/\.(?:zst|gz)$/i, '');
  const supported = filename => /\.(?:jsonl|ndjson|json|md)(?:\.(?:zst|gz))?$/i.test(filename);
  const check = () => { if (cancelled()) throw new Error('项目归类已停止'); };
  async function safeFile(filename) {
    check(); if (!within(filename, home) || !allowed(filename)) return false;
    try { const info = await lstat(filename); return info.isFile() && await realpath(filename) === filename; } catch { return false; }
  }
  async function index(ownerRoot, searchRoots) {
    const identity = JSON.stringify([ownerRoot, searchRoots]);
    if (indexes.has(identity)) return indexes.get(identity);
    const found = new Map(), pending = searchRoots.filter(root => within(root, ownerRoot) && allowed(root));
    const visited = new Set();
    while (pending.length) {
      check(); const directory = pending.pop();
      if (visited.has(directory)) continue;
      visited.add(directory);
      try {
        if (await realpath(directory) !== directory || !(await lstat(directory)).isDirectory()) continue;
        for await (const entry of await opendir(directory)) {
          check(); if (entry.isSymbolicLink()) continue;
          const filename = path.join(directory, entry.name);
          if (entry.isDirectory() && !/^(?:backups?|fixtures?|node_modules|vendor|\.git|\.Trash|\.private-backups)$/i.test(entry.name)) pending.push(filename);
          else if (entry.isFile() && supported(entry.name)) {
            const name = key(entry.name), rows = found.get(name) || [];
            rows.push(filename); found.set(name, rows);
          }
        }
      } catch (error) { check(); if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
    }
    indexes.set(identity, found); return found;
  }
  return async function resolve(filename, { ownerRoot, searchRoots = [] }) {
    if (typeof filename !== 'string') return {};
    const original = { physicalPath: filename, indexedPhysicalPath: filename };
    if (!ownerRoot || !within(ownerRoot, home) || !within(filename, ownerRoot) || path.resolve(filename) !== filename || !allowed(filename)) return original;
    try { await lstat(filename); return original; } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return original; }
    if (!supported(filename)) return original;
    const siblings = [];
    if (!/\.(?:zst|gz)$/i.test(filename)) for (const suffix of ['.zst', '.gz']) if (await safeFile(filename + suffix)) siblings.push(filename + suffix);
    if (siblings.length > 1) return { ...original, pathResolution: 'ambiguous' };
    if (siblings.length === 1) return { ...original, physicalPath: siblings[0], pathResolution: 'compressed' };
    const matches = ((await index(ownerRoot, searchRoots)).get(key(filename)) || []);
    if (matches.length > 1) return { ...original, pathResolution: 'ambiguous' };
    if (matches.length === 1 && await safeFile(matches[0])) return { ...original, physicalPath: matches[0], pathResolution: /(?:^|\/)(?:archives?|archived_sessions)(?:\/|$)/.test(path.relative(ownerRoot, matches[0])) ? 'archived' : 'relocated' };
    return original;
  };
}

export function createCodexSessionResolver(options) {
  const resolve = createAssociationResolver(options);
  return (sourcePath, filename) => {
    const ownerRoot = path.dirname(sourcePath);
    return resolve(filename, { ownerRoot, searchRoots: ['sessions', 'archived_sessions'].map(name => path.join(ownerRoot, name)) });
  };
}
