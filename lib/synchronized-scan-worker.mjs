import { parentPort, workerData } from 'node:worker_threads';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { inventory } from './scanner.mjs';
import { scanAiStorage } from './ai-storage.mjs';
import { analyzeProjects } from './project-analysis.mjs';
import { measureProjectStorage } from './project-storage.mjs';

const { home, scope, jobId, errorLog, buffer } = workerData;
const flag = new Int32Array(buffer), cancelled = () => Atomics.load(flag, 0) === 1;
const signal = { get aborted() { return cancelled(); } };
const errorCountsByPhase = { disk: 0, ai: 0, projects: 0, storage: 0 };
let log, queue = Promise.resolve(), current = {}, stage, index;
const labels = { disk: '文件扫描', ai: 'AI 工具', projects: '项目归类', storage: '项目占用' };
const check = () => { if (cancelled()) throw new Error('同步扫描已停止'); };
function publish(value = {}) { current = { ...value, stage, stageIndex: index, stageTotal: 5, stageLabel: labels[stage], errorCountsByPhase: { ...errorCountsByPhase }, skipped: Object.values(errorCountsByPhase).reduce((sum, n) => sum + n, 0) }; parentPort.postMessage({ type: 'progress', stats: current }); }
function phase(name, number) { stage = name; index = number; publish({ currentPath: home }); }
function record(error) { const phase = stage; errorCountsByPhase[phase]++; queue = queue.then(() => log.writeFile(JSON.stringify({ ...error, phase }) + '\n')); return queue; }
const heartbeat = setInterval(() => parentPort.postMessage({ type: 'progress', stats: current }), 1000);
try {
  await mkdir(path.dirname(errorLog), { recursive: true, mode: 0o700 });
  log = await open(errorLog, 'wx', 0o600);
  phase('disk', 1); check();
  const disk = await inventory(home, { scope, jobId, signal, onProgress: publish, onError: record });
  check(); if (!disk.scan.complete) throw new Error('文件扫描未完成');
  phase('ai', 2);
  const aiScan = await scanAiStorage({ home, cancelled, onProgress: publish, onError: record }); aiScan.jobId = jobId;
  check(); phase('projects', 3);
  const projectAnalysis = await analyzeProjects({ home, snapshot: aiScan, projectRoots: disk.scan.projectRoots, cancelled, onProgress: publish });
  for (const error of projectAnalysis.errors) await record(error);
  check(); phase('storage', 4);
  const projectStorage = await measureProjectStorage({ home, report: projectAnalysis, cancelled, onProgress: publish });
  for (const error of projectStorage.errors) await record(error);
  check(); await queue; await log.close(); log = null;
  parentPort.postMessage({ type: 'result', result: { ...disk, aiScan, projectAnalysis, projectStorage }, errorCountsByPhase });
} catch (error) {
  await queue.catch(() => {});
  parentPort.postMessage({ type: 'failure', error: error.message, cancelled: cancelled(), errorCountsByPhase });
} finally { clearInterval(heartbeat); await log?.close().catch(() => {}); parentPort.close(); }
