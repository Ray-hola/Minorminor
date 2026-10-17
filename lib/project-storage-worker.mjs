import { workerData, parentPort } from 'node:worker_threads';
import { measureProjectStorage } from './project-storage.mjs';
const flag = new Int32Array(workerData.buffer);
try {
  const result = await measureProjectStorage({ home: workerData.home, report: workerData.report, cancelled: () => Atomics.load(flag, 0) === 1, onProgress: stats => parentPort.postMessage({ type: 'progress', stats }) });
  parentPort.postMessage({ type: 'result', result });
} catch (error) { parentPort.postMessage({ type: 'failure', error: error.message, cancelled: Atomics.load(flag, 0) === 1 }); }
finally { parentPort.close(); }
