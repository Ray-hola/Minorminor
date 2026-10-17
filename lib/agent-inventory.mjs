import path from 'node:path';
import { PLAN_TTL } from './clean-plan.mjs';

const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
export const categoryLabels = { cache: '可重建缓存', log: '运行与诊断日志', session: '会话（结构推断）', memory: '记忆（目录推断）', state: '会话 / 配置 / 数据', model: '模型 / 数据集', installation: '安装文件 / 内嵌组件', project: '项目资源 / 配置' };

export function agentInventory(snapshot, plan, now = Date.now(), currentPreviewId = plan?.previewId) {
  if (!snapshot) return null;
  const fresh = !!plan && plan.previewId === currentPreviewId && !plan.usedBy && now - Date.parse(plan.createdAt) <= PLAN_TTL && !snapshot.stale;
  const planRows = fresh ? plan.items.filter(row => row.selectable && !row.blocked && !row.coveredBy) : [];
  const rows = snapshot.items.map(item => {
    const category = item.installation || item.installedComponent ? 'installation' : item.aiCategory || item.aiKind;
    const transient = ['cache', 'log'].includes(category) && item.aiKind === 'cache' && item.storageType !== 'virtual-machine';
    const candidates = transient && !item.skipped ? planRows.filter(row => inside(row.path, item.path)) : [];
    const status = item.skipped ? 'unreadable' : !transient ? 'protected' : candidates.length ? 'ready' : fresh ? 'candidate' : 'needs-preview';
    const policy = status === 'unreadable' ? '读取不完整，保留；查看未读取项目' : status === 'protected' ? item.reason : status === 'ready' ? '已有可审阅的具体文件清单；退出所属工具后仍需通过执行前检查' : status === 'candidate' ? '缓存 / 日志候选；Mole 当前清单未授权此路径，仅列出，不执行删除' : '缓存 / 日志候选；先生成新的 Mole 文件清单，再核对可清理部分';
    return { ...item, category, categoryLabel: item.storageType === 'virtual-machine' ? '虚拟机运行环境' : (categoryLabels[category] || categoryLabels.state) + (item.discoveryMode === 'generic' && !['session', 'memory'].includes(category) ? '（推断）' : ''), status, policy, cleanableBytes: candidates.reduce((sum, row) => sum + (row.bytes || 0), 0), planItems: candidates.map(row => ({ id: row.id, path: row.path, bytes: row.bytes, files: row.files })) };
  }).sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const names = new Set([...rows.map(row => row.aiTool), ...(snapshot.discovery?.agents || []).filter(agent => agent.status !== 'not-found').map(agent => agent.name)]);
  const tools = [...names].map(name => {
    const scopes = rows.filter(row => row.aiTool === name), metadata = snapshot.discovery?.agents.find(agent => agent.name === name);
    const amount = category => scopes.filter(row => row.category === category).reduce((sum, row) => sum + row.bytes, 0);
    return { name, status: metadata?.status || 'data-found', scopes: scopes.length, bytes: scopes.reduce((sum, row) => sum + row.bytes, 0), cacheBytes: amount('cache'), logBytes: amount('log'), protectedBytes: scopes.filter(row => !['cache', 'log'].includes(row.category)).reduce((sum, row) => sum + row.bytes, 0), components: metadata?.components?.length || 0 };
  }).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  // A plan item can appear underneath multiple inventory views; deduplicate the
  // actionable total instead of summing ancestor/child views twice.
  const ready = new Map(rows.flatMap(row => row.planItems).map(row => [row.id, row]));
  return { snapshotId: snapshot.id, createdAt: snapshot.createdAt, generatedAt: new Date(now).toISOString(), planId: fresh ? plan.id : null, planExpiresAt: fresh ? new Date(Date.parse(plan.createdAt) + PLAN_TTL).toISOString() : null, planFresh: fresh, complete: snapshot.complete, errorCount: snapshot.errorCount, tools, rows, cacheBytes: rows.filter(row => row.category === 'cache').reduce((sum, row) => sum + row.bytes, 0), logBytes: rows.filter(row => row.category === 'log').reduce((sum, row) => sum + row.bytes, 0), readyItems: ready.size, readyBytes: [...ready.values()].reduce((sum, row) => sum + (row.bytes || 0), 0) };
}

export function inventoryCsv(inventory) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const statuses = { ready: '已有文件清单，需确认', candidate: '候选，当前未授权', 'needs-preview': '候选，待生成预览', protected: '保留', unreadable: '读取不完整，保留' };
  const data = [['工具', '类别', '完整路径', '分配字节', '文件数', '状态', '可审阅字节', '说明', '识别依据', '导出时间', '清理清单到期时间'], ...inventory.rows.map(row => [row.aiTool, row.categoryLabel, row.path, row.bytes, row.files, statuses[row.status], row.cleanableBytes, row.policy, (row.evidence || []).map(proof => `${proof.detail} (${proof.path})`).join('；'), inventory.generatedAt, inventory.planExpiresAt || '无当前授权清单'])];
  return '\uFEFF' + data.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
