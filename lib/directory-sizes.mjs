import path from 'node:path';
import { lstat, realpath, opendir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

const within = (child, root) => child === root || child.startsWith(root + path.sep);
const metrics = ['bytes', 'logicalBytes', 'files', 'directories', 'links', 'crossVolumes', 'specialFiles', 'skipped', 'sharedFiles'];
const empty = () => Object.fromEntries(metrics.map(key => [key, 0]));

// Metadata only. Keep directory aggregates, not a second index of every file.
// Hard links are deduplicated independently in each directory subtree, so the
// parent counts a shared inode once even when it appears in several children.
export async function measureDirectorySizes({ home, root, cancelled = () => false, onProgress = () => {} }) {
  home = await realpath(home);
  if (!within(root, home) || root === home || path.resolve(root) !== root) throw new Error('目录超出已登记项目范围');
  const device = (await lstat(home)).dev, rows = new Map(), hardlinks = new Map(), stats = empty(), errors = [];
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.dev !== device || await realpath(root) !== root) throw new Error('项目目录已变化、跨卷或包含符号链接');
  let last = 0;
  const check = () => { if (cancelled()) throw new Error('文件夹统计已停止'); };
  function progress(currentPath, force = false) { if (force || Date.now() - last > 400) { last = Date.now(); onProgress({ ...stats, currentPath }); } }
  function fail(row, filename, error) { row.skipped++; stats.skipped++; if (errors.length < 40) errors.push({ path: filename, code: error.code || 'READ_ERROR', reason: error.message }); }
  const pending = [{ filename: root, expected: rootInfo }];
  while (pending.length) {
    check();
    const { filename, expected } = pending.pop(), row = { path: filename, dev: expected.dev, ino: expected.ino, ...empty(), sharedBytes: 0 };
    rows.set(filename, row);
    try {
      const info = await lstat(filename);
      if (!info.isDirectory() || info.dev !== expected.dev || info.ino !== expected.ino || await realpath(filename) !== filename) throw new Error('目录身份或路径在统计期间变化');
      stats.directories++; progress(filename);
      const consume = async entries => Promise.all(entries.map(async entry => {
        check(); const file = path.join(filename, entry.name);
        try {
          const info = await lstat(file);
          if (info.isSymbolicLink()) { row.links++; stats.links++; return; }
          if (info.dev !== device) { row.crossVolumes++; stats.crossVolumes++; return; }
          if (await realpath(file) !== file) throw new Error('路径在统计期间变化，未计入');
          if (info.isDirectory()) { pending.push({ filename: file, expected: info }); return; }
          if (!info.isFile()) { row.specialFiles++; stats.specialFiles++; return; }
          row.files++; stats.files++;
          if (info.nlink > 1) {
            const id = `${info.dev}:${info.ino}`;
            let shared = hardlinks.get(id);
            if (!shared) { shared = { bytes: info.blocks * 512, logicalBytes: info.size, parents: new Set() }; hardlinks.set(id, shared); stats.bytes += shared.bytes; stats.logicalBytes += shared.logicalBytes; }
            shared.parents.add(filename); row.sharedFiles++; stats.sharedFiles++;
          } else { row.bytes += info.blocks * 512; row.logicalBytes += info.size; stats.bytes += info.blocks * 512; stats.logicalBytes += info.size; }
        } catch (error) { check(); fail(row, file, error); }
      }));
      let batch = [];
      for await (const entry of await opendir(filename)) { check(); batch.push(entry); if (batch.length >= 16) { await consume(batch); batch = []; progress(filename); } }
      if (batch.length) await consume(batch);
      const after = await lstat(filename);
      if (after.dev !== info.dev || after.ino !== info.ino || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || await realpath(filename) !== filename) throw new Error('目录在统计期间变动，结果可能不完整');
    } catch (error) { check(); fail(row, filename, error); }
  }
  // Aggregate ordinary files and read errors from children to ancestors.
  for (const row of [...rows.values()].sort((a, b) => b.path.length - a.path.length)) {
    check(); if (row.path === root) continue;
    const parent = rows.get(path.dirname(row.path));
    if (parent) { for (const key of metrics) parent[key] += row[key]; parent.directories++; }
  }
  for (const shared of hardlinks.values()) {
    check(); const ancestors = new Set();
    for (const parent of shared.parents) { let directory = parent; while (within(directory, root)) { ancestors.add(directory); if (directory === root) break; directory = path.dirname(directory); } }
    for (const directory of ancestors) { const row = rows.get(directory); if (row) { row.bytes += shared.bytes; row.logicalBytes += shared.logicalBytes; row.sharedBytes += shared.bytes; } }
  }
  check();
  const finalRoot = await lstat(root);
  if (!finalRoot.isDirectory() || finalRoot.dev !== rootInfo.dev || finalRoot.ino !== rootInfo.ino || await realpath(root) !== root) throw new Error('项目目录已被替换，未使用此次结果');
  progress(root, true);
  return { root, createdAt: new Date().toISOString(), rows: [...rows.values()], stats, errors };
}

function runDirectorySizes({ home, root, onProgress, onDone }) {
  const buffer = new SharedArrayBuffer(4), flag = new Int32Array(buffer);
  const worker = new Worker(new URL('./directory-sizes-worker.mjs', import.meta.url), { workerData: { home, root, buffer }, execArgv: [] });
  let finished = false, stopping = false, timer;
  function finish(result) { if (finished) return; finished = true; clearTimeout(timer); onDone(result); }
  worker.on('message', value => value.type === 'progress' ? onProgress(value.stats) : finish(value));
  worker.on('error', error => finish({ type: 'failure', error: error.message, cancelled: stopping }));
  worker.on('exit', () => { if (!finished) finish({ type: 'failure', error: stopping ? '文件夹统计已停止' : '文件夹统计进程提前退出', cancelled: stopping }); });
  return { cancel() { if (finished || stopping) return; stopping = true; Atomics.store(flag, 0, 1); timer = setTimeout(() => worker.terminate(), 1500); timer.unref(); } };
}

// One worker at a time; completed caches are bounded and shared by all tabs.
export function createDirectorySizeScanner({ home }) {
  const jobs = new Map(), queue = [];
  let active = null, disposed = false;
  const busy = job => ['queued', 'running', 'cancelling'].includes(job?.status);
  const publicRow = row => { if (!row) return null; const { dev, ino, ...value } = row; return value; };
  const publicJob = job => job ? { id: job.id, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt, createdAt: job.result?.createdAt, stats: job.stats, error: job.error, summary: publicRow(job.result?.rows.get(job.root)), errors: job.result?.errors } : { status: 'idle' };
  function next() {
    if (active || disposed) return;
    const job = queue.shift(); if (!job) return;
    if (job.status !== 'queued') return next();
    active = job; job.status = 'running'; job.startedAt = new Date().toISOString();
    job.runner = runDirectorySizes({ home, root: job.root, onProgress: stats => { job.stats = stats; }, onDone: outcome => {
      job.finishedAt = new Date().toISOString(); job.runner = null;
      if (outcome.type === 'result' && job.status !== 'cancelling') { job.status = 'complete'; job.stats = outcome.result.stats; job.result = { ...outcome.result, rows: new Map(outcome.result.rows.map(row => [row.path, row])) }; }
      else { job.status = outcome.cancelled || job.status === 'cancelling' ? 'cancelled' : 'failed'; job.error = outcome.error || '文件夹统计已停止'; }
      active = null;
      const completed = [...jobs.values()].filter(j => !busy(j)).sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
      for (const old of completed.slice(4)) jobs.delete(old.root);
      next();
    } });
  }
  return {
    status(root) { return publicJob(jobs.get(root)); },
    result(root, filename, info) { const job = jobs.get(root), row = job?.result?.rows.get(filename); return row && row.dev === info.dev && row.ino === info.ino ? { ...publicRow(row), status: row.skipped ? 'partial' : 'complete', createdAt: job.result.createdAt } : null; },
    start(root, refresh = false) {
      if (disposed) throw new Error('文件夹统计已过期，请刷新页面');
      const previous = jobs.get(root);
      if (previous && (busy(previous) || !refresh)) return publicJob(previous);
      if (queue.filter(busy).length >= 8) throw new Error('待统计项目较多，请稍后重试');
      const job = { id: randomUUID(), root, status: 'queued', stats: empty() }; jobs.set(root, job); queue.push(job); next(); return publicJob(job);
    },
    cancel(root) { const job = jobs.get(root); if (job?.status === 'queued') { job.status = 'cancelled'; job.finishedAt = new Date().toISOString(); } else if (job?.status === 'running') { job.status = 'cancelling'; job.runner.cancel(); } return publicJob(job); },
    dispose() { disposed = true; queue.length = 0; active?.runner?.cancel(); jobs.clear(); },
  };
}
