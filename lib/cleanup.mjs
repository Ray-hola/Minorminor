import { lstat, realpath, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { eligible, locations } from './scanner.mjs';

export async function validateCandidate(item, home) {
  const root = locations(home)[item.category];
  if (!root || !['logs', 'installers'].includes(item.category) || path.dirname(item.path) !== root) throw new Error('文件不在允许的清理范围内');
  if (await realpath(root) !== root || item.root !== root) throw new Error('目录已变化或包含符号链接，请重新扫描');
  const info = await lstat(item.path);
  if (!eligible(item.category, path.basename(item.path), info) || info.dev !== item.dev || info.ino !== item.ino || info.size !== item.size || info.mtimeMs !== item.mtimeMs || info.ctimeMs !== item.ctimeMs) throw new Error('文件已变化，请重新扫描');
  return info;
}

// Explicit selection only. Atomic rename on the same filesystem, no recursive deletion.
export async function moveToTrash(snapshot, ids, home) {
  if (snapshot?.stale) throw new Error('文件已在清理后发生变化，请重新扫描再逐项整理');
  if (snapshot?.complete === false) throw new Error('扫描已取消，请完成一次扫描后再整理');
  if (!snapshot || Date.now() - Date.parse(snapshot.createdAt) > 10 * 60_000) throw new Error('扫描已过期，请重新扫描后再整理');
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('请选择有效的文件');
  const byId = new Map(snapshot.items.map(item => [item.id, item]));
  const selected = ids.map(id => { const item = byId.get(id); if (!item) throw new Error('文件不属于本次扫描'); return item; });
  const trash = path.join(home, '.Trash');
  await mkdir(trash, { recursive: true, mode: 0o700 });
  if ((await lstat(trash)).isSymbolicLink() || await realpath(trash) !== trash) throw new Error('废纸篓路径异常，操作已停止');
  const results = [];
  for (const item of selected) {
    try {
      await validateCandidate(item, home);
      const destination = path.join(trash, `Minorminor-${randomUUID()}-${item.name}`);
      await rename(item.path, destination);
      results.push({ id: item.id, name: item.name, originalPath: item.path, trashPath: destination, bytes: item.bytes, status: 'moved' });
    } catch (error) {
      results.push({ id: item.id, name: item.name, status: 'skipped', error: error.message });
    }
  }
  return { createdAt: new Date().toISOString(), results, moved: results.filter(item => item.status === 'moved').length, bytes: results.filter(item => item.status === 'moved').reduce((sum, item) => sum + item.bytes, 0) };
}
