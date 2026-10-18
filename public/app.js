import { tr, ui, getLocale, languagePicker } from './i18n.js';
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sparkle: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7L20 2Z"/>',
  disk: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.7"/><path d="m14 10 4-4"/>',
  terminal: '<path d="m5 7 5 5-5 5m8 0h6"/><rect x="2" y="3" width="20" height="18" rx="3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  shield: '<path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  settings: '<path d="m9 3-.6 3-2 .9-2.8-1-2 3.4L4 11v2l-2.4 1.7 2 3.4 2.8-1 2 .9.6 3h4l.6-3 2-.9 2.8 1 2-3.4L18 13v-2l2.4-1.7-2-3.4-2.8 1-2-.9L13 3H9Z"/><circle cx="11" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M8 13h8m-8 4h6"/>',
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v10M7 5.5l9 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  play: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m10 8 6 4-6 4V8Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  external: '<path d="M14 3h7v7m0-7L11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  leaf: '<path d="M20 3c-9-1-17 3-16 10 1 8 16 11 16-10Z"/><path d="M3 22 15 9"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
};
const icon = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const bytes = (value, digits = 1) => { if (value == null) return '—'; if (value === 0) return '0 B'; const n = Math.min(Math.floor(Math.log(Math.max(value, 1)) / Math.log(1000)), 4); return `${(value / 1000 ** n).toFixed(n ? digits : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][n]}`; };
const count = value => new Intl.NumberFormat(getLocale()).format(value || 0);
const time = value => value ? new Date(value).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) : tr('尚未扫描');
const aiPages = [['ai', tr('按项目清理'), 'layers'], ['ai-tools', tr('工具概览'), 'grid'], ['ai-storage', tr('目录与缓存'), 'file'], ['ai-models', tr('本地模型'), 'box'], ['ai-diagnostics', tr('读取诊断'), 'help'], ['assistant', tr('AI 判读'), 'leaf']];
const isAiRoute = route => aiPages.some(([id]) => id === route);
const titles = { overview: tr('总览'), clean: tr('空间清理'), projects: tr('项目清理'), analyze: tr('磁盘分析'), ...Object.fromEntries(aiPages.map(([route, title]) => [route, title])) };
const state = { route: location.hash.slice(1) || 'overview', disk: null, mole: null, scan: null, analysis: null, cleanup: null, job: null, lastMole: null, cleanPreview: null, cleanPlan: null, ai: null, adviceSource: null, pendingAdvice: null, planSelected: new Set(), cleanFilter: '', cleanQuery: '', cleanOffset: 0, aiToolFilter: '', aiKindFilter: '', aiQuery: '', aiOffset: 0, projectQuery: '', projectType: '', projectOffset: 0, projectSort: 'size', projectSelected: new Set(), projectCategories: new Set(['cache', 'log']), projectPersonal: false, projectPlanSelected: new Set(), aiExpanded: isAiRoute(location.hash.slice(1)) && !window.matchMedia('(max-width: 820px)').matches, lastInventoryJob: null, scopes: [], scope: 'disk', selected: new Set(), token: null, error: null };
if (!titles[state.route]) state.route = 'overview';
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
let toastTimer;
let pollGeneration = 0;
let fileExplorer = null, fileBrowseGeneration = 0, folderPollTimer;
let associationView = { storageId: null, projectId: '', status: '', query: '', offset: 0, result: null, loading: false, error: null }, associationGeneration = 0;
const expandedFiles = new Set(), fileContents = new Map();
const cleanupBarObserver = new ResizeObserver(([entry]) => { if (entry?.target.isConnected) document.documentElement.style.setProperty('--cleanup-actions-height', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`); });
function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4500); }
async function api(endpoint, body, retry = true) {
  const response = await fetch(`/api/${endpoint}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': state.token }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    if (retry && body !== undefined && response.status === 403 && data.error === '会话已过期，请刷新页面') {
      state.token = (await api('bootstrap')).token;
      return api(endpoint, body, false);
    }
    throw Object.assign(new Error(data.error || tr('请求失败')), { status: response.status });
  }
  return data;
}
function button(action, label, { kind = 'primary', glyph, disabled = false, extra = '' } = {}) { return `<button class="btn ${kind}" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${glyph ? icon(glyph, 17) : ''}${label}</button>`; }
function scanButton(label = tr('开始扫描')) { return button('scan', state.job?.type === 'sync' ? tr('正在同步…') : label, { glyph: state.job?.type === 'sync' ? 'refresh' : 'sparkle', disabled: !!state.job }); }
function liveInventory() { return ['scan', 'analyze'].includes(state.job?.type) || state.job?.type === 'sync' && state.job.stats?.stage === 'disk' ? state.job.stats : null; }
function scopePicker(hero = false) { return ui`<select class="scope-select ${hero ? 'hero-scope' : ''}" aria-label="扫描范围" ${state.job ? 'disabled' : ''}>${state.scopes.map(scope => `<option value="${scope.id}" ${state.scope === scope.id ? 'selected' : ''}>${escape(tr(scope.label))}</option>`).join('')}</select>`; }
const duration = ms => { const seconds = Math.floor((ms || 0) / 1000); return seconds >= 3600 ? ui`${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : seconds >= 60 ? ui`${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : ui`${seconds} 秒`; };
function navigate(route) { if (state.route === route) return; location.hash = route; }
window.addEventListener('hashchange', () => { state.route = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; state.aiExpanded = isAiRoute(state.route) && !window.matchMedia('(max-width: 820px)').matches; render(); ensureAssociationView(); });
function navItem(route, glyph) { return `<a href="#${route}" aria-label="${titles[route]}" title="${titles[route]}" class="nav-item ${state.route === route ? 'active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(glyph, 19)}<span>${titles[route]}</span>${route === 'assistant' ? '<span class="new-dot"></span>' : ''}</a>`; }
function aiNavigation() {
  return ui`<div class="ai-nav-group ${state.aiExpanded ? 'is-open' : ''}"><button class="nav-item nav-group-toggle ${isAiRoute(state.route) ? 'has-active' : ''}" data-action="ai-nav-toggle" aria-label="AI 专项" aria-expanded="${state.aiExpanded}" aria-controls="ai-subnav">${icon('layers', 19)}<span>AI 专项</span><span class="nav-fold" aria-hidden="true">${state.aiExpanded ? '▾' : '▸'}</span></button><div id="ai-subnav" class="ai-subnav" ${state.aiExpanded ? '' : 'hidden'}>${aiPages.map(([route, title, glyph]) => navItem(route, glyph)).join('')}</div></div>`;
}
function render() {
  const actions = cleanupActionBar();
  cleanupBarObserver.disconnect();
  app.innerHTML = ui`<aside class="sidebar">
    <a class="brand" href="#overview"><img src="/icon.svg" width="34" height="34" alt=""/><span>minorminor<span class="brand-dot">.</span></span></a>
    <nav aria-label="主导航">${navItem('overview', 'grid')}${navItem('clean', 'sparkle')}${navItem('projects', 'layers')}${aiNavigation()}${navItem('analyze', 'disk')}</nav>
    <div class="sidebar-bottom">${languagePicker()}<button class="nav-item setting-button" data-action="settings" aria-label="设置">${icon('settings', 18)}<span>设置</span></button><div class="sidebar-version">v0.1.0</div></div>
  </aside><div class="workspace ${actions ? 'has-cleanup-actions' : ''}">
  <main id="main">${state.error ? `<div class="error-banner" role="alert">${escape(state.error)} ${button('retry', tr('重新连接'), { kind: 'secondary' })}</div>` : ''}${page()}</main>
  ${actions}
</div>`;
  const bar = app.querySelector('.cleanup-actions');
  document.documentElement.style.setProperty('--cleanup-actions-height', `${bar ? Math.ceil(bar.getBoundingClientRect().height) : 0}px`);
  if (bar) cleanupBarObserver.observe(bar);
}
function cleanupActionBar() {
  const projectPage = ['projects', 'ai'].includes(state.route);
  if (!projectPage && !['clean', 'ai-storage'].includes(state.route)) return '';
  let summary, actions;
  if (projectPage) {
    const storage = state.ai?.projectStorage, plan = state.ai?.projectPlan;
    const selected = (plan?.groups || []).filter(row => state.projectPlanSelected.has(row.id));
    const canPreview = projectStorageReady() && state.projectSelected.size > 0 && state.projectCategories.size > 0;
    if (!storage || storage.stale) {
      summary = ui`<strong>项目清理</strong><small>${storage ? tr('统计已过期') : tr('尚未扫描')}</small>`;
      actions = scanButton(storage ? tr('重新扫描') : tr('开始扫描'));
    } else if (selected.length && projectPlanReady()) {
      summary = ui`<strong>预览已选 ${selected.length} 类 · ${bytes(selected.reduce((sum, row) => sum + row.bytes, 0))}</strong><small>${count(selected.reduce((sum, row) => sum + row.files, 0))} 个文件 · 移到废纸篓</small>`;
      actions = `${button('project-show-plan', tr('查看预览'), { kind: 'secondary' })}${button('project-build-plan', tr('重新预览'), { kind: 'secondary', disabled: !canPreview })}${button('project-review-trash', tr('审阅并移到废纸篓'), { glyph: 'trash' })}`;
    } else {
      const candidateBytes = storage.groups.filter(row => state.projectSelected.has(row.projectId)).reduce((sum, row) => sum + [...state.projectCategories].reduce((size, kind) => size + (row.categories[kind]?.candidateBytes || 0), 0), 0);
      summary = ui`<strong>已选 ${state.projectSelected.size} 个项目</strong><small>候选 ${bytes(candidateBytes)}</small>`;
      actions = `${plan ? button('project-show-plan', tr('查看预览'), { kind: 'secondary', disabled: !!state.job }) : ''}${button('project-build-plan', state.job?.type === 'project-plan' ? tr('正在预览…') : tr('预览清理'), { disabled: !canPreview })}`;
    }
  } else {
    const selected = planChosen();
    summary = ui`<strong>已选 ${selected.length} 项 · ${bytes(selected.reduce((sum, row) => sum + row.bytes, 0))}</strong><small>可视化清理 · ${count(selected.reduce((sum, row) => sum + row.files, 0))} 个文件 · 永久删除${state.cleanPlan && !planReady() && !state.job ? tr(' · 清单需更新') : ''}</small>`;
    actions = `${visualPlanPrepareButton()}${button('plan-review', tr('审阅所选清理'), { glyph: 'arrow', disabled: !selected.length || !planReady() })}`;
  }
  return `<section class="cleanup-actions" aria-label="${projectPage ? tr('项目清理操作') : tr('可视化清理操作')}"><div class="cleanup-action-summary" aria-live="polite" aria-atomic="true">${summary}</div><div class="cleanup-action-buttons">${actions}</div></section>`;
}
function page() {
  if (state.route === 'clean') return cleanPage();
  if (state.route === 'projects') return `${heading(tr('项目清理'), `<div class="scan-controls">${scopePicker()}${scanButton(state.scan ? tr('重新扫描') : tr('开始扫描'))}</div>`)}${progress()}${projectPanel() || tr('<section class="panel empty-state">尚未扫描</section>')}`;
  if (isAiRoute(state.route)) return aiPage();
  if (state.route === 'analyze') return analyzePage();
  return overviewPage();
}
function heading(title, action = '') { return `<section class="page-heading"><h1>${title}</h1>${action ? `<div class="heading-action">${action}</div>` : ''}</section>`; }
function progress() {
  const job = state.job;
  if (!job) return '';
  if (job.type === 'sync') {
    const s = job.stats || {};
    const metrics = s.stage === 'projects' ? ui`<span>索引 <strong>${count(s.records)}</strong></span><span>内容文件 <strong>${count(s.contentFiles)}</strong></span>` : s.stage === 'ai' && s.phase === 'discover' ? ui`<span>已检查 <strong>${count(s.directories)}</strong> 个目录</span>` : s.stage === 'ai' ? ui`<span>范围 <strong>${count(s.completed)} / ${count(s.total)}</strong></span>` : s.stage === 'models' ? '' : ui`<span>文件 <strong>${count(s.files ?? s.count)}</strong></span><span>占用 <strong>${bytes(s.bytes || 0)}</strong></span>${s.stage === 'storage' ? ui`<span>项目 <strong>${count(s.completed)} / ${count(s.total)}</strong></span>` : ''}`;
    return `<section class="background-progress" role="status"><div class="background-progress-top">${icon('refresh', 18)}<strong>${escape(job.cancelling ? tr('正在停止…') : job.message || tr('正在准备同步扫描…'))}</strong>${button('cancel', tr('停止'), { kind: 'secondary', glyph: 'stop', disabled: !job.id || job.cancelling || job.committing })}</div><div class="background-metrics">${metrics}${s.skipped ? button('errors', ui`${count(s.skipped)} 项未读取`, { kind: 'text', extra: `data-job="${job.id}"` }) : ''}</div>${s.currentPath ? `<div class="current-path">${escape(s.currentPath)}</div>` : ''}<div class="task-track indeterminate"><i></i></div></section>`;
  }
  if (job.type === 'project-storage') return ui`<section class="background-progress" role="status"><div class="background-progress-top">${icon('refresh', 18)}<strong>${escape(tr(job.message))}</strong>${button('cancel', job.cancelling ? tr('正在停止…') : tr('停止'), { kind: 'secondary', glyph: 'stop', disabled: job.cancelling })}</div><div class="background-metrics"><span>文件 <strong>${count(job.stats?.files)}</strong></span><span>已计量 <strong>${bytes(job.stats?.bytes || 0)}</strong></span><span>已检查项目 <strong>${count(job.stats?.completed)} / ${count(job.stats?.total)}</strong></span></div><div class="current-path">${escape(job.stats?.currentPath || tr('正在准备…'))}</div><div class="task-track indeterminate"><i></i></div></section>`;
  if (job.type === 'project-analysis') return ui`<section class="background-progress" role="status"><div class="background-progress-top">${icon('refresh', 18)}<strong>${escape(tr(job.message))}</strong>${button('cancel', job.cancelling ? tr('正在停止…') : tr('停止'), { kind: 'secondary', glyph: 'stop', disabled: job.cancelling })}</div><div class="background-metrics"><span>已读取索引 <strong>${count(job.stats?.records)}</strong> 条</span><span>内容文件 <strong>${count(job.stats?.contentFiles)}</strong> 个</span></div><div class="current-path">${escape(job.stats?.currentPath || tr('正在准备…'))}</div><div class="task-track indeterminate"><i></i></div></section>`;
  if (['plan', 'selection', 'ai-scan', 'ai-review', 'harness-analysis', 'ai-summary', 'model-clean', 'project-analysis', 'project-plan', 'project-trash'].includes(job.type)) return `<section class="background-progress" role="status"><div class="background-progress-top">${icon('refresh', 18)}<strong>${escape(tr(job.message))}</strong>${button('cancel', job.cancelling ? tr('正在停止…') : tr('停止'), { kind: 'secondary', glyph: 'stop', disabled: job.cancelling })}</div><div class="background-metrics"><span>${job.type === 'ai-scan' && job.stats?.phase === 'discover' ? ui`特征发现 · 已检查 <strong>${count(job.stats?.directories)}</strong> 个目录` : `${job.type === 'plan' ? tr('已读取项目') : job.type === 'ai-scan' ? tr('占用统计范围') : tr('已处理项目')} <strong>${count(job.stats?.completed)} / ${count(job.stats?.total)}</strong>`}</span></div><div class="current-path">${escape(job.stats?.currentPath || tr('正在准备…'))}</div><div class="task-track indeterminate"><i></i></div></section>`;
  const s = job.stats;
  return ui`<section class="background-progress" aria-label="后台任务"><div class="background-progress-top"><span class="spinner"></span><strong>${escape(job.message || tr('正在准备后台扫描…'))}</strong>${button('cancel', job.cancelling ? tr('正在停止…') : tr('停止'), { kind: 'text', glyph: 'stop', disabled: job.cancelling })}</div>${s ? ui`<div class="background-metrics"><span>已扫描 <strong>${count(s.count)}</strong> 个文件</span><span>${count(s.directories)} 个目录</span><span>${bytes(s.bytes)}</span><span>${duration(s.elapsedMs)}</span>${s.skipped ? ui`<button class="text-button" data-action="errors" data-job="${job.id}">${count(s.skipped)} 项无法读取</button>` : ''}</div><div class="current-path" title="${escape(s.currentPath)}">${escape(s.currentPath)}</div>` : `<p>${job.mode === 'execute' ? tr('Mole 正在永久清理符合规则的文件。停止任务不会恢复已经清理的文件。') : job.type === 'mole' ? tr('正在生成原生预览，不会执行文件清理。') : tr('正在启动本地后台任务…')}</p>`}<div class="task-track indeterminate"><i></i></div></section>`;
}
function scanReport() {
  const result = state.scan;
  if (!result || state.job) return '';
  return ui`<div class="scan-report"><span>${icon(result.complete ? 'check' : 'stop', 16)}${result.stale ? tr('清理前的扫描快照') : result.complete ? tr('完整扫描已结束') : tr('扫描已取消，仅保留已读统计')} · ${escape(result.scope?.label || '')} · ${count(result.count)} 个文件 · ${duration(result.elapsedMs)}</span>${result.errorCount ? button('errors', ui`${count(result.errorCount)} 项无法读取`, { kind: 'text', extra: `data-job="${escape(result.jobId)}" data-phase="disk"` }) : tr('<span>无读取失败</span>')}</div>`;
}
function overviewPage() {
  const d = state.disk, live = liveInventory();
  const percent = d ? Math.round(d.used / d.total * 100) : 0;
  const scope = state.scopes.find(row => row.id === state.scope);
  return ui`${heading(tr('总览'))}${progress()}${scanReport()}
    <section class="overview-hero">
      <div class="panel scan-controls-panel"><h2>扫描文件</h2>${scopePicker()}${scope?.path ? `<code class="scan-scope-path">${escape(scope.path)}</code>` : ''}${scanButton(state.scan ? tr('重新扫描') : tr('开始扫描'))}</div>
      <div class="storage-card"><div class="card-top"><h3>${icon('disk', 17)}磁盘空间</h3></div><div class="disk-ring" style="--used:${percent}%"><div class="ring-inner"><span>可用空间</span><strong>${d ? bytes(d.free).split(' ')[0] : '—'}<small>${d ? bytes(d.free).split(' ')[1] : 'GB'}</small></strong><span>共 ${bytes(d?.total)}</span></div></div><div class="disk-legend"><span><i></i>已使用 <strong>${bytes(d?.used)}</strong></span><span><i></i>可用 <strong>${bytes(d?.free)}</strong></span></div></div>
    </section>
    <div class="stats-strip"><div><div class="stat-icon green">${icon('layers', 21)}</div><div><span>已扫描占用</span><strong>${live ? bytes(live.bytes) : state.scan ? bytes(state.scan.totalBytes) : tr('待扫描')}${live ? tr('<small>扫描中</small>') : state.scan?.complete === false ? tr('<small>已取消</small>') : ''}</strong></div></div><div><div class="stat-icon orange">${icon('box', 21)}</div><div><span>可移到废纸篓</span><strong>${live ? live.candidateBytes == null ? tr('统计中') : bytes(live.candidateBytes) : state.scan ? bytes(state.scan.candidateBytes) : '—'}${state.scan ? ui`<small>${count(state.scan.items.length)} 个文件</small>` : ''}</strong></div></div><div><div class="stat-icon blue">${icon('clock', 21)}</div><div><span>${live ? tr('扫描耗时') : tr('最近扫描')}</span><strong>${live ? duration(live.elapsedMs) : time(state.scan?.synchronizedAt || state.scan?.createdAt)}</strong></div></div></div>
    <section class="panel cleanup-panel"><div class="section-header"><h2>文件分类</h2><a href="#clean" class="subtle-link">查看文件 ${icon('arrow', 15)}</a></div>${categoryList(false)}</section>`;
}

const categories = [
  { id: 'cache', title: tr('应用缓存'), description: tr('浏览器与日常应用的临时缓存'), icon: 'layers', color: 'green' },
  { id: 'logs', title: tr('历史日志'), description: tr('14 天前的日志文件'), icon: 'file', color: 'blue' },
  { id: 'installers', title: tr('下载的安装包'), description: tr('7 天前下载的 DMG、PKG 安装文件'), icon: 'box', color: 'orange' },
  { id: 'trash', title: tr('废纸篓'), description: tr('废纸篓中的文件'), icon: 'trash', color: 'purple' },
];
function categoryList(full) {
  const live = !!liveInventory();
  return `<div class="category-list">${categories.map(category => {
    const result = (live ? state.job.stats?.categories : state.scan?.categories)?.find(item => item.id === category.id);
    const selectedCount = state.scan?.items.filter(item => item.category === category.id && state.selected.has(item.id)).length || 0;
    return `<button class="category-row" data-action="category" data-category="${category.id}"><span class="category-icon ${category.color}">${icon(category.icon, 21)}</span><span class="category-text"><strong>${category.title}${selectedCount ? ui`<span class="selected-badge">已选 ${selectedCount}</span>` : ''}</strong><span>${result ? (!result.available ? result.lastError ? escape(result.lastError.reason) : live ? tr('等待扫描') : tr('目录不存在或无法访问') : ui`${count(result.count)} 个文件${result.partial || result.skipped ? tr(' · 部分统计') : ''}${full && result.selectable ? ui` · ${result.candidates} 个可选` : ''}`) : ''}</span></span><span class="category-size">${result ? result.available ? bytes(result.bytes) : live && !result.lastError ? tr('待统计') : tr('未读取') : tr('待扫描')}</span>${icon('chevron', 16)}</button>`;
  }).join('')}</div>`;
}
function cleanPage() {
  const selected = state.scan?.items.filter(item => state.selected.has(item.id)) || [];
  return ui`${heading(tr('空间清理'), `<div class="scan-controls">${scopePicker()}${scanButton(state.scan ? tr('重新扫描') : tr('开始完整扫描'))}</div>`)}${progress()}${scanReport()}
    ${moleCleanerPanel()}
    ${visualCleanerPanel()}${selectionReceiptPanel()}
    <section class="panel"><div class="section-header"><div><h2>移到废纸篓</h2><p>${state.scan ? `${state.scan.complete === false ? tr('停止于') : tr('完成于')} ${time(state.scan.synchronizedAt || state.scan.createdAt)}${state.scan.partial ? tr(' · 无法读取的项目已单独记录') : ''}` : tr('尚未扫描')}</p></div></div>${categoryList(true)}<div class="selection-bar"><div><strong>已选择 ${selected.length} 个文件</strong><span>${bytes(selected.reduce((sum, item) => sum + item.bytes, 0))} · 可在废纸篓中还原</span></div>${button('review', tr('审阅并整理'), { glyph: 'arrow', disabled: !selected.length || !!state.job || state.scan?.complete === false || state.scan?.stale })}</div></section>
    ${state.scan?.complete && !state.scan.items.length ? ui`<div class="empty-inline">${icon('check', 22)}<div><strong>暂时没有符合条件的日志和安装包</strong></div></div>` : ''}
    ${state.cleanup && !state.cleanup.kind ? ui`<section class="panel history-panel"><div class="section-header"><div><h2>最近整理</h2><p>${time(state.cleanup.createdAt)} · 已移到废纸篓 ${state.cleanup.moved} 个文件</p></div><span class="quiet-tag">可还原</span></div></section>` : ''}
    `;
}
function analyzePage() {
  const live = liveInventory();
  const source = live || state.analysis;
  const rows = [...(source?.rows || [])].sort((a, b) => b.bytes - a.bytes);
  const sum = rows.reduce((total, row) => total + row.bytes, 0);
  const visible = rows.filter(row => row.bytes > 0);
  const chart = visible.slice(0, 8);
  const treemapTone = [['#3A4047', '#F7F5F0'], ['#4F565E', '#F7F5F0'], ['#646B73', '#F7F5F0'], ['#7B7468', '#F7F5F0'], ['#6D6478', '#F7F5F0'], ['#56677A', '#F7F5F0'], ['#9A968D', '#2A2C2F'], ['#C9C4B9', '#2A2C2F']];
  if (visible.length > 8) chart.push({ name: ui`其他 ${visible.length - 8} 项`, bytes: visible.slice(8).reduce((total, row) => total + row.bytes, 0), color: treemapTone[7][0] });
  return `${heading(tr('磁盘分析'), `<div class="scan-controls">${scopePicker()}${button('analyze', state.job?.type === 'analyze' ? tr('正在分析…') : state.analysis ? tr('重新分析') : tr('完整分析磁盘'), { glyph: 'disk', disabled: !!state.job })}</div>`)}${progress()}${scanReport()}
    ${!rows.length ? ui`<section class="panel empty-state"><div class="empty-icon">${icon('disk', 40)}</div><h2>尚未分析</h2>${button('analyze', tr('开始完整分析'), { glyph: 'arrow', disabled: !!state.job })}</section>` : ui`<section class="panel analysis-summary"><div class="section-header"><div><h2>${live ? tr('实时目录分布') : tr('完整目录分布')}</h2><p>${escape(source.scope?.label || '')} · 已统计 ${bytes(sum)} · ${count(live?.count ?? source.count)} 个文件${live ? tr(' · 扫描中，数值会继续更新') : ui` · ${time(source.synchronizedAt || source.createdAt)} 更新`}</p></div><span class="quiet-tag">${live ? tr('实时更新') : source.complete === false ? tr('已取消') : tr('遍历已结束')}</span></div><div class="treemap">${chart.map((row, index) => `<div style="flex-grow:${Math.max(row.bytes / (sum || 1) * 100, 3)};background:${(treemapTone[index] || treemapTone[7])[0]};color:${(treemapTone[index] || treemapTone[7])[1]}" title="${escape(row.name)} ${bytes(row.bytes)}"><strong>${escape(row.name)}</strong><span>${bytes(row.bytes)}</span></div>`).join('')}</div><div class="analysis-list">${rows.map(row => ui`<div class="analysis-row"><div class="category-icon">${icon(row.icon, 22)}</div><div class="analysis-name"><strong title="${escape(row.name)}">${escape(row.name)}</strong><span title="${escape(row.path)}">${escape(row.path.replace(state.disk?.home || '\0', '~'))}</span></div><div class="analysis-bar"><i style="width:${sum ? row.bytes / sum * 100 : 0}%"></i></div><div class="analysis-size"><strong>${row.status === 'pending' ? tr('待扫描') : row.status === 'mount' ? tr('其他挂载卷') : row.skipped && !row.count ? tr('未读取') : bytes(row.bytes)}</strong><span>${count(row.count)} 个文件${row.status === 'pending' ? tr(' · 等待中') : row.status === 'scanning' ? tr(' · 扫描中') : row.status === 'cancelled' ? tr(' · 已停止') : ''}${row.skipped ? ui` · ${row.skipped} 项未读取` : ''}</span></div>${summaryButton('disk', row.id, state.scan?.jobId)}</div>`).join('')}</div></section>`}
    `;
}
function aiPage() {
  const scan = state.ai?.scan;
  const content = state.route === 'ai' ? projectPanel(true) || tr('<section class="panel empty-state">尚未扫描</section>') : state.route === 'ai-tools' ? aiToolsPanel() : state.route === 'ai-storage' ? `${agentInventoryPanel()}${visualCleanerPanel()}${selectionReceiptPanel()}` : state.route === 'ai-models' ? aiModelsPanel() : state.route === 'ai-diagnostics' ? associationPage() : aiAdvisorPanel();
  return `${heading(titles[state.route], `<div class="scan-controls">${scopePicker()}${scanButton(scan ? tr('重新扫描') : tr('开始扫描'))}</div>`)}${progress()}${content}`;
}
function aiToolsPanel() {
  const scan = state.ai?.scan, items = scan?.items || [];
  const tools = [...new Set([...items.filter(row => row.discoveryMode !== 'generic').map(row => row.aiTool), ...(scan?.discovery?.agents || []).filter(agent => agent.discoveryMode !== 'generic' && ['installed-only', 'component-only'].includes(agent.status)).map(agent => agent.name)])].map(name => ({ name, rows: items.filter(row => row.aiTool === name) })).sort((a, b) => b.rows.reduce((sum, row) => sum + row.bytes, 0) - a.rows.reduce((sum, row) => sum + row.bytes, 0));
  return ui`${harnessCandidatesPanel(scan)}<section class="panel ai-overview"><div class="section-header"><div><h2>AI 工具的空间账本</h2><p>${scan ? ui`${time(scan.synchronizedAt || scan.createdAt)} 更新 · ${count(scan.files)} 个文件 · ${new Set(items.map(row => row.aiTool)).size} 类工具与候选有数据${scan.errorCount ? ui` · ${scan.errorCount} 项无法读取` : ''}` : tr('尚未扫描')}</p></div>${scan?.errorCount ? button('errors', tr('查看未读取项目'), { kind: 'secondary', extra: `data-job="${scan.jobId}" data-phase="ai"` }) : ''}</div>${scan?.stale ? tr('<div class="clean-plan-warning">这是清理前的快照，请重新扫描以更新模型和占用。</div>') : ''}<div class="visual-summary"><div><span>AI 工具与候选占用</span><strong>${scan ? bytes(scan.bytes) : tr('待扫描')}</strong></div><div><span>模型与数据集 · 需审阅</span><strong>${scan ? bytes(items.filter(row => row.aiKind === 'model').reduce((sum, row) => sum + row.bytes, 0)) : '—'}</strong></div><div><span>会话、配置与项目 · 保留</span><strong>${scan ? bytes(items.filter(row => row.aiKind === 'state').reduce((sum, row) => sum + row.bytes, 0)) : '—'}</strong></div></div>${tools.length ? `<div class="ai-tool-grid">${tools.map(tool => ui`<article><span class="ai-tool-mark">${escape(tool.name.slice(0, 1))}</span><div><strong>${escape(tool.name)}</strong><small>${tool.rows.length ? ui`${tool.rows.length} 个数据范围` : escape(agentStatus[scan?.discovery?.agents.find(agent => agent.name === tool.name)?.status] || tr('未发现数据'))}</small><button class="text-button" data-action="agent-evidence" data-tool="${escape(tool.name)}">查看识别依据</button><button class="text-button" data-action="agent-scopes" data-tool="${escape(tool.name)}">目录 · 缓存 · 日志</button><small>${(() => { const total = state.ai?.inventory?.tools.find(row => row.name === tool.name); return total ? ui`缓存 ${bytes(total.cacheBytes)} · 日志 ${bytes(total.logBytes)}` : ''; })()}</small></div><strong>${tool.rows.length ? bytes(tool.rows.reduce((sum, row) => sum + row.bytes, 0)) : '—'}</strong></article>`).join('')}</div>` : `<p class="ai-empty-note">${scan ? tr('未发现已适配工具') : tr('尚未扫描')}</p>`}</section>${agentDiscoveryPanel(scan)}`;
}
const harnessStatusNames = { pending: tr('待 AI 识别'), 'ai-supported': tr('AI 推断为工具'), 'ai-rejected': tr('AI 判断非独立工具'), uncertain: tr('身份不确定'), 'analysis-failed': tr('AI 识别失败') };
function harnessCandidatesPanel(scan) {
  if (!scan?.discovery?.candidates) return '';
  const candidates = scan.discovery.candidates, config = state.ai?.config, coverage = scan.discovery.coverage.generic;
  const names = { cache: tr('缓存'), log: tr('日志'), session: tr('会话'), memory: tr('记忆'), state: tr('其他'), config: tr('配置') };
  return ui`<section class="panel harness-candidates"><div class="section-header"><div><h2>自动发现的工具候选 · ${count(candidates.length)}</h2>${coverage ? ui`<p>结构抽读 ${count(coverage.sampledFiles)} 个文件${coverage.samplesDeferred ? ui` · ${count(coverage.samplesDeferred)} 项未抽读` : ''}${coverage.errors ? ui` · ${count(coverage.errors)} 项读取失败` : ''}</p>` : ''}</div>${config?.configured && config.harnessAnalysis ? button('harness-analyze', tr('AI 识别候选'), { kind: 'secondary', glyph: 'sparkle', disabled: !!state.job || scan.stale || !candidates.some(row => !row.analysis), extra: `data-snapshot="${scan.id}"` }) : button('ai-config', tr('配置 AI 识别'), { kind: 'secondary', disabled: !!state.job })}</div><div class="agent-evidence-list">${candidates.map(candidate => {
    const rows = scan.items.filter(row => row.candidateId === candidate.id), analysis = candidate.analysis;
    const totals = new Map(); for (const row of rows) totals.set(row.aiCategory, (totals.get(row.aiCategory) || 0) + row.bytes);
    return ui`<article><div class="inventory-row-heading"><strong>${escape(candidate.name)}</strong><span class="quiet-tag">${escape(harnessStatusNames[candidate.status] || tr('用途待确认'))}</span><b>${candidate.installationOnly ? tr('未定位数据') : bytes(rows.reduce((sum, row) => sum + row.bytes, 0))}</b></div><code>${escape(candidate.path)}</code><small>${[...totals].map(([kind, amount]) => `${names[kind] || kind} ${bytes(amount)}`).join(' · ')}</small>${analysis ? ui`<p>${escape(analysis.reason)}</p><small>待确认：${escape(analysis.uncertainty)}</small>` : candidate.analysisError ? `<p>${escape(candidate.analysisError)}</p>` : ''}<details><summary>识别依据 · ${candidate.evidence.length}</summary>${candidate.evidence.map(proof => `<div><code>${escape(proof.path)}</code><small>${escape(proof.detail)}</small></div>`).join('')}${analysis ? `<small>${escape(analysis.model)} · ${time(analysis.createdAt)}${candidate.analysisCached ? tr(' · 已复用本机判断') : ''}</small>` : ''}</details><div class="inventory-row-footer">${summaryButton('candidate', candidate.id, scan.id)}${button('agent-scopes', tr('目录与用途'), { kind: 'text', extra: `data-tool="${escape(candidate.tool)}"` })}${button('agent-evidence', tr('查看详情'), { kind: 'text', extra: `data-tool="${escape(candidate.tool)}"` })}</div>${summaryMarkup('candidate', candidate.id, scan.id)}</article>`;
  }).join('') || tr('<p class="ai-empty-note">本次扫描没有额外工具候选</p>')}</div></section>`;
}
function aiModelsPanel() {
  const scan = state.ai?.scan, models = scan?.ollama?.models || [], modelReceipt = state.ai?.modelCleanup;
  return ui`<section class="panel ai-ollama"><div class="section-header"><div><h2>Ollama 本地模型</h2></div></div>${models.length ? `<div class="ai-model-list">${models.map(model => `<article><span class="category-icon blue">${icon('box', 20)}</span><div><strong>${escape(model.name)}</strong><small>${escape(model.digest.slice(0, 16))}… · ${model.deleted ? tr('已移除') : ''}</small></div><strong>${bytes(model.bytes)}</strong>${button('model-review', model.deleted ? tr('已移除') : tr('审阅移除'), { kind: 'secondary', disabled: model.deleted || !!state.job || scan.stale, extra: `data-model="${model.id}"` })}</article>`).join('')}</div>` : `<p class="ai-empty-note">${escape(scan?.ollama?.reason || (scan ? tr('没有已安装的模型') : tr('尚未检测模型')))}</p>`}${modelReceipt ? `` : ''}</section>`;
}
const projectCategoryNames = { cache: tr('缓存'), log: tr('日志'), session: tr('会话'), memory: tr('记忆'), other: tr('代码 / 依赖 / 配置 / 备份') };
const associationStatusNames = { readable: tr('可读取'), recovered: tr('已补读'), missing: tr('路径失效'), permission: tr('权限受限'), unsafe: tr('安全跳过'), ambiguous: tr('多个匹配'), 'not-file': tr('不是文件'), error: tr('读取错误') };
function projectAssociationMarkup(group, stats) {
  if (!stats.associationCounts) return stats.missingFiles ? button('association-details', ui`${count(stats.missingFiles)} 个关联文件待核对`, { kind: 'text', extra: `data-project="${group.id}"` }) : '';
  return `<div class="project-association-status">${Object.entries(stats.associationCounts).filter(([status, total]) => status !== 'readable' && total).map(([status, total]) => button('association-details', `${associationStatusNames[status]} ${count(total)}`, { kind: 'text', extra: `data-project="${group.id}" data-status="${status}"` })).join('')}</div>`;
}
function associationPage() {
  const storage = state.ai?.projectStorage, view = associationView, result = view.result;
  if (!storage) return tr('<section class="panel empty-state">尚未扫描</section>');
  const summary = result?.summary || storage.associationSummary || {};
  return ui`<section class="panel association-panel"><div class="section-header"><div><h2>关联文件</h2><p>${time(storage.synchronizedAt || storage.createdAt)} 更新</p></div>${button('scan', tr('重新核对'), { kind: 'secondary', disabled: !!state.job })}</div><div class="clean-category-filters">${[['', tr('全部')], ...Object.entries(associationStatusNames).filter(([status]) => ['readable', 'recovered', 'missing', 'permission'].includes(status) || summary[status])].map(([status, label]) => button('association-filter', `${label} ${storage.associationSummary ? count(status ? summary[status] : Object.values(summary).reduce((n, v) => n + v, 0)) : '—'}`, { kind: view.status === status ? 'primary' : 'secondary', extra: `data-status="${status}"` })).join('')}</div><form id="association-search" class="inventory-controls"><label>项目<select name="project" aria-label="筛选关联项目"><option value="">全部项目</option>${(state.ai?.projects?.groups || []).map(group => `<option value="${group.id}" ${view.projectId === group.id ? 'selected' : ''}>${escape(group.name)} · ${escape(shortPath(group.path))}</option>`).join('')}</select></label><input name="query" aria-label="搜索关联文件" placeholder="搜索工具名或路径" value="${escape(view.query)}"/><button type="submit" class="btn secondary">查找</button></form>${storage.stale ? tr('<p class="project-policy">统计已过期，请重新扫描。</p>') : ''}${view.loading ? tr('<p class="file-browser-note" role="status">正在读取关联文件…</p>') : view.error ? `<p class="file-browser-note" role="alert">${escape(view.error)}</p>${button('association-page', tr('重试'), { kind: 'secondary' })}` : !result?.checked ? tr('<p class="file-browser-note">关联文件待核对，请重新扫描。</p>') : `<div class="agent-evidence-list association-list">${result.rows.map(row => `<article><div class="inventory-row-heading"><strong>${escape(associationStatusNames[row.status])}</strong><span>${escape(row.agent)} · ${escape(projectCategoryNames[row.kind])}</span><b>${bytes(row.bytes)}</b></div><small>${escape(row.projectIds.map(id => state.ai.projects.groups.find(group => group.id === id)?.name || id).join(' · '))}</small>${row.indexedPath !== row.path ? ui`<code>索引：${escape(row.indexedPath)}</code><code>实际：${escape(row.path)}</code>` : `<code>${escape(row.path)}</code>`}<p>${escape(tr(row.reason))} <span class="quiet-tag">${escape(row.code)}</span></p></article>`).join('') || tr('<p class="file-browser-note">没有匹配的关联文件。</p>')}</div><div class="clean-pagination"><span>${result.total ? result.offset + 1 : 0}–${Math.min(result.offset + result.rows.length, result.total)} / ${count(result.total)}</span><div>${button('association-page', tr('上一页'), { kind: 'secondary', disabled: !result.offset, extra: `data-offset="${Math.max(0, result.offset - 100)}"` })}${button('association-page', tr('下一页'), { kind: 'secondary', disabled: !result.hasMore, extra: `data-offset="${result.offset + 100}"` })}</div></div>`}</section>`;
}
function ensureAssociationView() {
  if (state.route === 'ai-diagnostics' && state.ai?.projectStorage && (associationView.storageId !== state.ai.projectStorage.id || !associationView.result && !associationView.loading && !associationView.error)) void loadAssociations();
}
async function loadAssociations() {
  const storage = state.ai?.projectStorage; if (!storage) return;
  const generation = ++associationGeneration;
  if (associationView.projectId && !state.ai.projects?.groups.some(group => group.id === associationView.projectId)) associationView.projectId = '';
  Object.assign(associationView, { storageId: storage.id, loading: true, error: null }); render();
  try {
    const params = new URLSearchParams({ storageId: storage.id, project: associationView.projectId, status: associationView.status, query: associationView.query, offset: String(associationView.offset) });
    const result = await api(`ai/project-storage/associations?${params}`);
    if (generation !== associationGeneration) return;
    associationView.result = result;
  } catch (error) { if (generation === associationGeneration) associationView.error = error.message; }
  finally { if (generation === associationGeneration) { associationView.loading = false; if (state.route === 'ai-diagnostics') render(); } }
}
function projectStorageReady() { return !!state.ai?.projectStorage && !state.ai.projectStorage.stale && !state.ai?.projects?.stale && !state.job; }
function projectPlanReady() { const plan = state.ai?.projectPlan; return projectStorageReady() && !!plan && !plan.usedBy && plan.storageId === state.ai.projectStorage.id && Date.parse(plan.expiresAt) > Date.now(); }
function projectStat(group) { return state.ai?.projectStorage?.groups.find(row => row.projectId === group.id); }
function projectPick(group) { return ui`<label class="project-pick-label"><input type="checkbox" class="project-pick" data-project="${group.id}" aria-label="勾选项目 ${escape(group.name)}" ${state.projectSelected.has(group.id) ? 'checked' : ''} ${!projectStorageReady() ? 'disabled' : ''}/></label>`; }
function projectSizeMarkup(group) {
  const s = projectStat(group);
  if (!s) return tr('<div class="project-size-empty">尚未统计占用</div>');
  const categories = ['cache', 'log', 'session', 'memory'];
  const incomplete = [s.directoryStatus === 'partial' ? tr('占用未统计完整') : s.directoryStatus === 'unavailable' ? tr('原目录不可用') : ''].filter(Boolean);
  return ui`<div class="project-size"><div class="project-size-categories">${categories.map(kind => ui`<button class="project-size-category ${kind}" data-action="project-storage-files" data-project="${group.id}" data-kind="${kind}"><span>${projectCategoryNames[kind]}</span><strong>${bytes(s.categories[kind].bytes)}</strong><small>${count(s.categories[kind].files)} 个文件</small></button>`).join('')}</div><p class="project-size-other">代码与其他 ${bytes(s.categories.other.bytes)}${state.ai.projectStorage.stale ? tr(' · 待更新') : ''}</p>${incomplete.length ? `<p class="project-size-warning">${escape(incomplete.join(' · '))}</p>` : ''}${projectAssociationMarkup(group, s)}</div>`;
}
function projectStorageControls() {
  const storage = state.ai?.projectStorage;
  return ui`<div class="project-storage-controls"><div class="section-header"><div><h3>项目占用</h3>${storage ? ui`<p>${time(storage.synchronizedAt || storage.createdAt)} 更新 · ${count(storage.coverage.files)} 个文件${storage.errors.length ? ui` · ${count(storage.errors.length)} 项读取错误` : ''}</p>` : ''}</div></div>${storage?.stale ? tr('<p class="project-policy">统计已过期，请重新扫描。</p>') : ''}${storage ? ui`<div class="project-clean-options"><div class="project-category-options">${['cache', 'log', 'session', 'memory'].map(kind => `<label><input type="checkbox" class="project-category-pick" value="${kind}" ${state.projectCategories.has(kind) ? 'checked' : ''} ${!!state.job || !projectStorageReady() || ['session', 'memory'].includes(kind) && !state.projectPersonal ? 'disabled' : ''}/>${projectCategoryNames[kind]}</label>`).join('')}</div><label class="project-personal-option"><input type="checkbox" id="project-personal" ${state.projectPersonal ? 'checked' : ''} ${!projectStorageReady() ? 'disabled' : ''}/>启用会话和记忆清理</label></div>` : ''}</div>`;
}
function projectTrashPanel() {
  const plan = state.ai?.projectPlan;
  if (!plan) return '';
  return ui`<section class="project-trash-panel" id="project-clean-preview"><div class="section-header"><div><h3>项目整理预览 · 具体文件清单</h3><p>${time(plan.createdAt)} · ${escape(tr(plan.method))}</p></div></div>${!projectPlanReady() ? tr('<p class="clean-plan-warning">预览已使用、过期、正在运行任务或统计已变化，请重新生成。</p>') : ''}<div class="project-plan-rows">${plan.groups.map(row => ui`<article><label><input type="checkbox" class="project-plan-pick" data-group="${row.id}" ${state.projectPlanSelected.has(row.id) ? 'checked' : ''} ${!row.selectable || !projectPlanReady() ? 'disabled' : ''}/><strong>${escape(row.name)} · ${projectCategoryNames[row.kind]}</strong></label><span>${bytes(row.bytes)} · ${count(row.files)} 个可整理文件</span>${button('project-plan-files', tr('查看具体文件'), { kind: 'text', extra: `data-group="${row.id}"` })}${row.retainedCount ? button('project-plan-files', ui`${count(row.retainedCount)} 个文件保留及原因`, { kind: 'text', extra: `data-group="${row.id}" data-retained="true"` }) : ''}</article>`).join('') || tr('<p class="clean-no-results">所选项目与类别未发现可整理的独立文件。共享数据库、近期数据与保留原因见下方。</p>')}</div>${plan.retained.length ? `<div class="project-retained-notes">${plan.retained.map(row => `<p>${escape(state.ai.projects.groups.find(group => group.id === row.projectId)?.name || '')}：${escape(tr(row.reason))}</p>`).join('')}</div>` : ''}</section>`;
}
async function projectStorageFiles(project, kind, offset = 0) {
  await loadProjectFiles({ projectId: project, kind, directoryId: null, offset, query: '' });
}
const summaryResults = new Map();
let summaryPreparing = false;
const summaryKey = (source, id, snapshotId, index) => [source, snapshotId, id, index ?? ''].join(':');
function summaryButton(source, id, snapshotId, index) {
  if (!id || !snapshotId) return '';
  return button('ai-summarize', tr('AI 总结'), { kind: 'text', disabled: !!state.job, extra: `data-source="${source}" data-resource="${escape(id)}" data-snapshot="${escape(snapshotId)}"${index == null ? '' : ` data-index="${index}"`}` });
}
function summaryMarkup(source, id, snapshotId, index) {
  const result = summaryResults.get(summaryKey(source, id, snapshotId, index));
  return result ? ui`<p class="ai-file-summary"><span>AI 总结</span>${escape(result.summary)}</p>` : '';
}
function showSummary(result) {
  const c = result.coverage;
  showDialog(ui`<h2 id="dialog-title">${escape(result.name)} · AI 总结</h2><code class="summary-path">${escape(result.path)}</code><p class="ai-summary-output">${escape(result.summary)}</p>${result.points.length ? `<ul class="ai-summary-points">${result.points.map(row => `<li>${escape(row)}</li>`).join('')}</ul>` : ''}${result.limitations ? `<p>${escape(result.limitations)}</p>` : ''}<small>${escape(result.model)} · ${c.filesRead ? ui`读取 ${c.filesRead} 个文件${c.truncated ? tr(' · 抽读') : ''}` : tr('仅元数据，未读取正文')} · ${time(result.createdAt)}</small><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
async function prepareSummary(target) {
  if (summaryPreparing || state.job) return;
  if (!state.ai?.config?.configured) { toast(tr('先连接用于 AI 总结的模型')); aiConfigDialog(); return; }
  const source = target.dataset.source, id = target.dataset.resource, snapshotId = target.dataset.snapshot, index = target.dataset.index == null ? undefined : Number(target.dataset.index);
  const cached = summaryResults.get(summaryKey(source, id, snapshotId, index));
  if (cached) { showSummary(cached); return; }
  summaryPreparing = true;
  showDialog(tr('<h2 id="dialog-title">AI 总结</h2><p role="status">正在准备所选范围…</p>'), true);
  try {
    const prepared = await api('ai/summaries/prepare', { source, id, snapshotId, index }), c = prepared.coverage;
    state.pendingSummary = prepared;
    showDialog(ui`<h2 id="dialog-title">${escape(prepared.name)} · AI 总结</h2><code class="summary-path">${escape(prepared.path)}</code><p>${c.filesRead ? ui`已准备 ${count(c.filesRead)} 个文件的${c.truncated ? tr('内容片段') : tr('内容')} · ${bytes(c.bytesRead)}` : tr('仅元数据，未准备可读正文')}</p><p>发送至 ${escape(prepared.destination)} · ${escape(prepared.model)}</p>${prepared.files.length ? `<div class="summary-file-list">${prepared.files.map(file => `<small>${escape(file.name)}${file.truncated ? tr(' · 抽读') : ''}</small>`).join('')}</div>` : ''}<div class="dialog-actions">${button('close-dialog', tr('取消'), { kind: 'secondary' })}${button('ai-summary-confirm', tr('发送所选内容并总结'), { glyph: 'sparkle' })}</div>`, true);
  } catch (error) { showDialog(ui`<h2 id="dialog-title">AI 总结</h2><p role="alert">${escape(error.message)}</p><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`); }
  finally { summaryPreparing = false; }
}
function fileContentMarkup(row) {
  const content = fileContents.get(row.id);
  if (!content) return `${row.title ? `<p>${escape(row.title)}</p>` : ''}${row.canPreview ? button('file-inspect', tr('查看内容片段'), { kind: 'secondary', extra: `data-file="${row.id}"` }) : `<p>${escape(row.previewReason || row.error)}</p>`}`;
  if (content.loading) return tr('<p aria-live="polite">正在本地读取开头片段…</p>');
  if (content.error) return `<p role="alert">${escape(content.error)}</p>`;
  return ui`<div class="file-content"><span class="quiet-tag">${content.mode === 'content' ? tr('已读取内容片段') : tr('仅元数据')}</span>${!content.excerpt ? `<p>${escape(content.summary)}</p>` : ''}${content.fields?.length ? `<dl>${content.fields.map(field => `<div><dt>${escape(field.name)}</dt><dd>${escape(field.value)}</dd></div>`).join('')}</dl>` : ''}${content.excerpt ? `<pre>${escape(content.excerpt)}</pre>` : ''}<small>读取 ${bytes(content.bytesRead)}${content.truncated ? tr(' · 片段已截断，不代表完整内容') : ''}</small></div>`;
}
const folderScanBusy = scan => ['queued', 'running', 'cancelling'].includes(scan?.status);
const folderPendingLabel = scan => folderScanBusy(scan) ? tr('统计中…') : ['cancelled', 'failed'].includes(scan?.status) ? tr('未完成') : scan?.status === 'complete' ? tr('待重新统计') : tr('待统计');
function directoryRowMarkup(row) {
  const size = row.folderSize;
  return ui`<div class="file-directory-row">${button(row.nestedProject ? 'file-nested-project' : 'file-directory', `${icon('box', 16)} ${escape(row.name)}`, { kind: 'text', extra: row.nestedProject ? `data-project="${row.nestedProject.id}"` : `data-file="${row.id}"` })}${row.nestedProject ? tr('<span class="quiet-tag">独立子项目</span>') : ''}<strong class="folder-size-number" ${!size ? 'data-folder-pending' : ''}>${size ? `${size.status === 'partial' ? '≥ ' : ''}${bytes(size.bytes)}` : folderPendingLabel(fileExplorer?.directoryScan)}<small>磁盘占用</small></strong><small class="folder-size-detail">${size ? ui`${count(size.files)} 个文件 · ${count(size.directories)} 个子文件夹 · 内容大小 ${bytes(size.logicalBytes)}` : ''}</small>${size?.skipped ? ui`<small class="folder-size-warning">${count(size.skipped)} 处未读取</small>` : ''}${summaryButton('project-file', row.id, fileExplorer?.storageId)}</div>${summaryMarkup('project-file', row.id, fileExplorer?.storageId)}`;
}
function directoryProgressMarkup(f) {
  if (f.kind !== 'tree' || !f.result?.directoryScan) return '';
  const scan = f.directoryScan || f.result.directoryScan, busy = folderScanBusy(scan), summary = f.result.directorySummary;
  return `<div class="folder-scan-banner ${scan.status === 'complete' ? 'is-complete' : ''}"><div><strong>${scan.status === 'running' ? tr('正在后台统计各层文件夹占用') : scan.status === 'queued' ? tr('文件夹统计已排队') : scan.status === 'cancelling' ? tr('正在停止统计…') : scan.status === 'complete' ? ui`${time(scan.synchronizedAt || scan.createdAt)} 更新` : scan.status === 'cancelled' ? tr('统计已停止') : scan.status === 'failed' ? tr('文件夹统计未完成') : tr('准备统计文件夹占用')}</strong>${busy ? button('folder-scan-cancel', tr('停止统计'), { kind: 'text', disabled: scan.status === 'cancelling' }) : button('folder-scan-refresh', ['cancelled', 'failed'].includes(scan.status) ? tr('重试') : tr('刷新大小'), { kind: 'text' })}</div>${busy ? ui`<p>已读取 ${count(scan.stats?.files)} 个文件、${count(scan.stats?.directories)} 个文件夹 · 已确认 ${bytes(scan.stats?.bytes || 0)}${scan.stats?.skipped ? ui` · ${count(scan.stats.skipped)} 项读取错误` : ''}。</p>${scan.stats?.currentPath ? `<code>${escape(scan.stats.currentPath)}</code>` : ''}` : summary && scan.status === 'complete' ? ui`<p>当前文件夹：${summary.skipped ? tr('至少 ') : ''}<b>${bytes(summary.bytes)}</b> · ${count(summary.files)} 个文件 · ${count(summary.directories)} 个文件夹${summary.skipped ? ui` · ${count(summary.skipped)} 处未读完整` : ''}</p>` : scan.error ? `<p>${escape(scan.error)}</p>` : ''}${scan.status === 'complete' && scan.summary?.skipped ? ui`<p class="folder-size-warning">${count(scan.summary.skipped)} 项无法完整读取，相关文件夹标为“≥ 已确认大小”。${scan.errors?.slice(0, 3).map(row => escape(row.path + '：' + row.reason)).join('；')}</p>` : ''}</div>`;
}
function updateDirectoryProgress() {
  const node = document.querySelector('.folder-scan-status');
  if (node && fileExplorer) node.innerHTML = directoryProgressMarkup(fileExplorer);
  document.querySelectorAll('[data-folder-pending]').forEach(node => { node.innerHTML = ui`${folderPendingLabel(fileExplorer?.directoryScan)}<small>磁盘占用</small>`; });
}
async function pollDirectorySizes(generation) {
  const f = fileExplorer;
  if (generation !== fileBrowseGeneration || f?.kind !== 'tree') return;
  try {
    const params = new URLSearchParams({ storageId: f.storageId, project: f.projectId });
    const scan = await api(`ai/project-storage/directory-sizes?${params}`);
    if (generation !== fileBrowseGeneration) return;
    fileExplorer.directoryScan = scan; updateDirectoryProgress();
    if (scan.status === 'complete') { await loadProjectFiles({ folderPollDone: true }); return; }
    if (folderScanBusy(scan)) folderPollTimer = setTimeout(() => pollDirectorySizes(generation), 1400);
  } catch (error) { if (generation === fileBrowseGeneration) { fileExplorer.directoryScan = { status: 'failed', error: error.message }; updateDirectoryProgress(); } }
}
async function controlDirectorySizes(action) {
  const f = fileExplorer; if (!f || f.kind !== 'tree') return;
  const generation = fileBrowseGeneration;
  const scan = await api('ai/project-storage/directory-sizes', { storageId: f.storageId, projectId: f.projectId, action });
  if (generation !== fileBrowseGeneration) return;
  fileExplorer.directoryScan = scan; updateDirectoryProgress();
  clearTimeout(folderPollTimer);
  if (action === 'refresh' || scan.status === 'complete') await loadProjectFiles({ folderPollDone: true });
  else if (folderScanBusy(scan)) folderPollTimer = setTimeout(() => pollDirectorySizes(generation), 700);
}
function projectFileExplorer(projectId) {
  const f = fileExplorer;
  if (!f || f.projectId !== projectId) return '';
  if (f.storageId !== state.ai?.projectStorage?.id || state.ai.projectStorage.stale) return tr('<div class="project-file-explorer"><p>项目统计已变化，请重新展开文件。</p></div>');
  const r = f.result, modes = { tree: tr('项目目录'), ...projectCategoryNames };
  return ui`<section class="project-file-explorer" aria-label="项目文件浏览"><div class="file-explorer-heading"><div><h3>文件</h3></div>${button('file-close', tr('收起文件'), { kind: 'text' })}</div><div class="file-modes">${['tree', 'cache', 'log', 'session', 'memory'].map(kind => `<button data-action="file-mode" data-kind="${kind}" class="${f.kind === kind ? 'active' : ''}" ${f.loading ? 'disabled' : ''}>${modes[kind]}</button>`).join('')}</div><form id="project-file-search" class="file-browser-controls"><input name="query" aria-label="搜索当前文件清单" placeholder="搜索文件" value="${escape(f.query)}"/><select name="sort" aria-label="文件排序"><option value="size" ${f.sort === 'size' ? 'selected' : ''}>占用从大到小</option><option value="name" ${f.sort === 'name' ? 'selected' : ''}>名称</option><option value="time" ${f.sort === 'time' ? 'selected' : ''}>最近修改</option></select><button type="submit" class="btn secondary" ${f.loading ? 'disabled' : ''}>查找</button></form>${r?.breadcrumbs?.length ? ui`<nav class="file-breadcrumbs" aria-label="文件目录路径">${r.breadcrumbs.map(crumb => button('file-directory', escape(crumb.name), { kind: 'text', disabled: f.loading, extra: `data-file="${crumb.id}"` })).join('<span>/</span>')}</nav>` : ''}${f.loading ? tr('<p class="file-browser-note" aria-live="polite">正在读取当前目录和文件信息…</p>') : f.error ? `<p class="file-browser-note" role="alert">${escape(f.error)}</p>${button('file-refresh', tr('重新读取'), { kind: 'secondary' })}` : r ? ui`<div class="folder-scan-status" role="status" aria-live="polite">${directoryProgressMarkup(f)}</div><div class="file-browser-list">${r.rows.map(row => row.directory ? directoryRowMarkup(row) : ui`<details class="file-entry" data-file="${row.id || ''}" ${expandedFiles.has(row.id) ? 'open' : ''}><summary><span class="file-entry-name">${icon('file', 16)}<b>${escape(row.name)}</b><small>${escape(row.category || modes[row.kind] || '')}</small><span>${escape(tr(row.purpose))}</span></span><strong>${bytes(row.bytes)}<small>磁盘占用</small>${summaryButton('project-file', row.id, f.storageId)}</strong></summary><div class="file-entry-body"><code>${escape(row.path)}</code><dl class="file-metadata"><div><dt>磁盘占用</dt><dd>${bytes(row.bytes)}${row.error ? tr('（旧统计）') : ''}</dd></div><div><dt>内容大小</dt><dd>${row.logicalBytes == null ? tr('未读取') : bytes(row.logicalBytes) + ' · ' + count(row.logicalBytes) + tr(' 字节')}</dd></div><div><dt>格式</dt><dd>${escape(row.format || tr('未知'))}</dd></div><div><dt>最后修改</dt><dd>${row.modifiedAt ? escape(new Date(row.modifiedAt).toLocaleString(getLocale())) : tr('未读取')}</dd></div></dl>${row.changed ? tr('<p class="file-warning">文件自统计后有变化；此页显示当前大小，整理前需重新统计。</p>') : ''}${row.error || row.blocked && !['仅供查看；整理仍需生成预览并通过实时检查', '此浏览清单不新增清理范围'].includes(row.blocked) ? `<p>${escape(row.error || row.blocked)}</p>` : ''}${fileContentMarkup(row)}</div></details>${summaryMarkup('project-file', row.id, f.storageId)}`).join('') || tr('<p class="file-browser-note">此范围没有匹配的文件。可切换上方分类，或进入项目目录查看其他文件。</p>')}</div>${r.errorCount ? ui`<p class="file-browser-note">${count(r.errorCount)} 个条目跳过或无法读取：${r.errors.map(error => escape(pathLeaf(error.path) + ' · ' + error.reason)).join('；')}${r.errorCount > 20 ? '…' : ''}</p>` : ''}<div class="clean-pagination"><span>${r.offset + (r.rows.length ? 1 : 0)}–${r.offset + r.rows.length} / ${count(r.total)} 个条目</span><div>${button('file-page', tr('上一页'), { kind: 'secondary', disabled: !r.offset, extra: `data-offset="${Math.max(0, r.offset - 100)}"` })}${button('file-page', tr('下一页'), { kind: 'secondary', disabled: !r.hasMore, extra: `data-offset="${r.offset + 100}"` })}</div></div>` : ''}</section>`;
}
function pathLeaf(value) { return String(value || '').split('/').pop(); }
async function loadProjectFiles(options = {}) {
  clearTimeout(folderPollTimer);
  const draft = options.folderPollDone ? document.querySelector('#project-file-search input')?.value : null;
  const generation = ++fileBrowseGeneration, storageId = state.ai?.projectStorage?.id;
  if (!storageId) return toast(tr('请先统计项目占用'));
  const newProject = options.projectId && options.projectId !== fileExplorer?.projectId;
  if (newProject || fileExplorer?.storageId !== storageId) { expandedFiles.clear(); fileContents.clear(); }
  fileExplorer = { kind: 'tree', directoryId: null, offset: 0, query: '', sort: 'size', ...(newProject ? {} : fileExplorer), ...options, storageId, loading: true, error: null };
  const f = fileExplorer;
  if (!options.folderPollDone) render();
  const params = new URLSearchParams({ storageId, project: f.projectId, kind: f.kind, offset: f.offset, sort: f.sort, query: f.query });
  if (f.directoryId) params.set('directory', f.directoryId);
  try { const result = await api(`ai/project-storage/browse?${params}`); if (generation !== fileBrowseGeneration) return; fileExplorer = { ...f, result, directoryScan: result.directoryScan, loading: false }; }
  catch (error) { if (generation !== fileBrowseGeneration) return; fileExplorer = { ...f, result: null, loading: false, error: error.message }; }
  render();
  if (draft != null) { const input = document.querySelector('#project-file-search input'); if (input) input.value = draft; }
  if (newProject) document.querySelector('.project-file-explorer')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (fileExplorer.kind === 'tree' && fileExplorer.result?.directoryScan) {
    try {
      let scan = fileExplorer.directoryScan;
      if (scan.status === 'idle') { scan = await api('ai/project-storage/directory-sizes', { storageId, projectId: f.projectId }); if (generation !== fileBrowseGeneration) return; fileExplorer.directoryScan = scan; updateDirectoryProgress(); if (scan.status === 'complete') { await loadProjectFiles({ folderPollDone: true }); return; } }
      if (folderScanBusy(scan)) folderPollTimer = setTimeout(() => pollDirectorySizes(generation), 700);
    } catch (error) { if (generation === fileBrowseGeneration) { fileExplorer.directoryScan = { status: 'failed', error: error.message }; updateDirectoryProgress(); } }
  }
}
async function inspectProjectFile(id) {
  const storageId = fileExplorer?.storageId;
  expandedFiles.add(id); fileContents.set(id, { loading: true }); if (fileContents.size > 300) fileContents.delete(fileContents.keys().next().value); render();
  try { const result = await api('ai/project-storage/inspect', { storageId, id }); if (storageId === fileExplorer?.storageId) fileContents.set(id, result); }
  catch (error) { fileContents.set(id, { error: error.message }); }
  render();
}
async function projectPlanFiles(groupId, offset = 0, retained = false) {
  const r = await api(`ai/project-plan/groups/${encodeURIComponent(groupId)}?offset=${offset}&retained=${retained ? '1' : '0'}`);
  showDialog(`<h2 id="dialog-title">${escape(r.name)} · ${projectCategoryNames[r.kind]}</h2><div class="agent-evidence-list">${r.files.map(row => `<article><code>${escape(row.path)}</code><strong>${bytes(row.bytes)}</strong>${row.reason ? `<p>${escape(tr(row.reason))}</p>` : ''}</article>`).join('') || tr('<p>此清单没有文件。</p>')}</div><div class="clean-pagination"><span>${offset + (r.files.length ? 1 : 0)}–${offset + r.files.length} / ${count(r.total)}</span><div>${offset ? button('project-plan-files', tr('上一页'), { kind: 'secondary', extra: `data-group="${groupId}" data-retained="${retained}" data-offset="${Math.max(0, offset - 100)}"` }) : ''}${r.hasMore ? button('project-plan-files', tr('下一页'), { kind: 'secondary', extra: `data-group="${groupId}" data-retained="${retained}" data-offset="${offset + 100}"` }) : ''}</div></div><div class="dialog-actions">${button('close-dialog', tr('返回勾选'))}</div>`, true);
}
function reviewProjectTrash() {
  if (!projectPlanReady()) return;
  const selected = state.ai.projectPlan.groups.filter(row => state.projectPlanSelected.has(row.id));
  if (!selected.length) return;
  state.projectReviewed = { planId: state.ai.projectPlan.id, groupIds: selected.map(row => row.id) };
  const personal = selected.some(row => ['session', 'memory'].includes(row.kind));
  showDialog(ui`<div class="dialog-icon orange">${icon('trash', 29)}</div><h2 id="dialog-title">确认按项目移到废纸篓</h2><p class="clean-detail-note">共 ${count(selected.reduce((n, row) => n + row.files, 0))} 个文件、${bytes(selected.reduce((n, row) => n + row.bytes, 0))}。不会移动项目根目录，不清空废纸篓，因此不会立即释放空间。共享数据库与预览中保留的文件不处理。</p><div class="agent-evidence-list">${selected.map(row => ui`<article><strong>${escape(row.name)} · ${projectCategoryNames[row.kind]} · ${count(row.files)} 个文件</strong><small>${bytes(row.bytes)}</small></article>`).join('')}</div><label class="permanent-clean-ack"><input type="checkbox" id="project-trash-ack"/>我已查看具体文件，确认只移动本次勾选的项目类别</label>${personal ? tr('<label class="permanent-clean-ack"><input type="checkbox" id="project-personal-ack"/>我理解移走会话或记忆会影响工具历史和长期记忆，可依据执行记录从废纸篓手动还原</label>') : ''}<div class="dialog-actions">${button('close-dialog', tr('返回检查'), { kind: 'secondary' })}${button('project-confirm-trash', tr('确认移到废纸篓'), { disabled: true, glyph: 'trash' })}</div>`, true);
}
async function confirmProjectTrash() {
  if (!projectPlanReady() || !dialog.querySelector('#project-trash-ack')?.checked || dialog.querySelector('#project-personal-ack') && !dialog.querySelector('#project-personal-ack').checked || state.projectReviewed?.planId !== state.ai.projectPlan.id) return;
  await startJob('ai/projects/execute', { ...state.projectReviewed, confirmation: 'MOVE_REVIEWED_PROJECT_FILES_TO_TRASH', personalConfirmation: dialog.querySelector('#project-personal-ack')?.checked ? 'I_UNDERSTAND_HISTORY_AND_MEMORY_WILL_BE_MOVED' : undefined });
}
function projectSharedDialog() {
  const s = state.ai?.projectStorage; if (!s) return;
  showDialog(ui`<h2 id="dialog-title">共享数据库与跨项目文件</h2><p class="clean-detail-note">数据库的物理大小不能按会话行数推算。这里包含数据库本体及可读取的 WAL / SHM；项目卡片显示逻辑索引数量，不将这些大小相加。共享项保留。</p><div class="agent-evidence-list">${s.shared.map(row => ui`<article><code>${escape(row.path)}</code><strong>${row.bytes == null ? tr('未能读取大小') : bytes(row.bytes)} · 保留</strong><small>${count(row.records || 0)} 条索引 · ${row.projects.map(id => escape(state.ai.projects.groups.find(group => group.id === id)?.name || id)).join('、')}</small></article>`).join('')}${s.errors.map(row => `<article><strong>${escape(row.code)}</strong><code>${escape(row.path)}</code><p>${escape(tr(row.reason))}</p></article>`).join('')}</div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
function projectProtectedDialog(id) {
  const s = state.ai?.projectStorage?.groups.find(row => row.projectId === id); if (!s) return;
  showDialog(ui`<h2 id="dialog-title">${escape(s.name)} · 保留的大文件</h2><p class="clean-detail-note">代码、依赖、配置、模型、备份或未识别用途的数据保留。下面只展示当前统计中最大的 10 个保留文件，帮助解释占用，不是全部文件清单。</p><div class="agent-evidence-list">${s.largestProtected.map(row => ui`<article><code>${escape(row.path)}</code><strong>${bytes(row.bytes)} · 保留</strong></article>`).join('') || tr('<p>没有已计入的大文件。</p>')}</div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
function projectReceiptPanel() {
  const r = state.ai?.projectCleanup; if (!r) return '';
  if (r.status === 'running') return tr('<section class="project-trash-panel"><div class="section-header"><div><h3>正在按项目整理</h3><p>任务完成后显示最终数量与逐文件去向。</p></div></div></section>');
  return ui`<section class="project-trash-panel"><div class="section-header"><div><h3>按项目整理记录</h3><p>${time(r.createdAt)} · ${escape(r.status)}</p></div>${button('project-receipt', tr('查看逐文件去向与还原路径'), { kind: 'secondary' })}</div><p class="project-policy">已移到废纸篓：${r.moved == null ? tr('待核对') : count(r.moved)} 个 · ${r.movedBytes == null ? tr('大小待核对') : bytes(r.movedBytes)}；保留：${r.skipped == null ? tr('待核对') : count(r.skipped)} 个；未处理 ${count(r.unprocessed || 0)} 个。${escape(r.note || tr('正在处理，请等任务完成后核对。'))}</p></section>`;
}
async function projectReceiptDetails(offset = 0) {
  const r = await api(`ai/project-cleanups/${state.ai.projectCleanup.jobId}?offset=${offset}`), statuses = { moving: tr('移动前记录 · 需结合后续结果核对'), moved: tr('已移到废纸篓'), skipped: tr('保留') };
  showDialog(ui`<h2 id="dialog-title">项目整理去向</h2><p class="clean-detail-note">要还原时，可依据原路径从废纸篓移回。“移动前记录”不代表移动成功；中断后若缺少最终状态，请核对原路径与目标路径。</p><div class="agent-evidence-list">${r.records.map(row => ui`<article><strong>${statuses[row.status] || escape(row.status)} · ${projectCategoryNames[row.kind]}</strong><code>原路径：${escape(row.originalPath)}</code>${row.trashPath ? ui`<code>废纸篓：${escape(row.trashPath)}</code>` : ''}<small>${bytes(row.bytes)} ${escape(row.reason || '')}</small></article>`).join('') || tr('<p>此页暂无记录。</p>')}</div><div class="dialog-actions">${offset ? button('project-receipt', tr('上一页'), { kind: 'secondary', extra: `data-offset="${Math.max(0, offset - 100)}"` }) : ''}${r.records.length === 100 ? button('project-receipt', tr('下一页'), { kind: 'secondary', extra: `data-offset="${offset + 100}"` }) : ''}${button('close-dialog', tr('关闭'))}</div>`, true);
}
const projectTypes = { project: tr('现存项目目录'), workspace: tr('工作区 / 通用目录'), missing: tr('记录中的目录已不存在'), external: tr('用户目录外 / 临时目录') };
function projectPanel(aiOnly = false) {
  const report = state.ai?.projects, scan = state.ai?.scan;
  if (!scan) return '';
  const groups = (report?.groups || []).filter(group => (!aiOnly || group.agents.length) && (!state.projectType || group.type === state.projectType) && (!state.projectQuery || `${group.name} ${group.path} ${group.agents.join(' ')} ${group.description} ${group.titles.join(' ')}`.toLowerCase().includes(state.projectQuery.toLowerCase())));
  if (state.projectSort === 'size' && state.ai?.projectStorage) groups.sort((a, b) => (projectStat(b)?.totalBytes || 0) - (projectStat(a)?.totalBytes || 0));
  if (state.projectOffset >= groups.length) state.projectOffset = Math.max(0, Math.floor((groups.length - 1) / 12) * 12);
  const page = groups.slice(state.projectOffset, state.projectOffset + 12);
  return ui`<section class="panel project-panel"><div class="section-header"><div><h2>项目清单</h2><p>${report ? ui`${time(report.synchronizedAt || report.createdAt)} · ${count(report.groups.filter(group => !aiOnly || group.agents.length).length)} 个项目` : tr('扫描后查看各项目占用。')}</p></div></div>
  ${report ? ui`${report.stale ? tr('<div class="clean-plan-warning">项目数据已过期，请重新扫描。</div>') : ''}
  ${report.errors.length ? button('project-sources', ui`${count(report.errors.length)} 项读取失败`, { kind: 'text' }) : ''}${projectStorageControls()}
  <div class="inventory-controls project-controls"><label>排序<select id="project-sort"><option value="size" ${state.projectSort === 'size' ? 'selected' : ''}>占用从大到小</option><option value="sessions" ${state.projectSort === 'sessions' ? 'selected' : ''}>会话数量</option></select></label><label>项目类型<select id="project-type"><option value="">全部项目 / 工作目录</option>${Object.entries(projectTypes).map(([value, label]) => `<option value="${value}" ${state.projectType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><input id="project-search" type="search" aria-label="搜索项目" placeholder="搜索项目、Agent、会话标题…" value="${escape(state.projectQuery)}"/></div>
  <div class="project-grid">${page.map(group => ui`<article class="${fileExplorer?.projectId === group.id ? 'file-expanded-project' : ''}"><div class="project-line">${projectPick(group)}<button class="project-open" data-action="file-root" data-project="${group.id}" ${state.ai?.projectStorage?.stale ? 'disabled' : ''}><span class="px-icon">${icon('layers', 14)}</span><b>${escape(group.name)}</b><small>${escape(projectTypes[group.type])} · ${count(group.sessions)} 条会话</small></button><span class="project-bytes">${projectStat(group) ? bytes(projectStat(group).totalBytes) : tr('待统计')}</span></div><code class="project-path">${escape(group.path)}</code>${projectSizeMarkup(group)}${projectFileExplorer(group.id)}<div class="project-row-meta">${group.description ? `<p>${escape(group.description)}</p>` : ''}<small>${escape(group.agents.join(' · '))}</small></div><div class="inventory-row-footer">${group.exists ? summaryButton('project', group.id, report.id) : ''}${button('project-details', tr('项目详情'), { kind: 'secondary', extra: `data-project="${group.id}"` })}</div>${summaryMarkup('project', group.id, report.id)}</article>`).join('') || tr('<p class="clean-no-results">没有匹配的项目。</p>')}</div><div class="clean-pagination"><span>${groups.length ? state.projectOffset + 1 : 0}–${Math.min(state.projectOffset + 12, groups.length)} / ${count(groups.length)}</span><div>${button('project-page', tr('上一页'), { kind: 'secondary', disabled: !state.projectOffset, extra: `data-offset="${Math.max(0, state.projectOffset - 12)}"` })}${button('project-page', tr('下一页'), { kind: 'secondary', disabled: state.projectOffset + 12 >= groups.length, extra: `data-offset="${state.projectOffset + 12}"` })}</div></div>${projectTrashPanel()}${projectReceiptPanel()}` : ''}</section>`;
}
function sampleMarkup(sample) {
  return ui`<div class="project-log-sample"><code>${escape(sample.path)}</code><small>读取前 ${count(sample.bytesRead)} 字节${sample.truncated ? tr(' · 后续未读取') : ''}</small><p>级别：${escape(Object.entries(sample.levels).map(([level, total]) => `${level} ${total}`).join(' / ') || tr('未提取到'))}；错误码：${escape(sample.codes.join('、') || tr('未提取到'))}；组件：${escape(sample.components.join('、') || tr('未提取到'))}</p>${sample.cwdReferences.length ? ui`<p>样本中的工作目录引用：${sample.cwdReferences.map(escape).join('、')}</p>` : ''}</div>`;
}
async function projectDialog(id, offset = 0) {
  const result = await api(`ai/projects/${encodeURIComponent(id)}?offset=${offset}`), group = result.group;
  showDialog(`<h2 id="dialog-title">${escape(group.name)}</h2>${group.path ? `<div class="path-label">${escape(group.path)}</div>` : ''}<p class="clean-detail-note">${escape(group.description || '')}${result.stale ? tr('（旧快照，请更新归类。）') : ''}</p>${group.evidence?.length ? `<div class="project-doc-evidence">${group.evidence.map(row => ui`<p>说明来源：${escape(row.path)} · ${escape(row.field)}${row.markers ? ' · ' + row.markers.map(escape).join('、') : tr(' · 前 ') + count(row.bytesRead) + tr(' 字节')}${row.truncated ? tr('，后续未读取') : ''}</p>`).join('')}</div>` : ''}<div class="agent-evidence-list project-detail-rows">${result.rows.map(row => ui`<article><div class="inventory-row-heading"><strong>${escape(row.agent || tr('归属待确认'))} · ${escape(row.kindLabel || row.category || tr('记录'))}</strong><span class="quiet-tag">保留 / 只读审阅</span></div>${row.title ? `<strong>${escape(row.title)}</strong>` : ''}<code>${escape(row.physicalPath || row.sourcePath)}</code>${row.recordId ? ui`<small>索引记录：${escape(row.recordId)}</small>` : ''}${row.workingDirectory ? ui`<code>原始工作目录：${escape(row.workingDirectory)}</code>` : ''}${row.cwdReferences?.length > 1 ? ui`<small>样本中出现的工作目录：${row.cwdReferences.map(escape).join('、')}</small>` : ''}<p>${escape(row.explanation)}</p><small>${row.physicalBytes != null ? ui`此普通文件当前分配 ${bytes(row.physicalBytes)}；可能包含多项目上下文，不代表可清理空间` : row.bytes != null ? ui`此范围快照 ${bytes(row.bytes)}；与关联文件大小不累加` : tr('共享数据库逻辑记录；未按行估算物理占用')}</small>${(row.samples || []).map(sampleMarkup).join('')}</article>`).join('') || tr('<p>此处没有记录。</p>')}</div><div class="clean-pagination"><span>${offset + (result.rows.length ? 1 : 0)}–${offset + result.rows.length} / ${count(result.total)}</span><div>${offset ? button('project-details', tr('上一页'), { kind: 'secondary', extra: `data-project="${escape(id)}" data-offset="${Math.max(0, offset - 40)}"` }) : ''}${result.hasMore ? button('project-details', tr('下一页'), { kind: 'secondary', extra: `data-project="${escape(id)}" data-offset="${offset + 40}"` }) : ''}</div></div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
async function projectScopeDialog(id) {
  const { row, related, stale } = await api(`ai/project-scopes/${encodeURIComponent(id)}`);
  showDialog(ui`<h2 id="dialog-title">${escape(row.agent)} · 这是什么</h2><div class="path-label">${escape(row.sourcePath)}</div><p class="clean-detail-note">${escape(row.explanation)}${stale ? tr('（上次快照，请更新归类。）') : ''}</p><div class="agent-evidence-list">${row.samples.map(sampleMarkup).join('') || tr('<p>没有内容片段</p>')}${related.map(group => `<article><strong>${escape(group.name)}</strong><code>${escape(group.path)}</code>${button('project-details', tr('查看关联项目'), { kind: 'secondary', extra: `data-project="${group.id}"` })}</article>`).join('')}</div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
function projectSourcesDialog() {
  const report = state.ai?.projects;
  if (!report) return;
  showDialog(ui`<h2 id="dialog-title">项目归类读取范围</h2><div class="agent-evidence-list">${report.coverage.sources.map(source => ui`<article><strong>${escape(source.agent)} · ${source.status === 'complete' ? tr('指定字段读取完成') : tr('读取失败')} · ${count(source.records)} 条</strong><code>${escape(source.path)}${source.table ? ' → ' + escape(source.table) : ''}</code><small>${escape(source.method || tr('只查询目录、标题与会话标识字段；未查询消息 / 账号 / 凭据表'))}</small></article>`).join('')}${report.errors.map(row => `<article><strong>${escape(row.code)}</strong><code>${escape(row.path)}</code><p>${escape(tr(row.reason))}</p></article>`).join('')}</div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
const agentStatus = { 'data-found': tr('发现数据'), 'installed-only': tr('发现安装，未发现数据'), 'component-only': tr('发现内嵌组件，未确认独立 agent'), 'not-found': tr('未发现本地证据') };
function agentDiscoveryPanel(scan) {
  const discovery = scan?.discovery;
  if (!discovery) return '';
  const coverage = discovery.coverage;
  const paths = [...new Set([...(coverage.applicationDirectories || []), ...(coverage.binaryDirectories || []), ...(coverage.packageDirectories || [])])];
  return ui`<section class="panel agent-discovery"><details><summary>工具扫描路径 · ${count(paths.length)}</summary><div class="discovery-details">${paths.map(value => `<code class="agent-source-path">${escape(value)}</code>`).join('')}${coverage.errors ? ui`<p>${count(coverage.errors)} 项读取失败</p>` : ''}</div></details></section>`;
}

function agentEvidenceDialog(name) {
  const scan = state.ai?.scan, agent = scan?.discovery?.agents.find(row => row.name === name);
  const rows = (scan?.items || []).filter(row => row.aiTool === name).sort((a, b) => b.bytes - a.bytes);
  const proofs = agent?.evidence || [];
  const proofNames = { 'generic-discovery': tr('自动发现'), 'generic-installation': tr('安装信息'), 'generic-layout': tr('目录结构'), 'generic-content': tr('文件结构'), 'generic-category': tr('用途推断'), 'installation-path': tr('安装 / 运行依赖目录'), 'embedded-command': tr('宿主内嵌命令'), extension: tr('IDE 扩展'), 'python-package': tr('Python 安装包'), component: tr('内嵌 / 库组件'), signature: tr('专属特征'), 'project-signature': tr('项目资源'), 'project-config': tr('项目配置'), application: tr('应用安装'), package: tr('安装包'), product: tr('应用产品信息'), executable: tr('命令入口'), environment: tr('路径环境变量'), 'known-path': tr('标准路径') };
  showDialog(ui`<h2 id="dialog-title">${escape(name)}</h2><p class="clean-detail-note">${escape(agentStatus[agent?.status] || (rows.length ? tr('发现数据') : tr('未发现数据')))}</p><div class="agent-evidence-list">${proofs.map(proof => `<article><span class="quiet-tag">${escape(proofNames[proof.type] || proof.type)} · ${proof.confidence === 'high' ? tr('强依据') : tr('需结合其他线索')}</span><strong>${escape(proof.detail)}</strong><code>${escape(proof.path)}</code></article>`).join('') || tr('<p>本次扫描未发现可展示的识别证据。可以核对工具的实际安装位置和自定义数据路径。</p>')}</div><h3 class="agent-roots-title">发现的数据范围 · ${rows.length} 项</h3><div class="agent-evidence-list">${rows.map(row => `<article><strong>${escape(row.installation || row.installedComponent ? tr('安装文件 / 内嵌组件 · 保留') : row.aiCategory === 'log' ? tr('运行与诊断日志 · 候选') : ({ cache: tr('可重建缓存 · 候选'), state: tr('会话 / 配置 / 项目 · 保留'), model: tr('模型 / 数据集 · 保留') })[row.aiKind] || tr('保留'))} · ${bytes(row.bytes)}</strong><code>${escape(row.path)}</code><small>${escape(tr(row.reason))}</small></article>`).join('') || (agent?.status === 'component-only' ? tr('<p>未发现独立 Pi 数据目录。组件保留在所属宿主下；可以从上方证据路径定位，不加入通用清理。</p>') : tr('<p>未发现数据目录，未计入占用统计。</p>'))}</div>`, true);
}
const inventoryStatuses = { ready: tr('已有清理文件清单'), candidate: tr('候选 · 当前未授权'), 'needs-preview': tr('候选 · 待生成清单'), protected: tr('保留'), unreadable: tr('未完整读取 · 保留') };
function inventoryStatus(row) { return row.status === 'ready' && !planReady() ? 'needs-preview' : row.status; }
function filteredAgentRows() {
  const matchesKind = row => !state.aiKindFilter || (state.aiKindFilter === 'transient' ? ['cache', 'log'].includes(row.category) : state.aiKindFilter === 'ready' ? inventoryStatus(row) === 'ready' : row.category === state.aiKindFilter);
  return (state.ai?.inventory?.rows || []).filter(row => (!state.aiToolFilter || row.aiTool === state.aiToolFilter) && matchesKind(row) && (!state.aiQuery || `${row.aiTool} ${row.path} ${row.categoryLabel}`.toLowerCase().includes(state.aiQuery.toLowerCase())));
}
function agentInventoryPanel() {
  const inventory = state.ai?.inventory;
  if (!inventory) return '';
  const rows = filteredAgentRows();
  if (state.aiOffset >= rows.length) state.aiOffset = Math.max(0, Math.floor((rows.length - 1) / 40) * 40);
  const visible = rows.slice(state.aiOffset, state.aiOffset + 40);
  return ui`<section class="panel agent-inventory"><div class="section-header"><div><h2>Agent 目录、缓存与日志清单</h2></div><div class="inventory-exports"><a href="/api/ai/inventory/export?format=csv" download class="text-button">导出 CSV ${icon('download', 14)}</a><a href="/api/ai/inventory/export" download class="text-button">完整 JSON</a></div></div><div class="inventory-totals"><span>缓存候选 <strong>${bytes(inventory.cacheBytes)}</strong></span><span>日志候选 <strong>${bytes(inventory.logBytes)}</strong></span><span>全部范围 <strong>${count(inventory.rows.length)}</strong></span></div><div class="inventory-controls"><label>工具<select id="inventory-tool"><option value="">全部工具</option>${inventory.tools.map(tool => ui`<option value="${escape(tool.name)}" ${state.aiToolFilter === tool.name ? 'selected' : ''}>${escape(tool.name)} · ${tool.scopes} 处</option>`).join('')}</select></label><label>目录用途<select id="inventory-kind">${[['', tr('全部用途')], ['transient', tr('缓存和日志候选')], ['ready', tr('已有清理文件清单')], ['cache', tr('缓存')], ['log', tr('日志')], ['state', tr('状态与配置')], ['session', tr('推断的会话')], ['memory', tr('推断的记忆')], ['project', tr('项目资源')], ['installation', tr('安装文件与组件')], ['model', tr('模型与数据集')]].map(([value, label]) => `<option value="${value}" ${state.aiKindFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><input id="inventory-search" type="search" aria-label="搜索 Agent 目录" placeholder="搜索工具名或完整路径…" value="${escape(state.aiQuery)}"/></div><div class="agent-inventory-rows">${visible.map(row => ui`<article><div class="inventory-row-heading"><strong>${escape(row.aiTool)}</strong><span class="quiet-tag">${escape(row.categoryLabel)}</span><span class="inventory-status ${inventoryStatus(row)}">${inventoryStatuses[inventoryStatus(row)]}</span><b>${bytes(row.bytes)}</b></div><code>${escape(row.path)}</code>${inventoryStatus(row) === 'unreadable' ? `<p>${escape(row.policy)}</p>` : ''}<div class="inventory-row-footer"><small>${count(row.files)} 个文件${row.skipped ? ui` · ${count(row.skipped)} 项未读取` : ''}${row.links ? ui` · ${count(row.links)} 个符号链接未跟随` : ''}${row.planItems.length ? ui` · 清单部分 ${bytes(row.cleanableBytes)} / ${row.planItems.length} 项` : ''}</small>${state.ai?.projects?.snapshotId === state.ai?.scan?.id ? button('project-scope', tr('这是什么'), { kind: 'text', extra: `data-scope="${row.id}"` }) : ''}${summaryButton('ai-scope', row.id, state.ai.scan.id)}${button('agent-evidence', tr('识别依据'), { kind: 'text', extra: `data-tool="${escape(row.aiTool)}"` })}${inventoryStatus(row) === 'ready' ? button('inventory-plan-items', tr('审阅可清理文件'), { kind: 'secondary', extra: `data-scope="${row.id}"` }) : ''}</div>${summaryMarkup('ai-scope', row.id, state.ai.scan.id)}</article>`).join('') || `<p class="clean-no-results">${state.aiToolFilter ? tr('没有匹配的目录') : tr('此范围没有匹配的目录。')}</p>`}</div><div class="clean-pagination"><span>${rows.length ? `${state.aiOffset + 1}–${Math.min(state.aiOffset + 40, rows.length)}` : 0} / ${count(rows.length)} 项</span><div>${button('inventory-page', tr('上一页'), { kind: 'secondary', disabled: !state.aiOffset, extra: `data-offset="${Math.max(0, state.aiOffset - 40)}"` })}${button('inventory-page', tr('下一页'), { kind: 'secondary', disabled: state.aiOffset + 40 >= rows.length, extra: `data-offset="${state.aiOffset + 40}"` })}</div></div></section>`;
}
function inventoryPlanDialog(id) {
  const row = state.ai?.inventory?.rows.find(row => row.id === id);
  if (!row || inventoryStatus(row) !== 'ready') return;
  showDialog(ui`<h2 id="dialog-title">${escape(row.aiTool)} · 可清理部分</h2><div class="path-label">${escape(row.path)}</div><div class="agent-evidence-list">${row.planItems.map(item => ui`<article><strong>${bytes(item.bytes)} · ${count(item.files)} 个文件</strong><code>${escape(item.path)}</code>${button('plan-details', tr('查看具体文件'), { kind: 'secondary', extra: `data-item="${item.id}"` })}</article>`).join('')}</div>`, true);
}
function adviceSource() { return state.adviceSource || (isAiRoute(state.route) ? 'ai' : 'plan'); }
function aiAdvisorPanel() {
  const config = state.ai?.config;
  const source = adviceSource(), snapshot = source === 'ai' ? state.ai?.scan : state.cleanPlan;
  const advice = state.ai?.advice;
  const decision = { keep: tr('建议保留'), review: tr('需要审阅'), consider: tr('可考虑清理') };
  return ui`<section class="panel ai-advisor"><div class="section-header"><div><h2>AI 判读</h2><span class="quiet-tag">文档读取已禁用</span></div>${button('ai-config', config?.configured ? tr('模型连接设置') : tr('连接模型'), { kind: 'secondary', glyph: 'settings', disabled: !!state.job })}</div><div class="ai-advisor-controls"><label>判读范围<select id="advice-source" aria-label="AI 判读范围"><option value="ai" ${source === 'ai' ? 'selected' : ''}>AI 工具专项占用</option><option value="plan" ${source === 'plan' ? 'selected' : ''}>当前可视化清理清单</option></select></label><div class="ai-connection-state"><span class="status-dot ${config?.configured ? '' : 'offline'}"></span>${config?.configured ? ui`${config.provider === 'ollama' ? tr('本机 Ollama') : tr('兼容接口')} · ${escape(config.model)} · 已配置` : tr('未连接模型')}</div>${button('ai-judge', tr('开始判读'), { glyph: 'sparkle', disabled: !!state.job || !config?.configured || !snapshot || snapshot.stale, extra: 'data-offset="0"' })}</div>${!snapshot ? `<p class="ai-empty-note">${source === 'ai' ? tr('尚无扫描结果') : tr('尚无清理清单')}</p>` : ''}
    ${advice ? ui`<div class="ai-advice-output"><div class="ai-advice-summary"><strong>${escape(advice.model)} 的判读</strong><span>${time(advice.createdAt)} · 已判读 ${advice.analyzed} / ${advice.total} 项 · ${advice.source === 'ai' ? tr('AI 专项') : tr('可视化清单')}</span><p>${escape(advice.summary)}</p></div><div class="ai-advice-items">${advice.items.map(row => ui`<article><span class="advice-decision ${row.recommendation}">${decision[row.recommendation]}</span><div><strong>${escape(row.name)}</strong><small>${escape(shortPath(row.path))}</small><p>${escape(tr(row.reason))}</p><small>不确定之处：${escape(row.uncertainty)}</small></div><span class="quiet-tag">${({ low: tr('低'), medium: tr('中'), high: tr('高') })[row.risk]}风险</span></article>`).join('')}</div><div class="ai-advice-actions"><a class="text-button" href="/api/ai/advice/export" download>导出全部建议 ${icon('download', 14)}</a>${advice.nextOffset != null ? button('ai-judge', tr('判读下一批'), { kind: 'secondary', disabled: !!state.job || !config?.configured, extra: `data-offset="${advice.nextOffset}" data-source="${advice.source}"` }) : tr('<span class="quiet-tag">本次范围已判读完毕</span>')}</div></div>` : ''}</section>`;
}
function aiConfigDialog() {
  const config = state.ai?.config || { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '' };
  showDialog(ui`<h2 id="dialog-title">配置 AI 判读</h2><form id="ai-config-form" class="ai-config-form"><label>运行方式<select name="provider"><option value="ollama" ${config.provider === 'ollama' ? 'selected' : ''}>本机 Ollama</option><option value="compatible" ${config.provider === 'compatible' ? 'selected' : ''}>云端 / 本机兼容接口</option></select></label><label>接口基础地址<input name="baseUrl" type="url" required value="${escape(config.baseUrl)}" placeholder="https://api.deepseek.com/v1"/></label><label>模型名称<input name="model" required value="${escape(config.model)}" list="local-ai-models" placeholder="填写已安装或接口支持的模型名称"/></label><datalist id="local-ai-models"></datalist><label>API Key<input name="apiKey" type="password" autocomplete="off" placeholder="${config.hasKey ? tr('已在内存配置，留空保留') : tr('兼容接口按需填写，本机 Ollama 无需 Key')}"/></label><label class="ai-key-clear"><input name="clearKey" type="checkbox"/>清除已保存到内存的 Key</label><label class="ai-key-clear"><input name="harnessAnalysis" type="checkbox" ${config.harnessAnalysis ? 'checked' : ''}/>扫描后自动识别工具候选</label><small>向上述模型发送安装名称、用途枚举与结构特征，不发送文件正文和项目路径。</small><div id="ai-detection-result" role="status"></div><div class="dialog-actions">${button('ai-detect', tr('检测本机 Ollama'), { kind: 'secondary' })}<button class="btn primary" type="submit">保存连接</button></div></form>`, true);
}
async function previewAdvice(offset = 0, requestedSource) {
  const source = requestedSource || adviceSource();
  const snapshot = source === 'ai' ? state.ai?.scan : state.cleanPlan;
  if (!snapshot) { toast(tr('请先生成对应清单')); return; }
  const payload = await api(`ai/review-payload?source=${source}&snapshotId=${snapshot.id}&offset=${offset}`);
  state.pendingAdvice = { source, snapshotId: snapshot.id, offset, configRevision: payload.configRevision };
  showDialog(ui`<h2 id="dialog-title">判读这 ${payload.items.length} 项元数据</h2><p>目标：${escape(payload.destination)} · 模型 ${escape(payload.model)}。输入仅包含下方元数据，文件名中的文字会作为数据处理。模型无法读取文件或调用删除工具。</p><pre class="mole-review-output" aria-label="将发送给模型的元数据">${escape(JSON.stringify(payload.items, null, 2))}</pre><label class="permanent-clean-ack"><input type="checkbox" id="ai-metadata-ack"/>我已核对上述元数据和目标接口，同意发送以生成建议</label><div class="dialog-actions">${button('close-dialog', tr('返回检查'), { kind: 'secondary' })}${button('ai-confirm-judge', tr('发送元数据并判读'), { glyph: 'sparkle', disabled: true })}</div>`, true);
}
function reviewModel(id) {
  const model = state.ai?.scan?.ollama?.models.find(row => row.id === id);
  if (!model || model.deleted || state.ai.scan.stale) return;
  showDialog(ui`<div class="dialog-icon orange">${icon('box', 28)}</div><h2 id="dialog-title">移除 ${escape(model.name)}？</h2><p>由本机 Ollama 官方接口移除此模型。逻辑大小 ${bytes(model.bytes)}，共享层可能仍被其他模型引用，不能保证释放相同大小的磁盘空间。下次使用需要重新下载。</p><div class="path-label">${escape(model.digest)}</div><label class="permanent-clean-ack"><input type="checkbox" id="ai-model-ack"/>我确认不再需要这个模型，并理解重新使用需要下载</label><div class="dialog-actions">${button('close-dialog', tr('保留模型'), { kind: 'secondary' })}${button('ai-confirm-model', tr('确认移除此模型'), { glyph: 'trash', disabled: true, extra: `data-model="${id}"` })}</div>`, true);
}

const planRows = () => (state.cleanPlan?.items || []).filter(row => !row.coveredBy && (state.route !== 'ai-storage' || row.aiTool && row.aiKind === 'cache'));
const planChosen = () => planRows().filter(row => state.planSelected.has(row.id));
const shortPath = value => String(value || '').replace(state.disk?.home || '\0', '~');
function planReady() { return !state.job && state.cleanPlan && !state.cleanPlan.usedBy && state.cleanPlan.previewId === state.cleanPreview?.id && !state.cleanPreview.usedBy && Date.now() - Date.parse(state.cleanPlan.createdAt) <= 30 * 60_000; }
function filteredPlanRows() { return planRows().filter(row => (!state.cleanFilter || row.category === state.cleanFilter) && (!state.cleanQuery || `${row.name} ${row.path}`.toLowerCase().includes(state.cleanQuery.toLowerCase()))).sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.path.localeCompare(b.path)); }
function visualPlanPrepareButton() {
  return button(canExecuteClean() ? 'plan-prepare' : 'mole-prepare-clean', state.job ? tr('任务运行中…') : state.cleanPlan ? tr('重新生成清单') : tr('生成清理清单'), { kind: state.cleanPlan ? 'secondary' : 'primary', glyph: 'refresh', disabled: !!state.job || !state.mole?.available });
}
function visualCleanerPanel() {
  const rows = planRows(), eligible = rows.filter(row => row.selectable), chosen = planChosen();
  const totalBytes = eligible.reduce((sum, row) => sum + row.bytes, 0);
  const groups = [...new Set(rows.map(row => row.category))].map((category, index) => ({ category, tone: index % 6, items: rows.filter(row => row.category === category), bytes: eligible.filter(row => row.category === category).reduce((sum, row) => sum + row.bytes, 0) }));
  const filtered = filteredPlanRows(), visible = filtered.slice(state.cleanOffset, state.cleanOffset + 40);

  return `<section class="panel visual-cleaner"><div class="visual-heading"><div><h2>${state.route === 'ai-storage' ? tr('AI 工具缓存清理') : tr('可视化清理')} </h2></div></div>
    ${!state.cleanPlan ? ui`<div class="visual-empty">${icon('layers', 42)}<h3>尚未生成清单</h3></div>` : ui`
    <div class="visual-summary"><div><span>可逐项清理的占用</span><strong>${bytes(totalBytes)}</strong></div><div><span>范围内的具体文件</span><strong>${count(eligible.reduce((sum, row) => sum + row.files, 0))}<em>个</em></strong><small>${eligible.length} 个可选项目</small></div><div><span>本次已勾选</span><strong>${bytes(chosen.reduce((sum, row) => sum + row.bytes, 0))}</strong><small>${chosen.length} 项 · ${count(chosen.reduce((sum, row) => sum + row.files, 0))} 个文件</small></div></div>
    <div class="clean-space-map" aria-label="各类清理候选占用">${groups.filter(group => group.bytes).map((group, index) => `<button class="map-segment tone-${group.tone}" style="flex-grow:${group.bytes / Math.max(totalBytes, 1)}" data-action="plan-filter" data-category="${escape(group.category)}" aria-label="${escape(group.category)} ${bytes(group.bytes)}" title="${escape(group.category)} · ${bytes(group.bytes)}">${group.bytes / Math.max(totalBytes, 1) > .08 ? `<span>${escape(group.category)}</span><strong>${bytes(group.bytes)}</strong>` : ''}</button>`).join('')}</div>
    <div class="clean-category-filters"><button class="clean-chip ${!state.cleanFilter ? 'active' : ''}" data-action="plan-filter" data-category="">全部 ${rows.length}</button>${groups.map((group, index) => `<button class="clean-chip ${state.cleanFilter === group.category ? 'active' : ''}" data-action="plan-filter" data-category="${escape(group.category)}"><i class="tone-${group.tone}"></i>${escape(group.category)} <span>${group.items.length}</span></button>`).join('')}</div>
    ${!planReady() ? `<div class="clean-plan-warning">${icon('clock', 15)}${state.cleanPlan.usedBy ? tr('这份清单已处理。结果见下方，再次清理请生成新清单。') : state.job ? tr('任务正在后台运行，完成后可继续选择。') : tr('清单已过期或预览已更新，请重新生成后再清理。')}</div>` : ''}
    <div class="clean-list-toolbar"><label><input type="checkbox" data-plan-all aria-label="选择筛选范围内的全部可选项目" ${filtered.filter(row => row.selectable).length && filtered.filter(row => row.selectable).every(row => state.planSelected.has(row.id)) ? 'checked' : ''} ${!planReady() ? 'disabled' : ''}/>选择当前范围</label><input class="clean-search" type="search" placeholder="搜索名称或路径…" aria-label="搜索清理文件" value="${escape(state.cleanQuery)}"/><a class="text-button" href="/api/clean-plan/export" download>导出清单 ${icon('download', 14)}</a></div>
    <div class="clean-targets">${visible.map(row => ui`<article class="clean-target ${state.planSelected.has(row.id) ? 'chosen' : ''} ${!row.selectable ? 'unavailable' : ''}"><input type="checkbox" data-plan-item="${row.id}" aria-label="选择 ${escape(row.name)}" ${state.planSelected.has(row.id) ? 'checked' : ''} ${!row.selectable || !planReady() ? 'disabled' : ''}/><span class="target-icon">${icon(row.type === 'file' ? 'file' : 'layers', 21)}</span><div class="target-description"><strong>${escape(row.name)}</strong><span class="target-path" title="${escape(row.path)}">${escape(shortPath(row.path))}</span><small>${escape(row.blocked || row.reason)}</small></div><div class="target-size"><strong>${row.bytes == null ? escape(row.estimate?.split(',')[0] || tr('未知')) : bytes(row.bytes)}</strong><small>${row.files == null ? tr('仅展示') : ui`${count(row.files)} 个文件${row.directories ? ui` · ${count(row.directories)} 个目录` : ''}`}</small></div>${summaryButton('plan', row.id, state.cleanPlan?.id)}${button('plan-details', tr('查看文件'), { kind: 'secondary', extra: `data-item="${row.id}"` })}</article>`).join('') || tr('<div class="clean-no-results">此范围内没有匹配的项目。</div>')}</div>
    <div class="clean-pagination"><span>${filtered.length ? `${state.cleanOffset + 1}–${Math.min(state.cleanOffset + 40, filtered.length)}` : '0'} / ${filtered.length} 项</span><div>${button('plan-page', tr('上一页'), { kind: 'secondary', disabled: !state.cleanOffset, extra: `data-offset="${Math.max(0, state.cleanOffset - 40)}"` })}${button('plan-page', tr('下一页'), { kind: 'secondary', disabled: state.cleanOffset + 40 >= filtered.length, extra: `data-offset="${state.cleanOffset + 40}"` })}</div></div>
    `}
    </section>`;
}
async function planDetails(id, offset = 0) {
  const result = await api(`clean-plan/items/${id}?offset=${offset}`), row = result.item;
  showDialog(ui`<h2 id="dialog-title">${escape(row.name)}</h2><div class="path-label">${escape(row.path)}</div><p class="clean-detail-note">${escape(row.blocked || row.reason)}。${row.files == null ? tr('此路径只展示，不执行逐项清理。') : ui`包含 ${count(row.files)} 个文件、${count(row.directories)} 个目录，选择此项会处理这些已列入清单的内容。`}</p><div class="clean-detail-meta"><span>${row.bytes == null ? escape(row.estimate) : bytes(row.bytes)}</span><span>${row.selectable ? tr('永久删除 · 不移到废纸篓') : tr('仅展示')}</span></div><div class="file-list plan-detail-files">${result.files.map((file, index) => `<div class="file-row"><span class="file-entry"><strong>${escape(file.path.split('/').pop())}</strong><span title="${escape(file.path)}">${escape(shortPath(file.path))}</span></span><span>${bytes(file.bytes)}</span>${summaryButton('plan-file', id, state.cleanPlan.id, offset + index)}</div>`).join('') || tr('<p class="clean-detail-note">此项没有可展示的普通文件，或无法读取完整清单。</p>')}</div><div class="clean-pagination"><span>${result.total ? `${offset + 1}–${Math.min(offset + 100, result.total)}` : 0} / ${count(result.total)} 个文件</span><div>${offset ? button('plan-details', tr('上一页'), { kind: 'secondary', extra: `data-item="${id}" data-offset="${Math.max(0, offset - 100)}"` }) : ''}${result.hasMore ? button('plan-details', tr('下一页'), { kind: 'secondary', extra: `data-item="${id}" data-offset="${offset + 100}"` }) : ''}</div></div><div class="dialog-actions">${button('close-dialog', tr('关闭'), { kind: 'secondary' })}${row.selectable && planReady() ? button('plan-toggle', state.planSelected.has(id) ? tr('取消选择此项') : tr('选择此项'), { glyph: 'check', extra: `data-item="${id}"` }) : ''}</div>`, true);
}
function reviewSelection() {
  const chosen = planChosen();
  if (!chosen.length || !planReady()) return;
  state.reviewedSelection = { planId: state.cleanPlan.id, ids: chosen.map(row => row.id) };
  showDialog(ui`<div class="dialog-icon orange">${icon('trash', 29)}</div><h2 id="dialog-title">核对这 ${chosen.length} 项清理</h2><p>共 ${count(chosen.reduce((sum, row) => sum + row.files, 0))} 个文件，占用约 ${bytes(chosen.reduce((sum, row) => sum + row.bytes, 0))}。仅处理下方所选范围中已列入清单的文件。变化、正在使用或受保护的项目会跳过。</p><div class="review-files">${chosen.map(row => ui`<div><span><strong>${escape(row.name)}</strong><small class="review-path">${escape(shortPath(row.path))}<br/>${count(row.files)} 个文件 · ${escape(row.category)}</small></span><strong>${bytes(row.bytes)}</strong></div>`).join('')}</div><label class="permanent-clean-ack"><input type="checkbox" id="selection-clean-ack"/>我已核对所选路径，理解永久删除无法撤回</label><div class="dialog-actions">${button('close-dialog', tr('返回检查'), { kind: 'secondary' })}${button('selection-confirm', tr('确认清理所选文件'), { glyph: 'trash', disabled: true })}</div>`, true);
}
const receiptStatus = status => ({ deleted: tr('已删除'), skipped: tr('已保留'), partial: tr('部分删除') }[status] || status);
function selectionReceiptPanel() {
  const receipt = state.cleanup;
  if (receipt?.kind !== 'selection') return '';
  return ui`<section class="panel selection-receipt"><div class="section-header"><div><h2>清理记录 · 知道删了什么</h2><p>${time(receipt.createdAt)} · ${receipt.status === 'cancelled' ? tr('已停止，部分操作可能完成') : ['failed', 'interrupted'].includes(receipt.status) ? ui`未完整结束：${escape(receipt.error)}` : receipt.status === 'running' ? tr('正在处理，结果会继续更新') : tr('所选范围已处理')}</p></div><a class="text-button" href="/api/cleanups/${receipt.jobId}/export" download>导出逐项记录 ${icon('download', 14)}</a></div><div class="receipt-stats"><span><strong>${count(receipt.deletedFiles)}</strong> 个文件已删除</span><span><strong>${count(receipt.skipped)}</strong> 个文件 / 目录已保留</span><span>删除占用估算 <strong>${bytes(receipt.bytes || 0)}</strong></span></div><div class="receipt-items">${receipt.results.map(row => ui`<article><span class="receipt-status ${row.status}">${receiptStatus(row.status)}</span><div><strong>${escape(row.name)}</strong><small>${escape(shortPath(row.path))}</small><small>${count(row.deletedFiles)} 个文件已删除 · ${count(row.skipped)} 个文件 / 目录已保留${row.reason ? ` · ${escape(tr(row.reason))}` : ''}</small></div>${button('receipt-details', tr('文件记录'), { kind: 'secondary', extra: `data-item="${row.id}"` })}</article>`).join('')}</div></section>`;
}
async function receiptDetails(itemId, offset = 0) {
  const result = await api(`cleanups/${state.cleanup.jobId}/records?itemId=${encodeURIComponent(itemId)}&offset=${offset}`);
  showDialog(ui`<h2 id="dialog-title">${escape(state.cleanup.results.find(row => row.id === itemId)?.name || tr('清理记录'))}</h2><div class="read-errors receipt-records">${result.records.map(row => `<article><strong>${escape(row.path)}</strong><span><code class="${row.status}">${receiptStatus(row.status)}</code>${row.type === 'directory' ? tr('目录') : bytes(row.bytes)}${row.reason ? ` · ${escape(tr(row.reason))}` : ''}</span></article>`).join('')}</div><div class="clean-pagination"><span>${offset + 1}–${offset + result.records.length} / ${count(result.total)} 条</span><div>${offset ? button('receipt-details', tr('上一页'), { kind: 'secondary', extra: `data-item="${itemId}" data-offset="${Math.max(0, offset - 100)}"` }) : ''}${result.hasMore ? button('receipt-details', tr('下一页'), { kind: 'secondary', extra: `data-item="${itemId}" data-offset="${offset + 100}"` }) : ''}</div></div><div class="dialog-actions">${button('close-dialog', tr('关闭'))}</div>`, true);
}
function canExecuteClean() {
  const preview = state.cleanPreview;
  return !state.job && preview?.status === 'complete' && preview.exitCode === 0 && preview.output?.trim() && !preview.usedBy && Date.now() - Date.parse(preview.finishedAt) <= 30 * 60_000;
}
function moleCleanerPanel() {
  const preview = state.cleanPreview;
  const busy = !!state.job;
  const running = state.job?.type === 'mole' && state.job.command === 'clean';
  const executing = running && state.job.mode === 'execute';
  const previous = state.cleanup?.kind === 'mole' ? state.cleanup : null;
  const estimate = preview?.output?.match(/Potential space:\s*([^|\r\n]+)\s*\|\s*Items:\s*(\d+)\s*\|\s*Categories:\s*(\d+)/i);
  let message = tr('尚未生成预览');
  if (running) message = executing ? tr('正在清理') : tr('正在生成预览');
  else if (canExecuteClean()) message = tr('预览已完成');
  else if (preview?.usedBy) message = tr('预览已使用，请重新生成');
  else if (preview?.status === 'failed' || preview?.status === 'cancelled') message = tr('预览未完成');
  else if (preview?.status === 'complete' && !preview.output?.trim()) message = tr('预览未返回可审阅内容，请重新生成预览。');
  else if (preview?.finishedAt) message = tr('预览已过期');
  return ui`<section class="panel mole-cleaner"><div class="mole-cleaner-title"><span class="category-icon green">${icon('sparkle', 23)}</span><div><h2>高级：整次 Mole 清理</h2><p>${message}</p></div></div>${canExecuteClean() && estimate ? ui`<div class="mole-estimate"><strong>${escape(estimate[1].trim())}</strong><span>Mole 预估可清理 · ${count(Number(estimate[2]))} 项 · ${count(Number(estimate[3]))} 类</span></div>` : ''}<div class="mole-cleaner-actions">${canExecuteClean() ? button('mole-review-clean', tr('审阅并执行清理'), { glyph: 'trash' }) : ''}${button('mole-prepare-clean', running ? executing ? tr('正在清理…') : tr('正在生成预览…') : preview ? tr('重新生成清理预览') : tr('生成清理预览'), { kind: canExecuteClean() ? 'secondary' : 'primary', glyph: 'sparkle', disabled: busy || !state.mole?.available })}${preview || state.lastMole ? tr('<button class="text-button" data-action="mole-output">查看原始输出 ')+icon('arrow', 15)+'</button>' : ''}</div>${previous ? `<div class="mole-cleaner-receipt">${icon(previous.status === 'complete' ? 'check' : 'help', 15)}${time(previous.createdAt)} · ${previous.status === 'complete' ? tr('Mole 清理命令已执行完成，已处理与跳过的项目见原始输出。') : tr('上次清理未完整结束，部分操作可能已生效，请查看输出。')}</div>` : ''}</section>`;
}
function reviewMoleClean() {
  if (!canExecuteClean()) { toast(tr('请先完成一份新的 Mole 深度清理预览')); return; }
  const preview = state.cleanPreview;
  showDialog(ui`<div class="dialog-icon orange">${icon('trash', 29)}</div><h2 id="dialog-title">确认执行 Mole 深度清理</h2><p>这是整次用户级深度清理。Mole 会重新检查当前状态，并永久删除符合其规则的缓存、日志和残留，可能包含废纸篓中的文件；实际项目可能随文件状态变化。不会请求管理员权限。</p><p>此操作无法通过 Minorminor 撤回。若想指定具体范围，请返回“空间清理”的可视化清单，勾选需要处理的项目。</p><pre class="mole-review-output" aria-label="清理预览输出">${escape(preview.output)}</pre><label class="permanent-clean-ack"><input type="checkbox" id="permanent-clean-ack"/>我已查看预览，理解永久清理不可撤回</label><div class="dialog-actions">${button('close-dialog', tr('返回检查'), { kind: 'secondary' })}${button('mole-confirm-clean', tr('确认永久清理'), { glyph: 'trash', disabled: true })}</div>`, true);
}
function showMoleOutput() {
  const active = state.job?.type === 'mole' ? state.job : state.lastMole;
  if (!active) { toast(tr('还没有 Mole 运行记录')); return; }
  const executing = active.mode === 'execute';
  const status = (executing ? { running: tr('正在清理'), complete: tr('清理命令结束'), failed: tr('清理未完整完成'), cancelled: tr('清理已停止') } : { running: tr('正在预览'), complete: tr('预览完成'), failed: tr('预览未完成'), cancelled: tr('预览已停止') })[active.status] || '';
  showDialog(ui`<h2 id="dialog-title">Mole 原始输出 <small>由内置 Mole 引擎执行</small></h2><section class="terminal-panel"><div class="terminal-top"><span><i></i><i></i><i></i><strong>mo ${escape(active.command)}${executing ? '' : ' --dry-run'}</strong></span><div><span class="terminal-status">${status}</span></div></div><pre class="terminal-output" tabindex="0" aria-label="Mole 命令输出">${active.output ? escape(active.output) : tr('<span class="terminal-welcome">暂无输出</span>')}${active.error ? '\n\n' + escape(active.error) : ''}${active.status !== 'running' ? `\n\n[${status}${active.exitCode != null ? ` · exit ${active.exitCode}` : ''}]` : ''}</pre></section><div class="dialog-actions"><a class="btn secondary" href="https://github.com/tw93/Mole" target="_blank" rel="noreferrer">上游源码 ${icon('external', 14)}</a>${button('close-dialog', tr('关闭'))}</div>`, true);
}
function showDialog(content, wide = false) { dialog.className = wide ? 'wide-dialog' : ''; dialog.innerHTML = ui`<button class="dialog-close icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 21)}</button>${content}`; if (!dialog.open) dialog.showModal(); }
function categoryDialog(id) {
  const category = categories.find(item => item.id === id);
  const result = state.scan?.categories.find(item => item.id === id);
  const items = state.scan?.items.filter(item => item.category === id) || [];
  if (state.scan?.stale) return showDialog(ui`<h2 id="dialog-title">这是清理前的扫描快照</h2><p>请重新扫描后再逐项整理文件。Mole 深度清理只需重新生成清理预览。</p><div class="dialog-actions">${button('close-dialog', tr('知道了'))}</div>`);
  if (state.scan?.complete === false) return showDialog(ui`<h2 id="dialog-title">本次扫描已取消</h2><p>已读到的占用统计会保留。请完成一次扫描，再审阅可以移到废纸篓的文件。</p><div class="dialog-actions">${button('close-dialog', tr('知道了'))}</div>`);
  if (!state.scan) return showDialog(ui`<div class="dialog-icon green">${icon(category.icon, 28)}</div><h2 id="dialog-title">${category.title}</h2><p>先扫描你的 Mac，就能看到这里的真实占用与文件情况。</p><div class="dialog-actions">${button('close-dialog', tr('稍后'), { kind: 'secondary' })}${scanButton()}</div>`);
  if (!items.length) return showDialog(`<div class="dialog-icon ${category.color}">${icon(category.icon, 28)}</div><h2 id="dialog-title">${category.title} <small>${bytes(result?.bytes)}</small></h2><p>${id === 'cache' ? tr('这里统计的是缓存占用。进入可视化清理，生成具体文件清单，再选择需要处理的范围。') : id === 'trash' ? tr('可在访达的废纸篓中检查与还原文件。清空前请确认这些文件已经不再需要。') : tr('当前没有满足时间与类型条件的可选文件。扫描统计包含目录内其他文件，因此总占用可能大于可选文件大小。')}</p><div class="path-label">${escape(result?.path || '')}</div><div class="dialog-actions">${button('close-dialog', tr('知道了'), { kind: 'secondary' })}${id === 'cache' ? button('goto-clean', tr('打开可视化清理'), { glyph: 'arrow' }) : ''}</div>`);
  showDialog(ui`<h2 id="dialog-title">${category.title} <span class="count-badge">${items.length}</span></h2><p>${escape(category.description)}。文件仅移到废纸篓，不会永久删除。</p><label class="select-all"><input type="checkbox" data-select-all="${id}" ${items.every(item => state.selected.has(item.id)) ? 'checked' : ''}/>选择此分类的全部 ${items.length} 个候选文件</label><div class="file-list">${items.map(item => `<label class="file-row"><input type="checkbox" data-select-item="${item.id}" ${state.selected.has(item.id) ? 'checked' : ''}/><span class="file-entry"><strong title="${escape(item.name)}">${escape(item.name)}</strong><span title="${escape(item.path)}">${escape(item.path.replace(state.disk.home, '~'))}</span></span><span>${bytes(item.bytes)}</span></label>`).join('')}</div><div class="dialog-actions"><span id="selected-count">已选择 ${state.selected.size} 个文件</span>${button('close-dialog', tr('完成选择'), { glyph: 'check' })}</div>`, true);
}
function review() {
  const selected = state.scan?.items.filter(item => state.selected.has(item.id)) || [];
  if (!selected.length) return;
  showDialog(ui`<div class="dialog-icon orange">${icon('trash', 29)}</div><h2 id="dialog-title">将 ${selected.length} 个文件移到废纸篓？</h2><p>合计 ${bytes(selected.reduce((sum, item) => sum + item.bytes, 0))}。请确认这些文件不再需要；之后可在访达的废纸篓中手动还原。</p><div class="review-files">${selected.map(item => `<div><span title="${escape(item.path)}">${escape(item.name)}</span><strong>${bytes(item.bytes)}</strong></div>`).join('')}</div><div class="notice compact">${icon('help', 16)}<p>移到废纸篓不会立即释放磁盘空间。</p></div><div class="dialog-actions">${button('close-dialog', tr('返回检查'), { kind: 'secondary' })}${button('confirm-clean', tr('确认移到废纸篓'), { glyph: 'trash' })}</div>`, true);
}
async function errorsDialog(jobId, offset = 0, phase = '') {
  const result = await api(`jobs/${encodeURIComponent(jobId)}/errors?offset=${offset}${phase ? `&phase=${encodeURIComponent(phase)}` : ''}`);
  showDialog(ui`<h2 id="dialog-title">未读取的项目 <span class="count-badge">${count(result.total)}</span></h2><p>没有数量或时长截断。以下为系统拒绝访问、文件发生变化或其他读取错误，不能将这些路径的占用当作 0。</p><div class="read-errors">${result.errors.map(item => `<article><strong title="${escape(item.path)}">${escape(item.path)}</strong><span><code>${escape(item.code)}</code>${escape(tr(item.reason))}</span></article>`).join('') || tr('<p>暂时没有读取失败记录。</p>')}</div><div class="dialog-actions">${offset ? button('errors', tr('上一页'), { kind: 'secondary', extra: `data-job="${escape(jobId)}" data-phase="${escape(phase)}" data-offset="${Math.max(0, offset - 100)}"` }) : ''}${result.hasMore ? button('errors', tr('下一页'), { kind: 'secondary', extra: `data-job="${escape(jobId)}" data-phase="${escape(phase)}" data-offset="${offset + result.errors.length}"` }) : ''}${button('close-dialog', tr('关闭'))}</div>`, true);
}
async function startJob(endpoint, body = {}) {
  if (state.job) return;
  dialog.close();
  if (['scan', 'analyze', 'ai/scan', 'ai/projects', 'ai/projects/storage'].includes(endpoint)) { endpoint = 'sync'; body = {}; }
  state.job = { type: ({ 'clean-plan': 'plan', 'ai/projects/plan': 'project-plan', 'ai/projects/execute': 'project-trash', 'ai/review': 'ai-review', 'ai/harnesses/analyze': 'harness-analysis', 'ai/summaries': 'ai-summary', 'ai/ollama/delete': 'model-clean' })[endpoint] || endpoint, mode: endpoint === 'mole' ? 'preview' : undefined, command: body.command, status: 'running', message: tr('正在准备…'), progress: 0 };
  render();
  try {
    const result = await api(endpoint, endpoint === 'mole' ? body : { ...body, scope: state.scope });
    Object.assign(state.job, { id: result.id });
    render();
    pollJob(result.id, ++pollGeneration);
  } catch (error) { state.job = null; render(); if (error.status === 409) await bootstrap(); throw error; }
}
function invalidateFileView(storageId) {
  if (state.ai?.projectStorage?.id === storageId) return;
  fileBrowseGeneration++; clearTimeout(folderPollTimer); fileExplorer = null;
  expandedFiles.clear(); fileContents.clear(); state.projectSelected.clear(); associationGeneration++; associationView = { ...associationView, storageId: null, result: null, loading: false };
}
async function pollJob(id, generation) {
  if (generation !== pollGeneration) return;
  try {
    const result = await api(`jobs/${id}`);
    if (generation !== pollGeneration) return;
    if (result.type === 'mole') { state.lastMole = result; if (result.command === 'clean' && result.mode === 'preview') state.cleanPreview = result; }
    else if (['sync', 'scan', 'analyze'].includes(result.type)) state.lastInventoryJob = result;
    if (result.status === 'running') { state.job = result; render(); setTimeout(() => pollJob(id, generation), 900); return; }
    state.job = null;
    const latest = await api('bootstrap');
    if (generation !== pollGeneration) return;
    if (state.cleanPlan?.id !== latest.cleanPlan?.id) state.planSelected.clear();
    if (state.ai?.projectPlan?.id !== latest.ai?.projectPlan?.id) state.projectPlanSelected.clear();
    invalidateFileView(latest.ai?.projectStorage?.id);
    Object.assign(state, { token: latest.token, disk: latest.disk, scan: latest.scan, analysis: latest.analysis, cleanup: latest.cleanup, cleanPlan: latest.cleanPlan, ai: latest.ai, error: null });
    state.cleanPreview = [...latest.jobs].reverse().find(item => item.type === 'mole' && item.mode === 'preview' && item.command === 'clean') || null;
    if (result.type !== 'mole') state.selected.clear();
    if (result.status === 'complete') {
      if (result.type === 'sync') toast(tr('扫描完成，所有页面已更新'));
      if (result.type === 'scan') toast(ui`完整扫描结束，读取 ${count(latest.scan.count)} 个文件`);
      if (result.type === 'analyze') toast(tr('完整磁盘分析结束'));
      if (result.type === 'mole') toast(result.mode === 'execute' ? tr('Mole 清理命令已执行完成，请查看清理结果') : tr('Mole 预览完成，可以审阅清理内容'));
      if (result.type === 'plan') toast(tr('具体文件清单已生成，可以逐项选择'));
      if (result.type === 'ai-scan') toast(tr('AI 专项扫描完成，模型和会话已分别列出'));
      if (result.type === 'project-analysis') toast(tr('项目归类完成，可查看各项目的会话、记忆与目录说明'));
      if (result.type === 'project-storage') toast(tr('各项目的占用明细已更新'));
      if (result.type === 'project-plan') toast(tr('项目预览已生成，请查看文件后勾选要整理的类别'));
      if (result.type === 'project-trash') { state.projectPlanSelected.clear(); toast(tr('项目整理结束，请核对逐文件去向')); }
      if (result.type === 'ai-review') toast(tr('模型判读完成；不会自动勾选或执行删除'));
      if (result.type === 'model-clean') toast(tr('Ollama 模型操作完成，请查看结果'));
      if (result.type === 'selection') { state.planSelected.clear(); toast(ui`已删除 ${count(latest.cleanup.deletedFiles)} 个文件，逐项结果已保存`); }
    } else toast(result.error || ui`任务${result.status === 'cancelled' ? tr('已停止') : tr('未完成')}，请查看输出`);
    render(); ensureAssociationView();
    if (result.status === 'complete' && result.type === 'ai-summary' && result.result) { summaryResults.set(result.result.key, result.result); while (summaryResults.size > 100) summaryResults.delete(summaryResults.keys().next().value); render(); showSummary(result.result); }
    if (result.status === 'complete' && result.type === 'project-plan') document.querySelector('#project-clean-preview')?.scrollIntoView({ block: 'start' });
    if (result.status === 'complete' && result.type === 'mole' && result.command === 'clean' && result.mode === 'preview') await startJob('clean-plan', { previewId: result.id });
  } catch (error) { state.job = null; state.error = tr('与本地服务的连接中断。重新连接后可继续查看任务。'); render(); toast(tr(error.message)); }
}
async function bootstrap() {
  const generation = ++pollGeneration;
  try {
    const data = await api('bootstrap');
    invalidateFileView(data.ai?.projectStorage?.id);
    if (state.cleanPlan?.id !== data.cleanPlan?.id) state.planSelected.clear();
    if (state.ai?.projectPlan?.id !== data.ai?.projectPlan?.id) state.projectPlanSelected.clear();
    Object.assign(state, { token: data.token, disk: data.disk, mole: data.mole, scan: data.scan, analysis: data.analysis, cleanup: data.cleanup, cleanPlan: data.cleanPlan, ai: data.ai, scopes: data.scopes, error: null });
    for (const job of data.jobs.filter(row => row.type === 'ai-summary' && row.result)) summaryResults.set(job.result.key, job.result);
    const running = data.jobs.find(item => item.status === 'running');
    state.lastMole = [...data.jobs].reverse().find(item => item.type === 'mole') || null;
    state.cleanPreview = [...data.jobs].reverse().find(item => item.type === 'mole' && item.mode === 'preview' && item.command === 'clean') || null;
    state.lastInventoryJob = [...data.jobs].reverse().find(item => ['sync', 'scan', 'analyze'].includes(item.type)) || null;
    state.job = running || null;
    state.scope = running?.scope?.id || data.scan?.scope?.id || state.scope;
    render();
    ensureAssociationView();
    if (running) pollJob(running.id, generation);
  } catch (error) { state.error = ui`无法连接本地服务：${error.message}`; render(); }
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  try {
    if (action === 'ai-summarize') { event.preventDefault(); await prepareSummary(target); }
    else if (action === 'ai-summary-confirm') { const prepared = state.pendingSummary; if (prepared) { state.pendingSummary = null; await startJob('ai/summaries', { previewId: prepared.id, configRevision: prepared.configRevision, confirmation: 'SUMMARIZE_SELECTED_RESOURCE' }); } }
    else if (action === 'ai-nav-toggle') { state.aiExpanded = !state.aiExpanded; render(); }
    else if (action === 'association-details') { associationView = { ...associationView, projectId: target.dataset.project || '', status: target.dataset.status || '', query: '', offset: 0, result: null }; if (state.route === 'ai-diagnostics') await loadAssociations(); else navigate('ai-diagnostics'); }
    else if (action === 'association-filter') { associationView.status = target.dataset.status || ''; associationView.offset = 0; await loadAssociations(); }
    else if (action === 'association-page') { associationView.offset = Number(target.dataset.offset || 0); await loadAssociations(); }
    else if (action === 'scan') await startJob('scan');
    else if (action === 'ai-scan') await startJob('ai/scan');
    else if (action === 'project-storage') await startJob('ai/projects/storage', { reportId: state.ai.projects.id });
    else if (action === 'project-show-plan') document.querySelector('#project-clean-preview')?.scrollIntoView({ block: 'start' });
    else if (action === 'project-build-plan') await startJob('ai/projects/plan', { storageId: state.ai.projectStorage.id, projectIds: [...state.projectSelected], categories: [...state.projectCategories], allowPersonal: state.projectPersonal });
    else if (action === 'project-storage-files') await projectStorageFiles(target.dataset.project, target.dataset.kind, Number(target.dataset.offset || 0));
    else if (action === 'file-root') { const group = state.ai.projects.groups.find(row => row.id === target.dataset.project); const kind = group.type === 'project' && group.exists ? 'tree' : ['session', 'memory', 'cache', 'log'].find(key => projectStat(group)?.categories[key]?.files) || 'session'; await loadProjectFiles({ projectId: group.id, kind, directoryId: null, offset: 0, query: '' }); }
    else if (action === 'file-close') { fileBrowseGeneration++; clearTimeout(folderPollTimer); fileExplorer = null; render(); }
    else if (action === 'file-mode') await loadProjectFiles({ kind: target.dataset.kind, directoryId: null, offset: 0, query: '' });
    else if (action === 'file-directory') await loadProjectFiles({ directoryId: target.dataset.file, offset: 0, query: '' });
    else if (action === 'file-page') await loadProjectFiles({ offset: Number(target.dataset.offset) });
    else if (action === 'file-refresh') await loadProjectFiles();
    else if (action === 'folder-scan-refresh') await controlDirectorySizes('refresh');
    else if (action === 'folder-scan-cancel') await controlDirectorySizes('cancel');
    else if (action === 'file-inspect') await inspectProjectFile(target.dataset.file);
    else if (action === 'file-nested-project') { const group = state.ai.projects.groups.find(row => row.id === target.dataset.project); state.projectQuery = group.path; state.projectType = ''; state.projectOffset = 0; await loadProjectFiles({ projectId: group.id, kind: 'tree', directoryId: null, offset: 0, query: '' }); }
    else if (action === 'project-plan-files') await projectPlanFiles(target.dataset.group, Number(target.dataset.offset || 0), target.dataset.retained === 'true');
    else if (action === 'project-review-trash') reviewProjectTrash();
    else if (action === 'project-confirm-trash') await confirmProjectTrash();
    else if (action === 'project-receipt') await projectReceiptDetails(Number(target.dataset.offset || 0));
    else if (action === 'project-storage-other') projectProtectedDialog(target.dataset.project);
    else if (action === 'project-storage-shared') projectSharedDialog();
    else if (action === 'project-analyze') await startJob('ai/projects', { snapshotId: state.ai.scan.id });
    else if (action === 'project-details') await projectDialog(target.dataset.project, Number(target.dataset.offset || 0));
    else if (action === 'project-page') { state.projectOffset = Number(target.dataset.offset); render(); document.querySelector('.project-controls')?.scrollIntoView({ block: 'start' }); }
    else if (action === 'project-scope') await projectScopeDialog(target.dataset.scope);
    else if (action === 'project-sources') projectSourcesDialog();
    else if (action === 'ai-config') aiConfigDialog();
    else if (action === 'harness-analyze') await startJob('ai/harnesses/analyze', { snapshotId: target.dataset.snapshot });
    else if (action === 'agent-evidence') agentEvidenceDialog(target.dataset.tool);
    else if (action === 'agent-scopes') { state.aiToolFilter = target.dataset.tool; state.aiKindFilter = ''; state.aiQuery = ''; state.aiOffset = 0; if (state.route === 'ai-storage') render(); else navigate('ai-storage'); }
    else if (action === 'inventory-page') { state.aiOffset = Number(target.dataset.offset); render(); document.querySelector('.inventory-controls')?.scrollIntoView({ block: 'start' }); }
    else if (action === 'inventory-plan-items') inventoryPlanDialog(target.dataset.scope);
    else if (action === 'ai-judge') await previewAdvice(Number(target.dataset.offset || 0), target.dataset.source);
    else if (action === 'ai-confirm-judge') {
      if (!dialog.querySelector('#ai-metadata-ack')?.checked || !state.pendingAdvice) return;
      await startJob('ai/review', { ...state.pendingAdvice, confirmation: 'SEND_METADATA_FOR_ADVICE' });
    }
    else if (action === 'ai-detect') {
      target.disabled = true;
      try {
        const result = await api('ai/detect-ollama', {}), form = document.querySelector('#ai-config-form');
        if (!form) return;
        document.querySelector('#ai-detection-result').textContent = result.available ? result.models.length ? ui`发现 ${result.models.length} 个本机模型；可从模型名称输入框选择。` : tr('Ollama 正在运行，目前没有已安装模型。') : result.reason;
        document.querySelector('#local-ai-models').innerHTML = result.models.map(model => `<option value="${escape(model.name)}"></option>`).join('');
        if (result.available && result.models.length && form.elements.provider.value === 'ollama' && !form.elements.model.value) form.elements.model.value = result.models[0].name;
      } finally { target.disabled = false; }
    }
    else if (action === 'model-review') reviewModel(target.dataset.model);
    else if (action === 'ai-confirm-model') {
      if (!dialog.querySelector('#ai-model-ack')?.checked) return;
      await startJob('ai/ollama/delete', { scanId: state.ai.scan.id, modelId: target.dataset.model, confirmation: 'DELETE_OLLAMA_MODEL' });
    }
    else if (action === 'analyze') await startJob('analyze');
    else if (action === 'mole-prepare-clean') await startJob('mole', { command: 'clean' });
    else if (action === 'mole-output') showMoleOutput();
    else if (action === 'plan-prepare') await startJob('clean-plan', { previewId: state.cleanPreview.id });
    else if (action === 'plan-filter') { state.cleanFilter = target.dataset.category; state.cleanOffset = 0; render(); }
    else if (action === 'plan-page') { state.cleanOffset = Number(target.dataset.offset); render(); document.querySelector('.clean-list-toolbar')?.scrollIntoView({ block: 'start' }); }
    else if (action === 'plan-details') await planDetails(target.dataset.item, Number(target.dataset.offset || 0));
    else if (action === 'plan-toggle') { if (planReady()) { if (state.planSelected.has(target.dataset.item)) state.planSelected.delete(target.dataset.item); else state.planSelected.add(target.dataset.item); dialog.close(); render(); } }
    else if (action === 'plan-review') reviewSelection();
    else if (action === 'selection-confirm') {
      if (!dialog.querySelector('#selection-clean-ack')?.checked || !planReady()) return;
      target.disabled = true;
      if (state.reviewedSelection?.planId !== state.cleanPlan.id) return;
      const result = await api('clean-plan/execute', { ...state.reviewedSelection, confirmation: 'DELETE_SELECTED_FILES' });
      state.cleanPlan.usedBy = result.id; state.cleanPreview.usedBy = result.id;
      dialog.close(); state.job = { id: result.id, type: 'selection', status: 'running', message: tr('正在按勾选清单逐项清理…') };
      render(); pollJob(result.id, ++pollGeneration);
    }
    else if (action === 'receipt-details') await receiptDetails(target.dataset.item, Number(target.dataset.offset || 0));
    else if (action === 'mole-review-clean') reviewMoleClean();
    else if (action === 'mole-confirm-clean') {
      if (!dialog.querySelector('#permanent-clean-ack')?.checked || !canExecuteClean()) return;
      target.disabled = true;
      const result = await api('mole/execute-clean', { previewId: state.cleanPreview.id, confirmation: 'PERMANENT_MOLE_CLEAN' });
      state.cleanPreview.usedBy = result.id;
      dialog.close();
      if (state.scan) state.scan.stale = true;
      state.job = { id: result.id, type: 'mole', command: 'clean', mode: 'execute', status: 'running', message: tr('正在执行 Mole 原生清理…') };
      state.lastMole = state.job;
      render();
      pollJob(result.id, ++pollGeneration);
    }
    else if (action === 'cancel' && state.job) { await api('cancel', { id: state.job.id }); state.job.cancelling = true; render(); toast(tr('正在停止后台任务…')); }
    else if (action === 'errors') await errorsDialog(target.dataset.job, Number(target.dataset.offset || 0), target.dataset.phase);
    else if (action === 'category') categoryDialog(target.dataset.category);
    else if (action === 'close-dialog') { dialog.close(); render(); }
    else if (action === 'goto-clean') { dialog.close(); navigate('clean'); }
    else if (action === 'review') review();
    else if (action === 'confirm-clean') {
      target.disabled = true; target.textContent = tr('正在移到废纸篓…');
      const result = await api('cleanup', { ids: [...state.selected], scanId: state.scan.id, confirmation: 'MOVE_TO_TRASH' });
      state.cleanup = result; state.selected.clear(); dialog.close();
      toast(ui`已移到废纸篓 ${result.moved} 个文件${result.results.length > result.moved ? ui`，${result.results.length - result.moved} 个文件已跳过` : ''}`);
      if (result.results.some(item => item.status === 'skipped') || result.warning) showDialog(ui`<h2 id="dialog-title">整理结果</h2><p>${result.moved} 个文件已移到废纸篓。${escape(result.warning || '')}</p><div class="review-files">${result.results.map(item => `<div><span>${escape(item.name)}</span><span>${item.status === 'moved' ? tr('已移到废纸篓') : escape(item.error)}</span></div>`).join('')}</div><div class="dialog-actions">${button('close-dialog', tr('知道了'))}</div>`, true);
      state.scan = null; render();
    }
    else if (action === 'retry') await bootstrap();
    else if (action === 'settings') showDialog(ui`<div class="dialog-icon green"><img src="/icon.svg" width="44" height="44" alt=""/></div><h2 id="dialog-title">Minorminor <small>v0.1.0</small></h2><dl class="about-list"><div><dt>Mole 版本</dt><dd>${escape(state.mole?.version || tr('未就绪'))}</dd></div><div><dt>上游许可证</dt><dd>GPL-3.0</dd></div><div><dt>AI 状态</dt><dd>${state.ai?.config?.configured ? escape(state.ai.config.model) + tr(' · 已配置') : tr('模型尚未配置')}</dd></div><div><dt>运行方式</dt><dd>本地 Node.js 服务</dd></div></dl><div class="dialog-actions">${button('ai-config', tr('模型连接'), { kind: 'secondary' })}<a href="https://github.com/tw93/Mole" target="_blank" rel="noreferrer" class="btn secondary">上游源码 ${icon('external', 14)}</a>${button('close-dialog', tr('完成'))}</div>`);
  } catch (error) { toast(tr(error.message)); if (action === 'confirm-clean') { target.disabled = false; target.innerHTML = ui`${icon('trash', 17)}确认移到废纸篓`; } if (['mole-confirm-clean', 'selection-confirm'].includes(action)) target.disabled = false; }
});
document.addEventListener('toggle', event => {
  const node = event.target;
  if (node.isConnected && node.matches?.('.file-entry[data-file]')) node.open ? expandedFiles.add(node.dataset.file) : expandedFiles.delete(node.dataset.file);
}, true);
document.addEventListener('submit', async event => {
  if (event.target.id === 'association-search') { event.preventDefault(); const fields = new FormData(event.target); associationView.projectId = fields.get('project'); associationView.query = fields.get('query'); associationView.offset = 0; await loadAssociations(); return; }
  if (event.target.id === 'project-file-search') { event.preventDefault(); const form = new FormData(event.target); await loadProjectFiles({ query: form.get('query'), sort: form.get('sort'), offset: 0 }); return; }
  if (event.target.id !== 'ai-config-form') return;
  event.preventDefault();
  const form = event.target, submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const fields = new FormData(form);
    const config = await api('ai/config', { provider: fields.get('provider'), baseUrl: fields.get('baseUrl'), model: fields.get('model'), apiKey: fields.get('apiKey'), clearKey: fields.has('clearKey'), harnessAnalysis: fields.has('harnessAnalysis') });
    state.ai ||= {}; state.ai.config = config; state.ai.advice = null;
    form.elements.apiKey.value = ''; dialog.close(); render(); toast(tr('模型连接已配置；调用成功后会显示实际判读结果'));
  } catch (error) { toast(tr(error.message)); submit.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id === 'project-search') { const position = event.target.selectionStart; state.projectQuery = event.target.value; state.projectOffset = 0; render(); const input = document.querySelector('#project-search'); input?.focus(); if (input && position != null) input.setSelectionRange(position, position); return; }
  if (event.target.id === 'inventory-search') { const position = event.target.selectionStart; state.aiQuery = event.target.value; state.aiOffset = 0; render(); const input = document.querySelector('#inventory-search'); input?.focus(); if (input && position != null) input.setSelectionRange(position, position); return; }
  if (!event.target.classList.contains('clean-search')) return;
  const position = event.target.selectionStart;
  state.cleanQuery = event.target.value; state.cleanOffset = 0; render();
  const input = document.querySelector('.clean-search'); input?.focus();
  if (input && position != null) { try { input.setSelectionRange(position, position); } catch {} }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('.project-pick')) { target.checked ? state.projectSelected.add(target.dataset.project) : state.projectSelected.delete(target.dataset.project); state.projectPlanSelected.clear(); render(); return; }
  if (target.matches('.project-plan-pick')) { target.checked ? state.projectPlanSelected.add(target.dataset.group) : state.projectPlanSelected.delete(target.dataset.group); render(); return; }
  if (target.id === 'project-personal') { state.projectPlanSelected.clear(); state.projectPersonal = target.checked; if (!target.checked) { state.projectCategories.delete('session'); state.projectCategories.delete('memory'); } render(); return; }
  if (target.matches('.project-category-pick')) { target.checked ? state.projectCategories.add(target.value) : state.projectCategories.delete(target.value); state.projectPlanSelected.clear(); render(); return; }
  if (['project-trash-ack', 'project-personal-ack'].includes(target.id)) { const confirm = dialog.querySelector('[data-action="project-confirm-trash"]'); if (confirm) confirm.disabled = !dialog.querySelector('#project-trash-ack')?.checked || (dialog.querySelector('#project-personal-ack') && !dialog.querySelector('#project-personal-ack').checked); return; }
  if (target.id === 'project-sort') { state.projectSort = target.value; state.projectOffset = 0; render(); return; }
  if (target.id === 'project-type') { state.projectType = target.value; state.projectOffset = 0; render(); return; }
  if (target.id === 'inventory-tool' || target.id === 'inventory-kind') { state[target.id === 'inventory-tool' ? 'aiToolFilter' : 'aiKindFilter'] = target.value; state.aiOffset = 0; render(); return; }
  if (target.id === 'advice-source') { state.adviceSource = target.value; render(); return; }
  if (target.name === 'provider' && target.closest('#ai-config-form')) {
    const form = target.form; form.elements.baseUrl.value = target.value === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.deepseek.com/v1';
    form.elements.model.value = target.value === 'ollama' ? '' : 'deepseek-flash'; form.elements.apiKey.value = ''; return;
  }
  if (target.id === 'ai-metadata-ack') { dialog.querySelector('[data-action="ai-confirm-judge"]').disabled = !target.checked; return; }
  if (target.id === 'ai-model-ack') { dialog.querySelector('[data-action="ai-confirm-model"]').disabled = !target.checked; return; }
  if (target.id === 'permanent-clean-ack') { dialog.querySelector('[data-action="mole-confirm-clean"]').disabled = !target.checked; return; }
  if (target.id === 'selection-clean-ack') { dialog.querySelector('[data-action="selection-confirm"]').disabled = !target.checked; return; }
  if (target.hasAttribute('data-plan-all')) { if (!planReady()) return; for (const row of filteredPlanRows().filter(row => row.selectable)) { if (target.checked) state.planSelected.add(row.id); else state.planSelected.delete(row.id); } render(); return; }
  if (target.dataset.planItem) { if (!planReady()) return; if (target.checked) state.planSelected.add(target.dataset.planItem); else state.planSelected.delete(target.dataset.planItem); render(); return; }
  if (target.classList.contains('scope-select')) { state.scope = target.value; render(); return; }
  if (target.dataset.selectItem) {
    if (target.checked) state.selected.add(target.dataset.selectItem); else state.selected.delete(target.dataset.selectItem);
    const all = dialog.querySelector('[data-select-all]');
    if (all) { const items = state.scan.items.filter(item => item.category === all.dataset.selectAll); all.checked = items.every(item => state.selected.has(item.id)); all.indeterminate = !all.checked && items.some(item => state.selected.has(item.id)); }
  } else if (target.dataset.selectAll) {
    for (const item of state.scan.items.filter(item => item.category === target.dataset.selectAll)) { if (target.checked) state.selected.add(item.id); else state.selected.delete(item.id); }
    dialog.querySelectorAll('[data-select-item]').forEach(input => { input.checked = state.selected.has(input.dataset.selectItem); });
  }
  const counter = document.querySelector('#selected-count'); if (counter) counter.textContent = ui`已选择 ${state.selected.size} 个文件`;
});
dialog.addEventListener('cancel', () => render());
dialog.addEventListener('click', event => { if (event.target === dialog && (event.offsetX < 0 || event.offsetX > dialog.clientWidth || event.offsetY < 0 || event.offsetY > dialog.clientHeight)) { dialog.close(); render(); } });
await bootstrap();
