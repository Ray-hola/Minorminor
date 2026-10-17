import { parentPort, workerData } from 'node:worker_threads';
import { measureDirectorySizes } from './directory-sizes.mjs';

const flag = new Int32Array(workerData.buffer);
try {
  const result = await measureDirectorySizes({ home: workerData.home, root: workerData.root, cancelled: () => Atomics.load(flag, 0) === 1, onProgress: stats => parentPort.postMessage({ type: 'progress', stats }) });
  parentPort.postMessage({ type: 'result', result });
} catch (error) { parentPort.postMessage({ type: 'failure', error: error.message, cancelled: Atomics.load(flag, 0) === 1 }); }
finally { parentPort.close(); }
