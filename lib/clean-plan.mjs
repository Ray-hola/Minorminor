import { lstat, realpath, opendir, unlink, rmdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { projectRoot } from './mole.mjs';
import { storagePurpose } from './storage-purpose.mjs';

export const PLAN_TTL = 30 * 60_000;
const inside = (child, parent) => child.startsWith(parent + path.sep);
const identity = info => ({ dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, nlink: info.nlink });
const same = (info, saved) => Object.keys(saved).every(key => info[key] === saved[key]);
const sectionNames = { 'User essentials': '用户缓存与日志', 'App caches': '应用缓存', Browsers: '浏览器缓存', 'Developer tools': '开发工具缓存', 'Apps & utilities': '应用与工具', 'Application Support': '应用支持缓存' };

// A preview is discovery evidence, never arbitrary path authorization. Keep the
// selectable surface to rebuildable user caches and logs, with no root folders.
export function supportedTarget(filename, home) {
  if (storagePurpose(filename)) return false;
  const relative = path.relative(home, filename);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.resolve(filename) !== filename || /[\x00-\x1f\x7f]/.test(filename)) return false;
  return /^Library\/(Caches|Logs)\/[^/]+(?:\/.*)?$/.test(relative)
    || /^\.npm\/_cacache\/[^/]+(?:\/.*)?$/.test(relative)
    || /^\.cache\/(pip|uv|go-build)\/[^/]+(?:\/.*)?$/.test(relative)
    || /^Library\/Containers\/[^/]+\/Data\/(tmp|Library\/Caches)\/[^/]+(?:\/.*)?$/.test(relative)
    || /^Library\/Application Support\/CrashReporter\/[^/]+$/.test(relative)
    || /^Library\/Application Support\/[^/]+\/(?:[^/]+\/)*(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache)(?:\/.*)?$/.test(relative);
}

export function parsePreview(contents) {
  let section = '其他';
  const seen = new Set();
  const rows = [];
  for (const line of contents.split('\n')) {
    const heading = line.match(/^=== (.+) ===$/);
    if (heading) { section = sectionNames[heading[1]] || heading[1]; continue; }
    const separator = line.lastIndexOf('  # ');
    if (!line.startsWith('/') || separator < 1) continue;
    const filename = line.slice(0, separator);
    if (seen.has(filename)) continue;
    seen.add(filename);
    rows.push({ path: filename, category: section, estimate: line.slice(separator + 4), id: randomUUID(), name: path.basename(filename) });
  }
  return rows;
}

async function inventory(filename) {
  const nodes = [];
  const pending = [filename];
  const counted = new Set();
  let bytes = 0, files = 0, directories = 0;
  const device = (await lstat(filename)).dev;
  while (pending.length) {
    const current = pending.pop();
    if (storagePurpose(current)) throw new Error('包含虚拟机磁盘或运行环境，保留，由所属应用管理');
    const info = await lstat(current);
    if (info.dev !== device || info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new Error('包含符号链接、挂载卷或特殊文件，保留此项');
    const type = info.isDirectory() ? 'directory' : 'file';
    const nodeBytes = type === 'file' ? info.blocks * 512 : 0;
    nodes.push({ path: current, type, bytes: nodeBytes, ...identity(info) });
    if (type === 'directory') {
      directories++;
      const directory = await opendir(current);
      for await (const child of directory) pending.push(path.join(current, child.name));
    } else {
      files++;
      const key = `${info.dev}:${info.ino}`;
      if (!counted.has(key)) { counted.add(key); bytes += nodeBytes; }
    }
  }
  return { nodes, bytes, files, directories };
}

export async function buildCleanPlan({ contents, home, previewId, onProgress = () => {} }) {
  const rows = parsePreview(contents);
  const plan = { id: randomUUID(), previewId, home, createdAt: new Date().toISOString(), items: rows };
  // Keep each path in precisely one selectable group. Nested Mole ledger rows
  // remain visible, but their content is selectable through the outer row only.
  const candidates = rows.filter(row => supportedTarget(row.path, home)).sort((a, b) => a.path.length - b.path.length);
  for (const row of rows) {
    onProgress({ currentPath: row.path, completed: rows.indexOf(row), total: rows.length });
    row.reason = row.path.includes('/Logs/') || row.category === '应用与工具' ? 'Mole 识别的日志或诊断文件' : 'Mole 识别的可重建缓存；下次使用应用可能重新生成';
    row.method = '永久删除已审阅的文件';
    if (!supportedTarget(row.path, home)) { row.blocked = '超出逐项清理支持的缓存和日志范围，仅展示'; continue; }
    const ancestor = candidates.find(other => other !== row && inside(row.path, other.path));
    if (ancestor) { row.coveredBy = ancestor.id; row.blocked = `已包含在 ${ancestor.name} 中，请从上级项目选择`; continue; }
    try {
      if (await realpath(row.path) !== row.path) throw new Error('路径包含符号链接，保留此项');
      const parent = await lstat(path.dirname(row.path));
      row.parent = { path: path.dirname(row.path), dev: parent.dev, ino: parent.ino };
      Object.assign(row, await inventory(row.path));
      row.type = row.nodes[0].type;
      row.selectable = true;
    } catch (error) { row.blocked = error.code === 'ENOENT' ? '预览后路径已消失，请重新生成清单' : error.code === 'EPERM' || error.code === 'EACCES' ? 'macOS 拒绝读取，无法生成完整清单' : error.message; }
  }
  return plan;
}

export function publicPlan(plan) {
  if (!plan) return null;
  return { id: plan.id, previewId: plan.previewId, createdAt: plan.createdAt, usedBy: plan.usedBy, items: plan.items.map(({ nodes, parent, ...row }) => row) };
}

export function selectPlanItems(plan, ids) {
  if (!plan || Date.now() - Date.parse(plan.createdAt) > PLAN_TTL) throw new Error('清理清单已过期，请重新生成');
  if (plan.usedBy) throw new Error('这份清单已使用，请重新生成');
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('请选择有效项目');
  return ids.map(id => {
    const item = plan.items.find(row => row.id === id);
    if (!item?.selectable || item.blocked) throw new Error('所选项目不在本次允许清理的范围内');
    return item;
  });
}

// Read-only Mole safety checks. Never launch `mo clean` for a selected subset.
export function checkMoleTarget(filename, home) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [path.join(projectRoot, 'scripts/check-clean-target.sh'), filename], { env: { PATH: process.env.PATH, HOME: home, TERM: 'dumb', NO_COLOR: '1', MOLE_DRY_RUN: '0', MOLE_TEST_NO_AUTH: '1', MO_NO_OPLOG: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); }, 30_000);
    timeout.unref();
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(output.trim() || 'Mole 安全检查未通过，可能正在使用、受保护或权限不足')); });
  });
}

async function verifyItem(item, home) {
  if (!supportedTarget(item.path, home) || await realpath(item.path) !== item.path) throw new Error('路径已变化，请重新生成清单');
  const parent = await lstat(item.parent.path);
  if (parent.dev !== item.parent.dev || parent.ino !== item.parent.ino) throw new Error('上级目录已被替换');
  const current = await inventory(item.path);
  const before = new Map(item.nodes.map(node => [node.path, node]));
  if (current.nodes.length !== before.size || current.nodes.some(node => !before.has(node.path) || !same(node, identity(before.get(node.path)))) ) throw new Error('预览后文件或目录内容已变化，请重新生成清单');
}

export async function executePlan(plan, selected, { guard = checkMoleTarget, cancelled = () => false, onProgress = () => {}, onRecord = async () => {} } = {}) {
  const results = [];
  for (const item of selected) {
    const nodeByPath = new Map(item.nodes.map(node => [node.path, node]));
    const records = [];
    let error;
    let allowed = false;
    try {
      if (cancelled()) throw new Error('任务已停止，保留未处理文件');
      await verifyItem(item, plan.home);
      await guard(item.path, plan.home);
      // Slow native owner probes may overlap with applications writing caches.
      await verifyItem(item, plan.home);
      allowed = true;
    } catch (failure) { error = failure.message; }
    if (allowed) {
      const ordered = [...item.nodes].sort((a, b) => b.path.length - a.path.length);
      let checkedAt = Date.now();
      let liveError;
      for (const node of ordered) {
        let status = 'skipped', reason;
        try {
          if (cancelled()) throw new Error('任务已停止，保留未处理文件');
          if (liveError) throw liveError;
          if (Date.now() - checkedAt > 5000) { try { await guard(item.path, plan.home); checkedAt = Date.now(); } catch (error) { liveError = error; throw error; } }
          if (await realpath(path.dirname(node.path)) !== path.dirname(node.path)) throw new Error('上级目录路径已变化');
          const parentNode = nodeByPath.get(path.dirname(node.path)) || item.parent;
          const parentInfo = await lstat(path.dirname(node.path));
          if (parentInfo.dev !== parentNode.dev || parentInfo.ino !== parentNode.ino) throw new Error('上级目录已被替换');
          const info = await lstat(node.path);
          if (info.isSymbolicLink() || info.dev !== node.dev || info.ino !== node.ino || node.type === 'file' && (!info.isFile() || !same(info, identity(node))) || node.type === 'directory' && !info.isDirectory()) throw new Error('文件身份或内容已变化，已保留');
          // No recursive removal: newly created/unreviewed children survive.
          if (node.type === 'file') await unlink(node.path);
          else await rmdir(node.path);
          status = 'deleted';
        } catch (failure) { reason = failure.code === 'ENOTEMPTY' ? '目录中还有新文件或被保留的文件' : failure.code === 'EPERM' || failure.code === 'EACCES' ? 'macOS 拒绝删除，文件已保留' : failure.code === 'ENOENT' ? '执行前路径已不存在，未计为本次删除' : failure.message; }
        const record = { itemId: item.id, path: node.path, type: node.type, bytes: node.bytes, status, reason };
        records.push(record);
        await onRecord(record);
        if (records.length % 100 === 0) onProgress({ completed: results.length, total: selected.length, currentPath: node.path, results: [...results], processed: records.length, files: item.files });
      }
    } else {
      for (const node of item.nodes) {
        const record = { itemId: item.id, path: node.path, type: node.type, bytes: node.bytes, status: 'skipped', reason: error };
        records.push(record); await onRecord(record);
      }
    }
    const deleted = records.filter(record => record.status === 'deleted');
    const status = deleted.length === records.length ? 'deleted' : deleted.length ? 'partial' : 'skipped';
    // Deleted allocated bytes are estimates; snapshots/clones may retain space.
    const counts = new Map();
    for (const record of deleted.filter(row => row.type === 'file')) {
      const original = nodeByPath.get(record.path);
      const key = `${original.dev}:${original.ino}`;
      const value = counts.get(key) || { count: 0, bytes: original.bytes, links: original.nlink };
      value.count++; counts.set(key, value);
    }
    const result = { id: item.id, name: item.name, path: item.path, category: item.category, status, deletedFiles: deleted.filter(row => row.type === 'file').length, deletedDirectories: deleted.filter(row => row.type === 'directory').length, skipped: records.length - deleted.length, bytes: [...counts.values()].filter(value => value.count >= value.links).reduce((sum, value) => sum + value.bytes, 0), reason: error || records.find(row => row.reason)?.reason };
    results.push(result);
    onProgress({ completed: results.length, total: selected.length, currentPath: item.path, results: [...results] });
  }
  return { kind: 'selection', createdAt: new Date().toISOString(), status: cancelled() ? 'cancelled' : 'complete', results, deletedFiles: results.reduce((sum, row) => sum + row.deletedFiles, 0), bytes: results.reduce((sum, row) => sum + row.bytes, 0), skipped: results.reduce((sum, row) => sum + row.skipped, 0) };
}

export async function readPreviewFile(home, since) {
  const filename = path.join(home, '.config/mole/clean-list.txt');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename || info.mtimeMs < since - 2000) throw new Error('没有找到本次 Mole 的具体路径清单，请重新生成预览');
  return readFile(filename, 'utf8');
}
