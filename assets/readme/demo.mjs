import { mkdir, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../../server.mjs';

const root = await realpath(await mkdtemp('/tmp/minorminor-readme-'));
const home = path.join(root, 'Home');
const put = async (name, value) => {
  const filename = path.join(home, name);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, value);
};
for (const [index, [name, description]] of [['Atlas', '资料检索与知识库'], ['Paper', '轻量写作工作台'], ['Notes', '个人笔记项目']].entries()) {
  const base = `Projects/${name}`;
  const project = path.join(home, base);
  await put(`${base}/package.json`, JSON.stringify({ name: name.toLowerCase(), version: '0.1.0', description }));
  await put(`${base}/README.md`, `# ${name}\n\n${description}。\n`);
  await put(`${base}/src/index.js`, `export const project = '${name}';\n`);
  await put(`${base}/.cache/build/cache.bin`, Buffer.alloc((8 - index * 2) * 1024 * 1024, 97 + index));
  await put(`${base}/logs/development.log`, '[INFO] Sample development server started\n'.repeat((3 - index) * 4000));
  const encoded = project.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-/, '');
  await put(`.claude/projects/${encoded}/sample.jsonl`, JSON.stringify({ type: 'user', cwd: project, message: { content: `整理 ${name} 的项目结构` } }) + '\n');
  await put(`.claude/projects/${encoded}/memory/overview.md`, `# ${name} 项目约定\n\n文档、源代码和生成缓存分开存放。\n`);
}
const blocked = () => { throw new Error('README 示例仅用于展示，不运行清理或外部模型。'); };
const server = createApp({ home, runtimeDirectory: path.join(root, 'runtime'), previewRunner: blocked, cleanupRunner: blocked, selectionGuard: blocked, personalFileGuard: blocked, aiFetch: async () => Response.json({ models: [] }) });
await new Promise(resolve => server.listen(4785, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:4785';
const boot = await (await fetch(url + '/api/bootstrap')).json();
const response = await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': boot.token }, body: JSON.stringify({ scope: 'home' }) });
if (response.status !== 202) throw new Error('Demo scan could not start');
const { id } = await response.json();
for (let index = 0; index < 1200; index++) {
  const job = await (await fetch(url + '/api/jobs/' + id)).json();
  if (job.status === 'complete') break;
  if (['failed', 'cancelled'].includes(job.status)) throw new Error(job.error || 'Demo scan failed');
  if (index === 1199) throw new Error('Demo scan timed out');
  await delay(50);
}
const data = await (await fetch(url + '/api/bootstrap')).json();
console.log(JSON.stringify({ url, root, projects: data.ai.projects.groups.map(row => row.name) }));
const close = () => { server.closeAllConnections(); server.close(async () => { await rm(root, { recursive: true, force: true }); process.exit(); }); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
