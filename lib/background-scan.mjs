import { Worker } from 'node:worker_threads';
import path from 'node:path';

export function runBackgroundScan({ home, scope, jobId, runtimeDirectory, onProgress, onDone }) {
  const errorLog = path.join(runtimeDirectory, 'scans', `${jobId}.errors.jsonl`);
  const cancelBuffer = new SharedArrayBuffer(4);
  const flag = new Int32Array(cancelBuffer);
  const worker = new Worker(new URL('./scan-worker.mjs', import.meta.url), { workerData: { home, scope, jobId, errorLog, cancelBuffer }, execArgv: [] });
  let finished = false, reason = null, hardStop;
  function finish(value) {
    if (finished) return;
    finished = true; clearTimeout(hardStop);
    onDone({ ...value, reason });
  }
  worker.on('message', message => {
    if (finished) return;
    if (message.type === 'progress') onProgress(message.stats);
    else if (message.type === 'result') finish({ status: message.result.scan.cancelled ? 'cancelled' : 'complete', result: message.result });
    else if (message.type === 'failure') finish({ status: reason ? 'cancelled' : 'failed', error: message.error });
  });
  worker.on('error', error => finish({ status: reason ? 'cancelled' : 'failed', error: error.message }));
  worker.on('exit', code => { if (!finished) finish({ status: reason ? 'cancelled' : 'failed', error: reason || `扫描进程提前退出（${code}）` }); });
  return {
    errorLog,
    cancel(message = '用户已取消扫描') {
      if (finished || reason) return;
      reason = message;
      Atomics.store(flag, 0, 1);
      hardStop = setTimeout(() => { worker.terminate(); }, 1500);
      hardStop.unref();
    },
  };
}
