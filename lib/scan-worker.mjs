import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { inventory } from './scanner.mjs';

const cancelled = new Int32Array(workerData.cancelBuffer);
const signal = { get aborted() { return Atomics.load(cancelled, 0) === 1; } };
let stats = { count: 0, bytes: 0, directories: 0, skipped: 0, currentPath: workerData.scope.displayPath, elapsedMs: 0, scope: workerData.scope, rows: [] };
const start = Date.now();
const heartbeat = setInterval(() => parentPort.postMessage({ type: 'progress', stats: { ...stats, elapsedMs: Date.now() - start } }), 1000);
let log;
try {
  await mkdir(path.dirname(workerData.errorLog), { recursive: true, mode: 0o700 });
  log = await open(workerData.errorLog, 'wx', 0o600);
  let write = Promise.resolve();
  const result = await inventory(workerData.home, {
    scope: workerData.scope, jobId: workerData.jobId, signal,
    onProgress: value => { stats = value; parentPort.postMessage({ type: 'progress', stats }); },
    onError: detail => { write = write.then(() => log.writeFile(JSON.stringify(detail) + '\n')); return write; },
  });
  await write;
  await log.close(); log = null;
  parentPort.postMessage({ type: 'result', result });
} catch (error) { parentPort.postMessage({ type: 'failure', error: error.message }); }
finally { clearInterval(heartbeat); if (log) await log.close().catch(() => {}); parentPort.close(); }
