import { opendir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { classifyKnownAiPath, discoverAgents, localDiscoveryOptions } from './agent-discovery.mjs';
import { storagePurpose } from './storage-purpose.mjs';

export const classifyAiPath = classifyKnownAiPath;

async function measure(filename, { cancelled, onProgress, seenFiles, seenDirectories, seenPaths, scopePaths }) {
  const pending = [filename];
  const rootInfo = await lstat(filename), device = rootInfo.dev;
  let bytes = 0, files = 0, directories = 0, skipped = 0, links = 0, latestMtime = 0;
  const errors = [];
  while (pending.length) {
    if (cancelled()) throw new Error('AI 专项扫描已停止');
    const current = pending.pop();
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) { links++; continue; }
      if (info.dev !== device) { skipped++; continue; }
      const key = `${info.dev}:${info.ino}`;
      if (info.isDirectory()) {
        if (seenDirectories.has(key)) continue;
        seenDirectories.add(key); directories++;
        const directory = await opendir(current);
        for await (const child of directory) pending.push(path.join(current, child.name));
      } else if (info.isFile()) {
        // Only an explicitly listed file scope can also occur inside a parent
        // directory scope. Avoid retaining every filename in the entire scan.
        if (scopePaths.has(current)) {
          if (seenPaths.has(current)) continue;
          seenPaths.add(current);
        }
        files++;
        if (!seenFiles.has(key)) { seenFiles.add(key); bytes += info.blocks * 512; }
        latestMtime = Math.max(latestMtime, info.mtimeMs);
      }
      if ((files + directories) % 100 === 0) onProgress({ currentPath: current, files, directories, bytes });
    } catch (error) { skipped++; errors.push({ path: current, code: error.code || 'ERROR', reason: error.message }); }
  }
  return { type: rootInfo.isDirectory() ? 'directory' : 'file', bytes, files, directories, skipped, links, latestMtime, errors };
}

export async function scanAiStorage({ home, discoveryOptions = localDiscoveryOptions(home), cancelled = () => false, onProgress = () => {}, onError = async () => {} }) {
  onProgress({ phase: 'discover', currentPath: home, directories: 0 });
  const discovery = await discoverAgents({ ...discoveryOptions, home, cancelled, onProgress, onError });
  // Children are accounted first so a more specific owner/cache retains its
  // attribution, and the parent reports only the remaining physical storage.
  const roots = discovery.roots.slice().sort((a, b) => b.path.split(path.sep).length - a.path.split(path.sep).length || a.path.localeCompare(b.path));
  let errorCount = discovery.coverage.errors;
  const items = [], seenFiles = new Set(), seenDirectories = new Set(), seenPaths = new Set();
  const scopePaths = new Set(roots.map(root => root.path));
  for (const root of roots) {
    if (cancelled()) throw new Error('AI 专项扫描已停止');
    onProgress({ phase: 'measure', completed: items.length, total: roots.length, currentPath: root.path });
    try {
      if (await realpath(root.path) !== root.path) throw new Error('路径包含符号链接，未进入');
      const result = await measure(root.path, { cancelled, seenFiles, seenDirectories, seenPaths, scopePaths, onProgress: stats => onProgress({ ...stats, phase: 'measure', completed: items.length, total: roots.length }) });
      errorCount += result.errors.length;
      for (const error of result.errors) await onError(error);
      const { errors, ...stats } = result;
      const purpose = storagePurpose(root.path);
      items.push({ ...root, ...stats, storageType: purpose?.type, id: randomUUID(), name: path.basename(root.path), selectable: false, reason: purpose?.purpose || (root.discoveryMode === 'generic' ? '自动发现的工具候选；用途为结构推断，保留；清理范围须由具体文件预览单独核对' : root.installedComponent || root.installation ? '工具安装组件或程序文件，保留；由所属工具管理，不作为缓存删除' : root.aiKind === 'model' ? '模型、数据集或下载状态；需确认用途并由所属工具管理' : root.aiKind === 'state' ? '可能包含会话、配置、密钥、索引或项目文件，保留' : '可重建缓存；具体可清理文件以最新 Mole 清单和安全检查为准') });
    } catch (error) {
      if (cancelled()) throw error;
      if (error.code === 'ENOENT') continue;
      errorCount++; await onError({ path: root.path, code: error.code || 'ERROR', reason: error.message });
      items.push({ ...root, id: randomUUID(), name: path.basename(root.path), bytes: 0, files: 0, skipped: 1, selectable: false, reason: '无法完整读取：' + error.message });
    }
  }
  return { id: randomUUID(), createdAt: new Date().toISOString(), complete: true, errorCount, discovery, items, bytes: items.reduce((sum, row) => sum + row.bytes, 0), files: items.reduce((sum, row) => sum + row.files, 0) };
}

const ollamaBase = 'http://127.0.0.1:11434';
export async function ollamaModels({ fetcher = fetch, signal } = {}) {
  const response = await fetcher(ollamaBase + '/api/tags', { signal: signal || AbortSignal.timeout(2500), redirect: 'error' });
  if (!response.ok) throw new Error('Ollama 模型列表读取失败');
  const data = await response.json();
  if (!Array.isArray(data.models)) throw new Error('Ollama 模型列表格式异常');
  return data.models.map(row => ({ id: randomUUID(), name: row.name, digest: row.digest, bytes: row.size, modifiedAt: row.modified_at })).filter(row => typeof row.name === 'string' && row.name.length < 256 && typeof row.digest === 'string');
}

export async function deleteOllamaModel(snapshot, modelId, { fetcher = fetch, signal } = {}) {
  if (!snapshot || snapshot.stale || Date.now() - Date.parse(snapshot.createdAt) > 30 * 60_000) throw new Error('模型清单已过期，请重新扫描 AI 专项');
  const selected = snapshot.ollama?.models.find(row => row.id === modelId);
  if (!selected || selected.deleted) throw new Error('模型不属于当前清单或已删除');
  const current = (await ollamaModels({ fetcher, signal })).find(row => row.name === selected.name);
  if (!current || current.digest !== selected.digest) throw new Error('模型已变化，请重新扫描');
  const busyResponse = await fetcher(ollamaBase + '/api/ps', { signal, redirect: 'error' });
  if (!busyResponse.ok) throw new Error('无法确认模型运行状态，已保留');
  const busy = await busyResponse.json();
  if (!Array.isArray(busy.models) || busy.models.some(row => row.name === selected.name || row.model === selected.name || row.digest === selected.digest)) throw new Error('模型正在使用或状态未知，请先在所属工具中停止使用');
  const response = await fetcher(ollamaBase + '/api/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected.name }), signal, redirect: 'error' });
  if (!response.ok) throw new Error(`Ollama 移除模型失败（${response.status}）`);
  if ((await ollamaModels({ fetcher, signal })).some(row => row.name === selected.name)) throw new Error('Ollama 仍报告该模型存在，请刷新后核对');
  selected.deleted = true;
  return { id: selected.id, name: selected.name, status: 'deleted', digest: selected.digest, bytes: selected.bytes, note: '已由 Ollama 移除模型；共享层与实际磁盘释放量由 Ollama 管理' };
}
