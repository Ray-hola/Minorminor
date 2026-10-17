import { Worker } from 'node:worker_threads';
import path from 'node:path';

export function runSynchronizedScan({ home, scope, jobId, runtimeDirectory, onProgress, onDone }) {
  const errorLog = path.join(runtimeDirectory, 'scans', `${jobId}.sync.errors.jsonl`);
  const buffer = new SharedArrayBuffer(4), flag = new Int32Array(buffer);
  const worker = new Worker(new URL('./synchronized-scan-worker.mjs', import.meta.url), { workerData: { home, scope, jobId, errorLog, buffer }, execArgv: [] });
  let finished = false, reason = null, timer, stats;
  function finish(value) { if (finished) return; finished = true; clearTimeout(timer); onDone({ ...value, reason }); }
  worker.on('message', value => value.type === 'progress' ? !finished && (stats = value.stats, onProgress(stats)) : finish(value));
  worker.on('error', error => finish({ type: 'failure', error: error.message, cancelled: !!reason }));
  worker.on('exit', () => { if (!finished) finish({ type: 'failure', error: reason || '同步扫描进程提前退出', cancelled: !!reason }); });
  return { errorLog, cancel(message = '扫描已停止') { if (finished || reason) return; reason = message; Atomics.store(flag, 0, 1); timer = setTimeout(() => { finish({ type: 'failure', error: reason, cancelled: true, errorCountsByPhase: stats?.errorCountsByPhase }); void worker.terminate().catch(() => {}); }, 1500); timer.unref(); } };
}
