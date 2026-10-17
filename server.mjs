import http from 'node:http';
import { readFile, mkdir, appendFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { publicScan, diskStatus, scanScopes } from './lib/scanner.mjs';
import { runBackgroundScan } from './lib/background-scan.mjs';
import { moveToTrash } from './lib/cleanup.mjs';
import { metadata, runPreview, runCleanup, allowedCommands, projectRoot } from './lib/mole.mjs';
import { buildCleanPlan, publicPlan, selectPlanItems, executePlan, readPreviewFile, checkMoleTarget } from './lib/clean-plan.mjs';
import { classifyAiPath, scanAiStorage, ollamaModels, deleteOllamaModel } from './lib/ai-storage.mjs';
import { defaultAiConfig, validateAiConfig, publicAiConfig, adviceMetadata, judgeCleanup } from './lib/ai-advisor.mjs';
import { agentInventory, inventoryCsv } from './lib/agent-inventory.mjs';
import { analyzeProjects, publicProjects, projectDetails, projectsCsv } from './lib/project-analysis.mjs';
import { runProjectStorage, publicProjectStorage, publicProjectFiles, publicAssociationFiles, projectStorageCsv, buildProjectTrashPlan, publicProjectPlan, selectProjectGroups, executeProjectTrashPlan, checkFileUnused } from './lib/project-storage.mjs';
import { createProjectFileBrowser } from './lib/file-inspector.mjs';
import { runSynchronizedScan } from './lib/synchronized-scan.mjs';
import { analyzeHarnessCandidates } from './lib/harness-analysis.mjs';
import { prepareFileSummary, summarizeSelectedFiles } from './lib/ai-summary.mjs';

const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };

export function createApp({ home = os.homedir(), port = 4783, previewRunner = runPreview, cleanupRunner = runCleanup, selectionGuard = checkMoleTarget, personalFileGuard = checkFileUnused, aiFetch = fetch, syncRunner = runSynchronizedScan, runtimeDirectory = path.join(projectRoot, '.runtime'), persistState = false } = {}) {
  const token = randomBytes(32).toString('hex');
  const jobs = new Map();
  let latestScan = null;
  let latestAnalysis = null;
  let latestCleanup = null;
  let cleanPlan = null;
  let aiScan = null, aiAdvice = null, modelCleanup = null, projectAnalysis = null;
  let projectStorage = null, projectTrashPlan = null, projectCleanup = null;
  let synchronization = null;
  let fileBrowser = null, fileBrowserVersion = null;
  let aiConfig = { ...defaultAiConfig };
  let aiConfigRevision = randomUUID();
  let harnessKnowledge = [];
  const summaryPreviews = new Map();
  let activeMutation = false;
  const scopes = scanScopes(home);
  const publicJob = ({ cancel, errorLog, ...value }) => value;
  const stateFile = path.join(runtimeDirectory, 'latest-state.json');
  let saveQueue = Promise.resolve();
  const ready = persistState ? readFile(stateFile, 'utf8').then(JSON.parse).then(saved => {
    if (saved.home !== home) return;
    harnessKnowledge = Array.isArray(saved.harnessKnowledge) ? saved.harnessKnowledge : [];
    latestScan = saved.scan || null;
    latestAnalysis = saved.analysis || null;
    latestCleanup = saved.cleanup || null;
    aiScan = saved.aiScan || null; aiAdvice = saved.aiAdvice || null; modelCleanup = saved.modelCleanup || null;
    projectAnalysis = saved.projectAnalysis || null;
    projectStorage = saved.projectStorage || null; projectCleanup = saved.projectCleanup || null;
    if (projectCleanup?.status === 'running') { projectCleanup.status = 'interrupted'; projectCleanup.moved = null; projectCleanup.movedBytes = null; projectCleanup.skipped = null; projectCleanup.note = '服务中断，未自动继续移动。请查看逐文件记录；moving 状态表示需要核对原路径和废纸篓。'; }
    if (aiScan?.jobId && /^[a-f0-9-]{36}$/.test(aiScan.jobId)) jobs.set(aiScan.jobId, { id: aiScan.jobId, type: 'ai-scan', status: 'complete', createdAt: aiScan.createdAt, finishedAt: aiScan.createdAt, stats: { skipped: aiScan.errorCount }, errorLog: path.join(runtimeDirectory, 'scans', `${aiScan.jobId}.errors.jsonl`), restored: true });
    if (latestScan?.jobId && /^[a-f0-9-]{36}$/.test(latestScan.jobId)) jobs.set(latestScan.jobId, { id: latestScan.jobId, type: 'analyze', status: latestScan.complete ? 'complete' : 'cancelled', createdAt: latestScan.startedAt, finishedAt: latestScan.createdAt, scope: latestScan.scope, stats: { count: latestScan.count, bytes: latestScan.totalBytes, skipped: latestScan.errorCount, elapsedMs: latestScan.elapsedMs }, errorLog: path.join(runtimeDirectory, 'scans', `${latestScan.jobId}.errors.jsonl`), restored: true });
    synchronization = saved.synchronization || null;
    if (synchronization && /^[a-f0-9-]{36}$/.test(synchronization.id)) {
      if (synchronization.status === 'running') Object.assign(synchronization, { status: 'interrupted', error: '服务中断，同步未完成；保留上次完整结果', finishedAt: new Date().toISOString() });
      jobs.set(synchronization.id, { ...synchronization, type: 'sync', restored: true, errorLog: path.join(runtimeDirectory, 'scans', `${synchronization.id}.sync.errors.jsonl`) });
    }
    if (latestCleanup?.kind === 'selection' && latestCleanup.status === 'running') return recoverInterruptedReceipt(latestCleanup, runtimeDirectory);
  }).catch(error => { if (error.code !== 'ENOENT') console.error(`本地记录未能恢复：${error.message}`); }) : Promise.resolve();
  const aiConfigFile = path.join(runtimeDirectory, 'ai-settings.json');
  const configReady = persistState ? readFile(aiConfigFile, 'utf8').then(JSON.parse).then(saved => { aiConfig = validateAiConfig({ ...saved, apiKey: '', clearKey: true }); }).catch(() => {}) : Promise.resolve();
  const currentInventory = () => agentInventory(aiScan, cleanPlan, Date.now(), [...jobs.values()].reverse().find(row => row.type === 'mole' && row.mode === 'preview' && row.command === 'clean')?.id);
  const aiPublic = () => ({ config: publicAiConfig(aiConfig), scan: aiScan, inventory: currentInventory(), projects: publicProjects(projectAnalysis, aiScan), projectStorage: publicProjectStorage(projectStorage, projectAnalysis, aiScan), projectPlan: publicProjectPlan(projectTrashPlan), projectCleanup, advice: aiAdvice, modelCleanup });
  function currentFileBrowser(storageId) {
    if (!projectStorage || storageId !== projectStorage.id || publicProjectStorage(projectStorage, projectAnalysis, aiScan).stale) throw new Error('项目统计已变化或过期，请刷新并重新统计');
    const version = projectStorage.id + ':' + projectAnalysis.id;
    if (fileBrowserVersion !== version) { fileBrowser?.dispose(); fileBrowser = createProjectFileBrowser({ home, report: projectAnalysis, storage: projectStorage }); fileBrowserVersion = version; }
    return fileBrowser;
  }
  async function summaryTarget(body) {
    if (body.source === 'project-file') return currentFileBrowser(body.snapshotId).summaryTarget(body.id);
    let selected;
    if (body.source === 'project') {
      if (!projectAnalysis || body.snapshotId !== projectAnalysis.id || publicProjects(projectAnalysis, aiScan).stale) throw new Error('项目清单已变化');
      selected = projectAnalysis.groups.find(row => row.id === body.id && ['project', 'workspace'].includes(row.type) && row.exists);
    } else if (body.source === 'ai-scope' || body.source === 'candidate') {
      if (!aiScan || aiScan.stale || body.snapshotId !== aiScan.id) throw new Error('AI 清单已变化');
      selected = (body.source === 'ai-scope' ? aiScan.items : aiScan.discovery?.candidates || []).find(row => row.id === body.id);
    } else if (body.source === 'plan' || body.source === 'plan-file') {
      if (!cleanPlan || cleanPlan.id !== body.snapshotId || cleanPlan.usedBy) throw new Error('文件清单已变化');
      selected = cleanPlan.items.find(row => row.id === body.id);
      if (body.source === 'plan-file') selected = Number.isSafeInteger(body.index) && body.index >= 0 ? selected?.nodes?.filter(node => node.type === 'file').sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))[body.index] : null;
    } else if (body.source === 'disk') {
      if (!latestScan || latestScan.stale || !latestScan.complete || latestScan.jobId !== body.snapshotId) throw new Error('磁盘统计已变化');
      selected = (latestAnalysis?.rows || latestScan.rows || []).find(row => row.id === body.id);
    }
    if (!selected?.path) throw new Error('只能总结当前清单中点选的文件或文件夹');
    return { path: selected.path };
  }
  function reviewBatch(source, snapshotId, offset) {
    const snapshot = source === 'ai' ? aiScan : source === 'plan' ? cleanPlan : null;
    if (!snapshot || snapshot.id !== snapshotId || snapshot.stale) throw new Error('请先生成当前清单，或重新扫描 AI 专项');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的判读分页');
    const all = (source === 'ai' ? snapshot.items : snapshot.items.filter(row => !row.coveredBy)).slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.path.localeCompare(b.path));
    const rows = all.slice(offset, offset + 20);
    if (!rows.length) throw new Error('此范围没有可判读的项目');
    return { rows, total: all.length, nextOffset: offset + rows.length < all.length ? offset + rows.length : null };
  }
  function saveState(overrides = {}) {
    if (!persistState) return Promise.resolve();
    const contents = JSON.stringify({ home, scan: latestScan, analysis: latestAnalysis, cleanup: latestCleanup, aiScan, aiAdvice, modelCleanup, projectAnalysis, projectStorage, projectCleanup, synchronization, harnessKnowledge, ...overrides });
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
      const temporary = stateFile + '.tmp';
      await writeFile(temporary, contents, { mode: 0o600 });
      await rename(temporary, stateFile);
    });
    return saveQueue;
  }

  async function startSynchronized(value, scope) {
    let runner, cancelled = false;
    const controller = new AbortController();
    value.scope = scope; value.message = '正在同步扫描…';
    value.cancel = reason => { if (value.committing) return false; cancelled = true; value.cancelling = true; controller.abort(); runner?.cancel(reason); return true; };
    synchronization = { id: value.id, type: 'sync', status: 'running', scope, createdAt: value.createdAt };
    async function fail(error, counts) {
      Object.assign(value, { status: cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString(), errorCountsByPhase: counts, committing: false });
      synchronization = { ...synchronization, status: value.status, error: value.error, finishedAt: value.finishedAt, errorCountsByPhase: counts, stats: value.stats };
      await saveState().catch(error => { value.persistenceWarning = error.message; });
    }
    try {
      await saveState();
      if (cancelled) throw new Error('同步扫描已停止');
      runner = syncRunner({ home, scope, jobId: value.id, runtimeDirectory, onProgress: stats => { value.stats = stats; value.message = `${stats.stageIndex || 1}/5 · ${stats.stageLabel || '文件扫描'}`; synchronization.stats = stats; }, onDone: async outcome => {
        if (outcome.type !== 'result' || cancelled) { cancelled ||= !!outcome.cancelled; await fail(new Error(outcome.error || outcome.reason || '同步扫描已停止'), outcome.errorCountsByPhase); return; }
        try {
          const next = outcome.result;
          value.message = '5/5 · 候选工具识别';
          const nextKnowledge = await analyzeHarnessCandidates({ snapshot: next.aiScan, config: { ...aiConfig }, knowledge: harnessKnowledge, fetcher: aiFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]), onProgress: stats => { value.stats = { ...value.stats, ...stats, stage: 'harness-analysis', stageIndex: 5, stageTotal: 5, stageLabel: '候选工具识别' }; } });
          value.stats = { ...value.stats, stage: 'models', stageLabel: '模型列表', stageIndex: 5, stageTotal: 5 }; value.message = '5/5 · 模型列表';
          try { next.aiScan.ollama = { available: true, models: await ollamaModels({ fetcher: aiFetch }) }; }
          catch { next.aiScan.ollama = { available: false, models: [], reason: 'Ollama 未运行' }; }
          if (cancelled) throw new Error('同步扫描已停止');
          const finishedAt = new Date().toISOString();
          for (const snapshot of [next.scan, next.analysis, next.aiScan, next.projectAnalysis, next.projectStorage]) Object.assign(snapshot, { syncId: value.id, synchronizedAt: finishedAt });
          const completed = { id: value.id, type: 'sync', status: 'complete', scope, createdAt: value.createdAt, finishedAt, errorCountsByPhase: outcome.errorCountsByPhase, stats: { ...value.stats, stage: 'complete', stageLabel: '同步完成', skipped: Object.values(outcome.errorCountsByPhase || {}).reduce((sum, n) => sum + n, 0) } };
          value.committing = true; value.message = '正在保存扫描结果…';
          // Persist the entire batch before publishing any of its snapshots.
          await saveState({ scan: next.scan, analysis: next.analysis, aiScan: next.aiScan, projectAnalysis: next.projectAnalysis, projectStorage: next.projectStorage, aiAdvice: null, synchronization: completed, harnessKnowledge: nextKnowledge });
          harnessKnowledge = nextKnowledge;
          latestScan = next.scan; latestAnalysis = next.analysis; aiScan = next.aiScan; projectAnalysis = next.projectAnalysis; projectStorage = next.projectStorage; aiAdvice = null;
          cleanPlan = null; projectTrashPlan = null; fileBrowser?.dispose(); fileBrowser = null; fileBrowserVersion = null;
          for (const preview of jobs.values()) if (preview.type === 'mole' && preview.mode === 'preview' && preview.command === 'clean') preview.usedBy ||= `sync:${value.id}`;
          synchronization = completed;
          Object.assign(value, { ...completed, progress: 1, message: '扫描完成，所有页面已更新', committing: false });
        } catch (error) { await fail(error, outcome.errorCountsByPhase); }
      } });
      value.errorLog = runner.errorLog;
    } catch (error) { await fail(error); }
  }

  function startInventory(value, scope) {
    value.scope = scope;
    value.message = `正在后台完整扫描${scope.label}…`;
    try {
      const runner = runBackgroundScan({ home, scope, jobId: value.id, runtimeDirectory,
        onProgress: stats => Object.assign(value, { stats, message: value.cancelling ? '正在停止扫描…' : `正在后台完整扫描${scope.label}…` }),
        onDone: async outcome => {
          if (outcome.result) {
            latestScan = outcome.result.scan;
            latestAnalysis = outcome.result.analysis;
            value.result = value.type === 'scan' ? publicScan(latestScan) : latestAnalysis;
          }
          Object.assign(value, { status: outcome.status, progress: outcome.status === 'complete' ? 1 : null, finishedAt: new Date().toISOString(), error: outcome.error || outcome.reason, message: outcome.status === 'complete' ? '完整扫描结束' : outcome.status === 'cancelled' ? '扫描已取消' : '扫描失败' });
          await saveState().catch(error => { value.persistenceWarning = error.message; });
        },
      });
      value.errorLog = runner.errorLog;
      value.cancel = reason => { value.cancelling = true; value.message = '正在停止扫描…'; runner.cancel(reason); };
    } catch (error) { Object.assign(value, { status: 'failed', error: error.message }); }
  }

  function job(type) {
    if ([...jobs.values()].some(value => value.status === 'running') || activeMutation) throw Object.assign(new Error('已有任务正在运行，请等它完成或停止任务'), { status: 409 });
    const result = { id: randomUUID(), type, status: 'running', progress: 0, message: '正在准备…', output: '', createdAt: new Date().toISOString() };
    jobs.set(result.id, result);
    if (jobs.size > 20) {
      const latestPreview = [...jobs.values()].reverse().find(value => value.type === 'mole' && value.command === 'clean' && value.mode === 'preview');
      const pinned = new Set([latestScan?.jobId, aiScan?.jobId, latestPreview?.id]);
      const oldest = [...jobs.values()].find(value => value.status !== 'running' && !pinned.has(value.id));
      if (oldest) jobs.delete(oldest.id);
    }
    return result;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const address = server.address();
    const currentPort = typeof address === 'object' && address ? address.port : port;
    const validHosts = [`127.0.0.1:${currentPort}`, `localhost:${currentPort}`];
    if (!validHosts.includes(request.headers.host)) return json(response, 403, { error: '仅允许本机访问' });
    if (request.headers.origin && !validHosts.map(host => `http://${host}`).includes(request.headers.origin)) return json(response, 403, { error: '拒绝跨站请求' });
    const url = new URL(request.url, `http://127.0.0.1:${currentPort}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await ready; await configReady;
        if (request.method === 'POST') {
          const supplied = Buffer.from(String(request.headers['x-minorminor-token'] || ''));
          const expected = Buffer.from(token);
          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(response, 403, { error: '会话已过期，请刷新页面' });
        }
        if (request.method === 'GET' && url.pathname === '/api/bootstrap') return json(response, 200, { token, disk: await diskStatus(home), mole: await metadata(), scopes: await scopes, scan: latestScan ? publicScan(latestScan) : null, analysis: latestAnalysis, cleanup: latestCleanup, cleanPlan: publicPlan(cleanPlan), ai: aiPublic(), synchronization, jobs: [...jobs.values()].map(publicJob) });
        if (request.method === 'POST' && url.pathname === '/api/ai/summaries/prepare') {
          const body = await readJSON(request);
          if ([...jobs.values()].some(row => row.status === 'running')) throw new Error('请等待当前任务结束');
          if (!publicAiConfig(aiConfig).configured) throw new Error('请先连接总结使用的模型');
          const target = await summaryTarget(body), prepared = await prepareFileSummary({ target, home, signal: AbortSignal.timeout(20000) });
          prepared.configRevision = aiConfigRevision;
          prepared.source = { source: body.source, id: body.id, snapshotId: body.snapshotId, ...(body.source === 'plan-file' ? { index: body.index } : {}) };
          prepared.key = [body.source, body.snapshotId, body.id, body.index ?? ''].join(':');
          for (const [id, old] of summaryPreviews) if (Date.now() - Date.parse(old.createdAt) > 600000) summaryPreviews.delete(id);
          summaryPreviews.set(prepared.id, prepared); while (summaryPreviews.size > 20) summaryPreviews.delete(summaryPreviews.keys().next().value);
          return json(response, 200, { id: prepared.id, name: prepared.name, path: prepared.path, key: prepared.key, coverage: prepared.coverage, limits: prepared.limits, configRevision: aiConfigRevision, destination: new URL(aiConfig.baseUrl).origin, model: aiConfig.model, files: prepared.payload.files.map(({ text, ...row }) => row) });
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/summaries') {
          const body = await readJSON(request), prepared = summaryPreviews.get(body.previewId);
          if (body.confirmation !== 'SUMMARIZE_SELECTED_RESOURCE') throw new Error('请确认本次选定的总结范围');
          if (!prepared || prepared.used) throw new Error('总结预览已失效，请重新选择');
          if (prepared.configRevision !== aiConfigRevision || body.configRevision !== aiConfigRevision) throw new Error('模型连接已变化，请重新预览');
          await summaryTarget(prepared.source);
          if (prepared.used || summaryPreviews.get(body.previewId) !== prepared) throw new Error('总结预览已使用，请重新选择');
          const value = job('ai-summary'), controller = new AbortController();
          prepared.used = true; value.cancel = () => { value.cancelling = true; controller.abort(); };
          value.message = `正在总结 ${prepared.name}…`; json(response, 202, { id: value.id });
          (async () => {
            try {
              const result = await summarizeSelectedFiles({ prepared, config: { ...aiConfig }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]), fetcher: aiFetch });
              if (controller.signal.aborted) throw new Error('AI 总结已停止');
              value.result = { ...result, key: prepared.key };
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: result.createdAt, message: 'AI 总结完成' });
            } catch (error) { Object.assign(value, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
            finally { summaryPreviews.delete(prepared.id); prepared.payload = null; prepared.guards = []; }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/sync') {
          const body = await readJSON(request), scope = (await scopes).find(row => row.id === (body.scope || 'disk'));
          if (!scope) throw new Error('扫描范围必须是 disk 或 home');
          const running = [...jobs.values()].find(value => value.status === 'running');
          if (running?.type === 'sync' && running.scope?.id === scope.id) return json(response, 202, { id: running.id });
          const value = job('sync');
          value.scope = scope;
          json(response, 202, { id: value.id });
          void startSynchronized(value, scope);
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/project-storage/browse') {
          const browser = currentFileBrowser(url.searchParams.get('storageId'));
          return json(response, 200, await browser.list({ projectId: url.searchParams.get('project'), kind: url.searchParams.get('kind') || 'tree', directoryId: url.searchParams.get('directory') || undefined, offset: pageOffset(url), sort: url.searchParams.get('sort') || 'size', query: url.searchParams.get('query') || '' }));
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/project-storage/associations') {
          if (!projectStorage || url.searchParams.get('storageId') !== projectStorage.id) throw new Error('项目统计已变化，请刷新后重新核对');
          return json(response, 200, { ...publicAssociationFiles(projectStorage, { projectId: url.searchParams.get('project') || undefined, status: url.searchParams.get('status') || '', query: url.searchParams.get('query') || '', offset: pageOffset(url) }), stale: publicProjectStorage(projectStorage, projectAnalysis, aiScan).stale });
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/project-storage/directory-sizes') {
          const browser = currentFileBrowser(url.searchParams.get('storageId'));
          return json(response, 200, await browser.directorySizes(url.searchParams.get('project')));
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/project-storage/directory-sizes') {
          const body = await readJSON(request), browser = currentFileBrowser(body.storageId);
          return json(response, 200, await browser.directorySizes(body.projectId, body.action || 'start'));
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/project-storage/inspect') {
          const body = await readJSON(request), browser = currentFileBrowser(body.storageId);
          return json(response, 200, await browser.inspect(body.id));
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/project-storage/files') {
          if (!projectStorage) throw new Error('请先统计项目占用');
          return json(response, 200, { ...publicProjectFiles(projectStorage, url.searchParams.get('project'), url.searchParams.get('kind'), pageOffset(url)), stale: publicProjectStorage(projectStorage, projectAnalysis, aiScan).stale });
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/project-storage/export') {
          if (!projectStorage) throw new Error('请先统计项目占用');
          if (url.searchParams.get('format') === 'csv') {
            response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="Minorminor-project-storage.csv"', 'Cache-Control': 'no-store' });
            return response.end(projectStorageCsv(projectStorage));
          }
          response.setHeader('Content-Disposition', 'attachment; filename="Minorminor-project-storage.json"');
          return json(response, 200, { ...publicProjectStorage(projectStorage, projectAnalysis, aiScan), files: projectStorage.files.map(({ dev, ino, size, mtimeMs, ctimeMs, nlink, root, guardPath, ...row }) => row) });
        }
        if (request.method === 'GET' && url.pathname.startsWith('/api/ai/project-plan/groups/')) {
          const group = projectTrashPlan?.groups.find(row => row.id === url.pathname.split('/').at(-1));
          if (!group) throw new Error('此项目预览不存在');
          const offset = pageOffset(url);
          const retained = url.searchParams.get('retained') === '1', rows = retained ? group.retained : group.nodes;
          return json(response, 200, { groupId: group.id, name: group.name, kind: group.kind, retained, total: rows.length, offset, files: rows.slice(offset, offset + 100).map(row => ({ path: row.path, bytes: row.bytes, kind: row.kind, reason: row.reason })), hasMore: offset + 100 < rows.length });
        }
        if (request.method === 'GET' && /^\/api\/ai\/project-cleanups\/[a-f0-9-]{36}$/.test(url.pathname)) {
          const id = url.pathname.split('/').at(-1);
          if (id !== projectCleanup?.jobId) throw new Error('项目整理记录不存在');
          return json(response, 200, { records: await readErrors(path.join(runtimeDirectory, 'project-cleanups', id + '.jsonl'), pageOffset(url)), offset: pageOffset(url), receipt: projectCleanup });
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/projects/storage') {
          const body = await readJSON(request);
          if (!projectAnalysis || body.reportId !== projectAnalysis.id || publicProjects(projectAnalysis, aiScan).stale) throw new Error('项目归类已变化，请先更新归类');
          const value = job('project-storage'); projectTrashPlan = null; value.message = '正在后台完整统计各项目目录和关联 AI 文件…';
          const runner = runProjectStorage({ home, report: projectAnalysis, onProgress: stats => { value.stats = stats; }, onDone: async outcome => {
            if (outcome.type === 'result') { projectStorage = outcome.result; projectTrashPlan = null; await saveState().catch(error => { value.persistenceWarning = error.message; }); }
            Object.assign(value, { status: outcome.type === 'result' ? 'complete' : outcome.cancelled ? 'cancelled' : 'failed', progress: outcome.type === 'result' ? 1 : null, finishedAt: new Date().toISOString(), error: outcome.error, message: outcome.type === 'result' ? '项目占用统计完成' : outcome.error });
          } });
          value.cancel = () => { value.cancelling = true; runner.cancel(); };
          return json(response, 202, { id: value.id });
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/projects/plan') {
          const body = await readJSON(request);
          if (body.storageId !== projectStorage?.id || publicProjects(projectAnalysis, aiScan)?.stale) throw new Error('项目占用统计已变化，请重新统计');
          const value = job('project-plan'); projectTrashPlan = null; let cancelled = false; value.cancel = () => { cancelled = true; value.cancelling = true; }; value.message = '正在核对所选项目，生成移到废纸篓的具体文件预览…';
          json(response, 202, { id: value.id });
          (async () => {
            try { const plan = await buildProjectTrashPlan({ home, report: projectAnalysis, storage: projectStorage, projectIds: body.projectIds, categories: body.categories, allowPersonal: body.allowPersonal === true, cancelled: () => cancelled, onProgress: stats => { value.stats = stats; } }); if (cancelled) throw new Error('项目预览已停止'); await mkdir(path.join(runtimeDirectory, 'project-plans'), { recursive: true, mode: 0o700 }); await writeFile(path.join(runtimeDirectory, 'project-plans', plan.id + '.json'), JSON.stringify(plan), { mode: 0o600 }); if (cancelled) throw new Error('项目预览已停止'); projectTrashPlan = plan; Object.assign(value, { status: 'complete', progress: 1, finishedAt: new Date().toISOString(), message: '具体文件预览已生成，请审阅并勾选类别' }); }
            catch (error) { Object.assign(value, { status: cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
          })(); return;
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/projects/execute') {
          const body = await readJSON(request);
          if (body.confirmation !== 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH' || body.planId !== projectTrashPlan?.id) throw new Error('请先审阅并确认当前项目预览');
          if (publicProjectStorage(projectStorage, projectAnalysis, aiScan)?.stale || projectTrashPlan.storageId !== projectStorage?.id || publicProjects(projectAnalysis, aiScan)?.stale) throw new Error('占用或归类已变化，请重新生成预览');
          const selected = selectProjectGroups(projectTrashPlan, body.groupIds);
          if (selected.some(row => ['session', 'memory'].includes(row.kind)) && body.personalConfirmation !== 'I_UNDERSTAND_HISTORY_AND_MEMORY_WILL_BE_MOVED') throw new Error('会话和记忆需要单独确认，移动后会影响历史和记忆');
          const value = job('project-trash'), plan = projectTrashPlan; plan.usedBy = value.id;
          let cancelled = false; value.cancel = () => { cancelled = true; value.cancelling = true; }; value.message = '正在将已审阅文件逐项移到废纸篓…';
          let log;
          try {
            await mkdir(path.join(runtimeDirectory, 'project-cleanups'), { recursive: true, mode: 0o700 });
            log = await open(path.join(runtimeDirectory, 'project-cleanups', value.id + '.jsonl'), 'ax', 0o600);
            projectCleanup = { jobId: value.id, planId: plan.id, status: 'running', createdAt: value.createdAt, moved: 0, movedBytes: 0, skipped: 0, projects: selected.map(row => ({ projectId: row.projectId, name: row.name, kind: row.kind, files: row.nodes.length, bytes: row.bytes })) };
            projectStorage.stale = true; if (latestScan) latestScan.stale = true; if (latestAnalysis) latestAnalysis.stale = true; if (cleanPlan) cleanPlan.usedBy = value.id;
            await saveState();
          } catch (error) { await log?.close(); Object.assign(value, { status: 'failed', error: error.message }); throw new Error('无法保存操作记录，未开始移动文件'); }
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const result = await executeProjectTrashPlan(plan, selected, { guard: selectionGuard, personalGuard: personalFileGuard, cancelled: () => cancelled, onProgress: stats => { value.stats = stats; }, onRecord: async record => { await log.writeFile(JSON.stringify(record) + '\n'); await log.sync(); } });
              projectCleanup = { ...projectCleanup, ...result }; if (result.moved && selected.some(row => ['session', 'memory'].includes(row.kind))) projectAnalysis.stale = true;
              Object.assign(value, { status: result.status, finishedAt: result.createdAt, message: '项目整理结束，请查看逐文件记录' });
            } catch (error) { projectCleanup.status = 'unconfirmed'; projectCleanup.moved = null; projectCleanup.movedBytes = null; projectCleanup.skipped = null; projectCleanup.note = '任务未完整结束，请核对原路径、废纸篓和逐文件记录。' + error.message; Object.assign(value, { status: 'failed', finishedAt: new Date().toISOString(), error: projectCleanup.note }); }
            finally { await log.close().catch(() => {}); await saveState().catch(error => { value.persistenceWarning = error.message; }); }
          })(); return;
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/projects/export') {
          if (!projectAnalysis) throw new Error('请先读取项目关联文件');
          const csv = url.searchParams.get('format') === 'csv';
          response.setHeader('Content-Disposition', `attachment; filename="Minorminor-project-analysis.${csv ? 'csv' : 'json'}"`);
          if (csv) { response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }); return response.end(projectsCsv(projectAnalysis)); }
          return json(response, 200, { ...projectAnalysis, stale: publicProjects(projectAnalysis, aiScan).stale });
        }
        if (request.method === 'GET' && /^\/api\/ai\/projects\/[^/]+$/.test(url.pathname)) {
          if (!projectAnalysis) throw new Error('请先读取项目关联文件');
          return json(response, 200, { ...projectDetails(projectAnalysis, url.pathname.split('/').at(-1), pageOffset(url)), stale: publicProjects(projectAnalysis, aiScan).stale });
        }
        if (request.method === 'GET' && /^\/api\/ai\/project-scopes\/[^/]+$/.test(url.pathname)) {
          const row = projectAnalysis?.scopes.find(row => row.id === url.pathname.split('/').at(-1));
          if (!row) throw new Error('未找到此范围的内容说明，请更新项目归类');
          const related = projectAnalysis.groups.filter(group => group.id === row.projectId || group.assets.some(asset => asset.sourcePath === row.sourcePath || asset.sourcePath.startsWith(row.sourcePath + path.sep))).map(({ assets, ...group }) => group);
          return json(response, 200, { row, related, stale: publicProjects(projectAnalysis, aiScan).stale });
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/projects') {
          const body = await readJSON(request);
          if (!aiScan || body.snapshotId !== aiScan.id || aiScan.stale) throw new Error('AI 占用快照已变化，请刷新后重试');
          const value = job('project-analysis');
          let cancelled = false;
          value.cancel = () => { cancelled = true; value.cancelling = true; };
          value.message = '正在本地读取项目索引、会话头与说明文件…';
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const result = await analyzeProjects({ home, snapshot: aiScan, projectRoots: latestScan?.complete && !latestScan.stale ? latestScan.projectRoots : [], cancelled: () => cancelled, onProgress: stats => { value.stats = stats; } });
              if (cancelled) throw new Error('项目归类已停止');
              projectAnalysis = result;
              await saveState();
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: result.createdAt, message: '本地项目归类完成', stats: { ...value.stats, groups: result.groups.length, errors: result.errors.length } });
            } catch (error) { Object.assign(value, { status: cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
          })();
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/inventory/export') {
          const inventory = currentInventory();
          if (!inventory) throw new Error('请先扫描 AI 工具');
          const csv = url.searchParams.get('format') === 'csv';
          response.setHeader('Content-Disposition', `attachment; filename="Minorminor-agent-inventory.${csv ? 'csv' : 'json'}"`);
          if (csv) { response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' }); return response.end(inventoryCsv(inventory)); }
          return json(response, 200, { ...inventory, agents: aiScan.discovery?.agents, coverage: aiScan.discovery?.coverage });
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/review-payload') {
          const batch = reviewBatch(url.searchParams.get('source'), url.searchParams.get('snapshotId'), pageOffset(url));
          return json(response, 200, { items: batch.rows.map(row => adviceMetadata(row, home)), total: batch.total, destination: new URL(aiConfig.baseUrl).origin, provider: aiConfig.provider, model: aiConfig.model, configRevision: aiConfigRevision });
        }
        if (request.method === 'GET' && url.pathname === '/api/ai/advice/export') {
          if (!aiAdvice) throw new Error('尚无模型判读结果');
          response.setHeader('Content-Disposition', 'attachment; filename="Minorminor-AI-advice.json"');
          return json(response, 200, aiAdvice);
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/config') {
          if ([...jobs.values()].some(value => value.status === 'running')) throw new Error('请等当前任务完成后再更改模型连接');
          const next = validateAiConfig(await readJSON(request), aiConfig);
          await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
          const { apiKey, ...safe } = next;
          await writeFile(aiConfigFile, JSON.stringify(safe), { mode: 0o600 });
          aiConfig = next; aiConfigRevision = randomUUID(); aiAdvice = null; await saveState();
          return json(response, 200, publicAiConfig(aiConfig));
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/detect-ollama') {
          await readJSON(request);
          try { return json(response, 200, { available: true, models: await ollamaModels({ fetcher: aiFetch }) }); }
          catch { return json(response, 200, { available: false, models: [], reason: '未检测到本机 11434 端口的 Ollama；可以启动已有服务，或配置云端兼容接口' }); }
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/harnesses/analyze') {
          const body = await readJSON(request);
          if (!aiScan || aiScan.stale || body.snapshotId !== aiScan.id) throw new Error('候选清单已变化，请重新扫描');
          if (!aiConfig.harnessAnalysis || !publicAiConfig(aiConfig).configured) throw new Error('请在模型连接中启用候选工具自动识别');
          const value = job('harness-analysis'), controller = new AbortController();
          value.cancel = () => { value.cancelling = true; controller.abort(); };
          value.message = '正在识别候选工具…'; json(response, 202, { id: value.id });
          (async () => {
            try {
              const snapshot = structuredClone(aiScan);
              const nextKnowledge = await analyzeHarnessCandidates({ snapshot, config: { ...aiConfig }, knowledge: harnessKnowledge, fetcher: aiFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]), onProgress: stats => { value.stats = stats; } });
              if (controller.signal.aborted) throw new Error('候选工具识别已停止');
              await saveState({ aiScan: snapshot, harnessKnowledge: nextKnowledge }); aiScan = snapshot; harnessKnowledge = nextKnowledge;
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: new Date().toISOString(), message: snapshot.discovery?.harnessAnalysis?.failed ? 'AI 识别失败，本地候选已保留' : '候选工具识别完成' });
            } catch (error) { Object.assign(value, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/scan') {
          await readJSON(request);
          const value = job('ai-scan');
          let cancelled = false; const controller = new AbortController();
          value.cancel = () => { cancelled = true; value.cancelling = true; controller.abort(); };
          value.message = '正在后台统计 AI 工具、模型与会话占用…';
          json(response, 202, { id: value.id });
          (async () => {
            let log;
            try {
              await mkdir(path.join(runtimeDirectory, 'scans'), { recursive: true, mode: 0o700 });
              value.errorLog = path.join(runtimeDirectory, 'scans', `${value.id}.errors.jsonl`);
              log = await open(value.errorLog, 'ax', 0o600);
              const result = await scanAiStorage({ home, cancelled: () => cancelled, onProgress: stats => { value.stats = stats; }, onError: error => log.writeFile(JSON.stringify(error) + '\n') });
              result.jobId = value.id;
              const nextKnowledge = await analyzeHarnessCandidates({ snapshot: result, config: { ...aiConfig }, knowledge: harnessKnowledge, fetcher: aiFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]), onProgress: stats => { value.stats = stats; } });
              if (cancelled) throw new Error('AI 专项扫描已停止');
              try { result.ollama = { available: true, models: await ollamaModels({ fetcher: aiFetch }) }; }
              catch { result.ollama = { available: false, models: [], reason: '本机 Ollama 服务未运行，模型目录仅做占用统计' }; }
              if (cancelled) throw new Error('AI 专项扫描已停止');
              aiScan = result; aiAdvice = null; harnessKnowledge = nextKnowledge;
              if (cleanPlan) for (const row of cleanPlan.items) Object.assign(row, classifyAiPath(row.path, home, result.discovery?.roots));
              await saveState();
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: result.createdAt, message: 'AI 专项扫描完成', stats: { ...value.stats, skipped: result.errorCount } });
            } catch (error) { Object.assign(value, { status: cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
            finally { await log?.close().catch(() => {}); }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/review') {
          const body = await readJSON(request);
          if (body.confirmation !== 'SEND_METADATA_FOR_ADVICE') throw new Error('请先核对发送给模型的元数据和目标接口');
          if (body.configRevision !== aiConfigRevision) throw new Error('模型连接已更改，请重新核对元数据和目标接口');
          if (!publicAiConfig(aiConfig).configured) throw new Error('请先配置模型连接，当前未运行大模型判读');
          const offset = body.offset || 0;
          const batch = reviewBatch(body.source, body.snapshotId, offset);
          const value = job('ai-review'), controller = new AbortController();
          value.cancel = () => { value.cancelling = true; controller.abort(); };
          value.message = `正在用 ${aiConfig.model} 判读 ${batch.rows.length} 个项目…`;
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const result = await judgeCleanup({ config: { ...aiConfig }, home, rows: batch.rows, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]), fetcher: aiFetch });
              if (controller.signal.aborted) throw new Error('AI 判读已停止');
              const previous = aiAdvice?.snapshotId === body.snapshotId && aiAdvice.source === body.source ? aiAdvice.items : [];
              const combined = new Map([...previous, ...result.items].map(row => [row.id, row]));
              aiAdvice = { ...result, items: [...combined.values()], source: body.source, snapshotId: body.snapshotId, total: batch.total, nextOffset: batch.nextOffset, analyzed: combined.size };
              await saveState();
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: result.createdAt, message: 'AI 判读完成；建议不会自动触发删除' });
            } catch (error) { Object.assign(value, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/ai/ollama/delete') {
          const body = await readJSON(request);
          if (body.confirmation !== 'DELETE_OLLAMA_MODEL' || body.scanId !== aiScan?.id) throw new Error('请先核对本次扫描中的具体模型');
          const selected = aiScan?.ollama?.models.find(row => row.id === body.modelId);
          if (!selected || selected.deleted) throw new Error('模型不属于当前扫描或已移除');
          const value = job('model-clean'), controller = new AbortController();
          value.message = `正在通过 Ollama 移除 ${selected.name}…`;
          value.cancel = () => { value.cancelling = true; controller.abort(); };
          try {
            await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
            await appendFile(path.join(runtimeDirectory, 'ai-model-actions.jsonl'), JSON.stringify({ event: 'confirmed', jobId: value.id, scanId: aiScan.id, model: selected.name, digest: selected.digest, createdAt: value.createdAt }) + '\n', { mode: 0o600 });
          } catch (error) { Object.assign(value, { status: 'failed', error: error.message }); throw new Error('无法准备模型操作记录，尚未开始移除'); }
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const result = await deleteOllamaModel(aiScan, selected.id, { fetcher: aiFetch, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
              modelCleanup = { ...result, createdAt: new Date().toISOString(), jobId: value.id };
              if (latestScan) latestScan.stale = true;
              if (latestAnalysis) latestAnalysis.stale = true;
              if (projectAnalysis) projectAnalysis.stale = true;
              aiScan.stale = true;
              await appendFile(path.join(runtimeDirectory, 'ai-model-actions.jsonl'), JSON.stringify({ event: 'finished', ...modelCleanup }) + '\n', { mode: 0o600 });
              await saveState();
              Object.assign(value, { status: 'complete', progress: 1, finishedAt: modelCleanup.createdAt });
            } catch (error) {
              modelCleanup = { name: selected.name, status: 'unconfirmed', jobId: value.id, createdAt: new Date().toISOString(), reason: error.message + '。若已向 Ollama 发送移除请求，操作可能已经生效，请刷新模型列表核对。' };
              await saveState().catch(() => {});
              Object.assign(value, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: modelCleanup.reason, finishedAt: modelCleanup.createdAt });
            }
          })();
          return;
        }
        if (request.method === 'GET' && url.pathname === '/api/clean-plan/export') {
          if (!cleanPlan) throw new Error('请先生成清单');
          response.setHeader('Content-Disposition', 'attachment; filename="Minorminor-plan.json"');
          return json(response, 200, { ...publicPlan(cleanPlan), files: cleanPlan.items.flatMap(row => (row.nodes || []).map(node => ({ itemId: row.id, path: node.path, bytes: node.bytes, type: node.type }))) });
        }
        if (request.method === 'GET' && url.pathname.startsWith('/api/clean-plan/items/')) {
          const row = cleanPlan?.items.find(item => item.id === url.pathname.split('/').pop());
          if (!row) throw new Error('清单项目不存在，请刷新');
          const offset = pageOffset(url);
          const query = url.searchParams.get('q') || '';
          const nodes = (row.nodes || []).filter(node => node.type === 'file' && node.path.includes(query)).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
          return json(response, 200, { item: publicPlan({ items: [row] }).items[0], files: nodes.slice(offset, offset + 100).map(({ path, bytes, type }) => ({ path, bytes, type })), offset, total: nodes.length, hasMore: offset + 100 < nodes.length });
        }
        const receiptMatch = url.pathname.match(/^\/api\/cleanups\/([a-f0-9-]{36})\/(records|export)$/);
        if (request.method === 'GET' && receiptMatch) {
          if (latestCleanup?.kind !== 'selection' || latestCleanup.jobId !== receiptMatch[1]) throw new Error('清理记录不存在');
          const filename = path.join(runtimeDirectory, 'cleanups', `${receiptMatch[1]}.jsonl`);
          if (receiptMatch[2] === 'export') {
            const contents = await readFile(filename);
            response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': 'attachment; filename="Minorminor-cleanup.jsonl"', 'Cache-Control': 'no-store' }); response.end(contents); return;
          }
          const offset = pageOffset(url), itemId = url.searchParams.get('itemId');
          const records = [], input = createReadStream(filename, { encoding: 'utf8' });
          const lines = createInterface({ input, crlfDelay: Infinity });
          let total = 0;
          try { for await (const line of lines) { if (!line) continue; const row = JSON.parse(line); if (itemId && row.itemId !== itemId) continue; if (total >= offset && records.length < 100) records.push(row); total++; } } finally { lines.close(); input.destroy(); }
          return json(response, 200, { records, offset, total, hasMore: offset + records.length < total });
        }
        const errorsMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/errors$/);
        if (request.method === 'GET' && errorsMatch) {
          const value = jobs.get(errorsMatch[1]);
          if (!value?.errorLog) return json(response, 404, { error: '没有这个扫描任务的读取记录' });
          const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
          if (!Number.isSafeInteger(offset)) return json(response, 400, { error: '无效的分页参数' });
          const requestedPhase = url.searchParams.get('phase');
          if (requestedPhase && !['disk', 'ai', 'projects', 'storage'].includes(requestedPhase)) throw new Error('无效的读取阶段');
          const phase = value.type === 'sync' ? requestedPhase : null;
          const errors = await readErrors(value.errorLog, offset, phase);
          const total = phase ? value.errorCountsByPhase?.[phase] ?? value.stats?.errorCountsByPhase?.[phase] ?? 0 : value.stats?.skipped || 0;
          return json(response, 200, { errors, offset, total, hasMore: offset + errors.length < total });
        }
        if (request.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
          const value = jobs.get(url.pathname.split('/').pop());
          if (!value) return json(response, 404, { error: '任务不存在' });
          return json(response, 200, publicJob(value));
        }
        if (request.method === 'POST' && ['/api/scan', '/api/analyze'].includes(url.pathname)) {
          const body = await readJSON(request);
          const scope = (await scopes).find(value => value.id === (body.scope || 'disk'));
          if (!scope) return json(response, 400, { error: '扫描范围必须是 disk 或 home' });
          const value = job(url.pathname === '/api/scan' ? 'scan' : 'analyze');
          json(response, 202, { id: value.id });
          startInventory(value, scope);
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/mole') {
          const body = await readJSON(request);
          if (!allowedCommands.includes(body.command)) return json(response, 400, { error: '不支持的 Mole 命令' });
          if (!(await metadata()).available) return json(response, 503, { error: '未找到 Mole 源码，请先按 README 获取上游代码' });
          const value = job('mole');
          value.command = body.command;
          value.mode = 'preview';
          value.message = `mo ${body.command} --dry-run`;
          const runner = previewRunner(body.command, text => { value.output = (value.output + text).slice(-200_000); }, result => Object.assign(value, { status: result.error ? 'cancelled' : result.code === 0 ? 'complete' : 'failed', progress: 1, exitCode: result.code, error: result.error, finishedAt: new Date().toISOString() }));
          value.cancel = runner.cancel;
          return json(response, 202, { id: value.id });
        }
        if (request.method === 'POST' && url.pathname === '/api/clean-plan') {
          const body = await readJSON(request);
          const preview = [...jobs.values()].reverse().find(row => row.type === 'mole' && row.mode === 'preview' && row.command === 'clean');
          if (!preview || preview.id !== body.previewId || preview.status !== 'complete' || preview.exitCode !== 0 || preview.usedBy || Date.now() - Date.parse(preview.finishedAt) > 30 * 60_000) throw new Error('请先完成一次新的 Mole 清理预览');
          const value = job('plan');
          value.message = '正在逐项读取清理范围内的文件…';
          let cancelled = false;
          value.cancel = () => { cancelled = true; value.cancelling = true; };
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const contents = await readPreviewFile(home, Date.parse(preview.createdAt));
              const result = await buildCleanPlan({ contents, home, previewId: preview.id, onProgress: stats => { if (cancelled) throw new Error('清单生成已停止'); value.stats = stats; value.progress = stats.total ? stats.completed / stats.total : 0; } });
              for (const row of result.items) Object.assign(row, classifyAiPath(row.path, home, aiScan?.discovery?.roots));
              if (cancelled) throw new Error('清单生成已停止');
              await mkdir(path.join(runtimeDirectory, 'plans'), { recursive: true, mode: 0o700 });
              await writeFile(path.join(runtimeDirectory, 'plans', `${result.id}.json`), JSON.stringify(result), { mode: 0o600 });
              cleanPlan = result;
              Object.assign(value, { status: 'complete', progress: 1, message: '可视化清理清单已生成', finishedAt: new Date().toISOString() });
            } catch (error) { Object.assign(value, { status: cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: new Date().toISOString() }); }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/clean-plan/execute') {
          const body = await readJSON(request);
          if (body.confirmation !== 'DELETE_SELECTED_FILES' || body.planId !== cleanPlan?.id) throw new Error('请审阅当前选中的文件并确认永久删除');
          const preview = [...jobs.values()].reverse().find(row => row.type === 'mole' && row.mode === 'preview' && row.command === 'clean');
          if (!preview || preview.id !== cleanPlan.previewId || preview.usedBy) throw new Error('预览已更新或使用，请重新生成清单');
          const selected = selectPlanItems(cleanPlan, body.ids);
          const value = job('selection');
          const plan = cleanPlan;
          plan.usedBy = value.id; preview.usedBy = value.id;
          let cancelled = false;
          value.cancel = () => { cancelled = true; value.cancelling = true; };
          value.message = '正在按勾选清单逐项清理…';
          const observed = new Map(selected.map(row => [row.id, { id: row.id, name: row.name, path: row.path, category: row.category, status: 'skipped', deletedFiles: 0, deletedDirectories: 0, skipped: 0, bytes: 0, reason: '尚未处理' }]));
          let receipt;
          try {
            await mkdir(path.join(runtimeDirectory, 'cleanups'), { recursive: true, mode: 0o700 });
            await appendFile(path.join(runtimeDirectory, 'selection-actions.jsonl'), JSON.stringify({ event: 'confirmed', jobId: value.id, planId: plan.id, createdAt: value.createdAt, items: selected.map(({ id, path, files, bytes }) => ({ id, path, files, bytes })) }) + '\n', { mode: 0o600 });
            receipt = await open(path.join(runtimeDirectory, 'cleanups', `${value.id}.jsonl`), 'ax', 0o600);
            if (latestScan) latestScan.stale = true;
            if (latestAnalysis) latestAnalysis.stale = true;
            if (projectAnalysis) projectAnalysis.stale = true;
            latestCleanup = { kind: 'selection', jobId: value.id, status: 'running', createdAt: value.createdAt, results: [...observed.values()], deletedFiles: 0, bytes: 0, skipped: 0 };
            await saveState();
          } catch (error) { await receipt?.close(); Object.assign(value, { status: 'failed', error: error.message }); throw new Error(`清理未启动：${error.message}`); }
          json(response, 202, { id: value.id });
          (async () => {
            try {
              const outcome = await executePlan(plan, selected, { guard: selectionGuard, cancelled: () => cancelled, onRecord: async row => {
                const summary = observed.get(row.itemId);
                if (row.status === 'deleted') { if (row.type === 'file') summary.deletedFiles++; else summary.deletedDirectories++; }
                else summary.skipped++;
                summary.status = summary.deletedFiles || summary.deletedDirectories ? 'partial' : 'skipped';
                summary.reason = row.reason;
                await receipt.writeFile(JSON.stringify(row) + '\n');
              }, onProgress: stats => { value.stats = { completed: stats.completed, total: stats.total, currentPath: stats.currentPath, processed: stats.processed }; value.results = stats.results; value.progress = stats.completed / stats.total; } });
              latestCleanup = { ...outcome, jobId: value.id };
              await receipt.sync();
              await saveState();
              Object.assign(value, { status: outcome.status, progress: 1, finishedAt: outcome.createdAt, message: '逐项清理结束，请查看记录' });
            } catch (error) {
              const results = [...observed.values()];
              latestCleanup = { kind: 'selection', jobId: value.id, createdAt: new Date().toISOString(), status: 'failed', results, deletedFiles: results.reduce((sum, row) => sum + row.deletedFiles, 0), skipped: results.reduce((sum, row) => sum + row.skipped, 0), bytes: 0, error: `清理或记录未完整完成：${error.message}。请核对已记录的结果，磁盘占用未估算。` };
              await saveState().catch(() => {});
              Object.assign(value, { status: 'failed', error: error.message, finishedAt: latestCleanup.createdAt });
            } finally {
              await receipt.close().catch(() => {});
            }
          })();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/mole/execute-clean') {
          const body = await readJSON(request);
          if (body.confirmation !== 'PERMANENT_MOLE_CLEAN') return json(response, 400, { error: '请先审阅 Mole 清理预览，并明确确认永久清理' });
          const preview = [...jobs.values()].reverse().find(value => value.type === 'mole' && value.mode === 'preview' && value.command === 'clean');
          if (!preview || preview.id !== body.previewId || preview.status !== 'complete' || preview.exitCode !== 0 || !preview.output?.trim()) return json(response, 400, { error: '需要先完成本次 Mole 深度清理预览；全盘占用扫描不能代替清理预览' });
          if (!preview.finishedAt || Date.now() - Date.parse(preview.finishedAt) > 30 * 60_000) return json(response, 400, { error: '清理预览已过期，请重新生成预览' });
          if (preview.usedBy) return json(response, 409, { error: '这份预览已经执行过，请重新生成清理预览' });
          const value = job('mole');
          Object.assign(value, { command: 'clean', mode: 'execute', previewId: preview.id, message: '正在执行 Mole 原生清理…' });
          preview.usedBy = value.id;
          try {
            await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
            await appendFile(path.join(runtimeDirectory, 'mole-actions.jsonl'), JSON.stringify({ event: 'confirmed', jobId: value.id, previewId: preview.id, createdAt: value.createdAt }) + '\n', { mode: 0o600 });
            if (latestScan) latestScan.stale = true;
            if (latestAnalysis) latestAnalysis.stale = true;
            if (projectAnalysis) projectAnalysis.stale = true;
            await saveState();
            const runner = cleanupRunner(text => { value.output = (value.output + text).slice(-200_000); }, async result => {
              Object.assign(value, { status: result.error ? 'cancelled' : result.code === 0 ? 'complete' : 'failed', progress: 1, exitCode: result.code, error: result.error, finishedAt: new Date().toISOString() });
              latestCleanup = { kind: 'mole', jobId: value.id, createdAt: value.finishedAt, status: value.status, exitCode: result.code, output: value.output, error: value.error };
              await appendFile(path.join(runtimeDirectory, 'mole-actions.jsonl'), JSON.stringify({ event: 'finished', ...latestCleanup }) + '\n', { mode: 0o600 }).catch(error => { value.auditWarning = error.message; });
              await saveState().catch(error => { value.persistenceWarning = error.message; });
            });
            value.cancel = runner.cancel;
            return json(response, 202, { id: value.id });
          } catch (error) { Object.assign(value, { status: 'failed', error: error.message }); return json(response, 500, { error: `清理未能启动：${error.message}` }); }
        }
        if (request.method === 'POST' && url.pathname === '/api/cancel') {
          const body = await readJSON(request);
          const value = jobs.get(body.id);
          if (!value?.cancel || value.status !== 'running') return json(response, 400, { error: '这个任务不可停止' });
          if (value.cancel() === false) return json(response, 409, { error: '正在保存完成结果，请稍候' });
          return json(response, 200, { ok: true });
        }
        if (request.method === 'POST' && url.pathname === '/api/cleanup') {
          const body = await readJSON(request);
          if (body.confirmation !== 'MOVE_TO_TRASH' || body.scanId !== latestScan?.id) return json(response, 400, { error: '请确认当前扫描中的文件后重试' });
          if ([...jobs.values()].some(value => value.status === 'running') || activeMutation) return json(response, 409, { error: '请等当前任务完成' });
          activeMutation = true;
          try {
            // Refuse before touching files if we cannot prepare the local audit log.
            const runtime = runtimeDirectory;
            await mkdir(runtime, { recursive: true, mode: 0o700 });
            await appendFile(path.join(runtime, 'cleanup.jsonl'), JSON.stringify({ action: 'requested', createdAt: new Date().toISOString(), scanId: body.scanId, ids: body.ids }) + '\n', { mode: 0o600 });
            latestCleanup = await moveToTrash(latestScan, body.ids, home);
            // A fresh scan is required before any subsequent cleanup.
            latestScan = null;
            await saveState().catch(error => { latestCleanup.warning = `整理记录保存失败：${error.message}`; });
            await appendFile(path.join(runtime, 'cleanup.jsonl'), JSON.stringify({ action: 'finished', ...latestCleanup }) + '\n', { mode: 0o600 }).catch(() => { latestCleanup.warning = '文件已移到废纸篓，但审计日志写入失败；请保留本次结果'; });
            return json(response, 200, latestCleanup);
          } finally { activeMutation = false; }
        }
        return json(response, 404, { error: '接口不存在' });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' });
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/motion.js': ['motion.js', 'text/javascript; charset=utf-8'], '/design-system.html': ['design-system.html', 'text/html; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
      let file = files[url.pathname];
      if (!file && /^\/fonts\/[A-Za-z0-9._-]+\.woff2$/.test(url.pathname)) file = [url.pathname.slice(1), 'font/woff2'];
      if (!file) return json(response, 404, { error: '页面不存在' });
      const content = await readFile(path.join(projectRoot, 'public', file[0]));
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!response.headersSent) json(response, error.status || 400, { error: error.message }); }
  });
  const summaryExpiry = setInterval(() => { for (const [id, prepared] of summaryPreviews) if (!prepared.used && Date.now() - Date.parse(prepared.createdAt) > 600000) summaryPreviews.delete(id); }, 30000);
  summaryExpiry.unref();
  server.on('close', () => { clearInterval(summaryExpiry); summaryPreviews.clear(); fileBrowser?.dispose(); for (const value of jobs.values()) if (value.status === 'running') value.cancel?.('本地服务已停止'); });
  return server;
}

async function recoverInterruptedReceipt(receipt, runtimeDirectory) {
  receipt.status = 'interrupted';
  receipt.error = '上次服务在清理时中断。以下统计只包含已写入的记录，未记录的操作结果需要核对；不会自动继续清理。';
  const rows = new Map(receipt.results.map(row => [row.id, { ...row, status: 'skipped', deletedFiles: 0, deletedDirectories: 0, skipped: 0, bytes: 0, reason: '服务中断，尚未记录的结果待核对' }]));
  try {
    const contents = await readFile(path.join(runtimeDirectory, 'cleanups', `${receipt.jobId}.jsonl`), 'utf8');
    for (const line of contents.split('\n')) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const row = rows.get(record.itemId);
      if (!row) continue;
      if (record.status === 'deleted') { if (record.type === 'file') row.deletedFiles++; else row.deletedDirectories++; row.status = 'partial'; }
      else row.skipped++;
    }
  } catch { /* Keep the explicit interrupted status even if the journal is unavailable. */ }
  receipt.results = [...rows.values()];
  receipt.deletedFiles = receipt.results.reduce((sum, row) => sum + row.deletedFiles, 0);
  receipt.skipped = receipt.results.reduce((sum, row) => sum + row.skipped, 0);
  receipt.bytes = 0;
}

function pageOffset(url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的分页参数');
  return offset;
}

async function readJSON(request) {
  let content = '';
  for await (const chunk of request) { content += chunk; if (Buffer.byteLength(content) > 64_000) throw new Error('请求过大'); }
  try { return JSON.parse(content || '{}'); } catch { throw new Error('无效的 JSON 请求'); }
}

async function readErrors(filename, offset, phase = null) {
  const input = createReadStream(filename, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const result = [];
  let index = 0;
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (phase && row.phase !== phase) continue;
      if (index++ < offset) continue;
      result.push(row);
      if (result.length >= 100) break;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { reader.close(); input.destroy(); }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4783);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须介于 1024 和 65535');
  const server = createApp({ port, persistState: true });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可用 PORT=4784 npm start 换一个端口。` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`\n  Minorminor  v0.1.0\n  http://127.0.0.1:${port}\n  本地运行 · Ctrl+C 停止\n`);
    if (process.argv.includes('--open') && process.platform === 'darwin') spawn('/usr/bin/open', [`http://127.0.0.1:${port}`], { stdio: 'ignore' }).on('error', () => {});
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
