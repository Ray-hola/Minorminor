import { spawn } from 'node:child_process';

// File Provider directory reads can block inside the kernel. A separate process
// keeps that wait out of the server's shared filesystem thread pool.
const reader = `
import { opendirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
const target = process.argv[1];
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
try {
  if (realpathSync(target) !== target) throw Object.assign(new Error('目录已被符号链接替换'), {code:'SYMLINK_ROOT'});
  const directory = opendirSync(target);
  try {
    let entry;
    while ((entry = directory.readSync())) {
      const filename = path.join(target, entry.name);
      try {
        const s = lstatSync(filename);
        emit({ name: entry.name, info: { dev:s.dev, ino:s.ino, size:s.size, blocks:s.blocks, nlink:s.nlink, mode:s.mode, mtimeMs:s.mtimeMs, ctimeMs:s.ctimeMs, file:s.isFile(), directory:s.isDirectory(), link:s.isSymbolicLink() } });
      } catch (error) { emit({ error: {path:filename, code:error.code || 'EIO', message:error.message} }); }
    }
  } finally { directory.closeSync(); }
} catch (error) { emit({ error: {path:target, code:error.code || 'EIO', message:error.message} }); }
`;

export const isCloudDirectory = filename => /\/Library\/(?:Mobile Documents|CloudStorage)(?:\/|$)/.test(filename);

export function readCloudDirectory(directory, { cancelled = () => false, timeoutMs = 10_000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, ['--input-type=module', '-e', reader, directory], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pending = '', finished = false, timer;
    const rows = [];
    function finish(error) {
      if (finished) return; finished = true; clearTimeout(timer); clearInterval(cancellation);
      child.stdout.destroy();
      if (error) { child.kill('SIGKILL'); child.unref(); reject(Object.assign(error, { entries: rows })); }
      else resolve(rows);
    }
    function arm() { clearTimeout(timer); timer = setTimeout(() => finish(Object.assign(new Error('云端目录读取长时间无响应'), { code: 'ETIMEDOUT' })), timeoutMs); }
    const cancellation = setInterval(() => { if (cancelled()) finish(Object.assign(new Error('扫描已停止'), { code: 'ABORT_ERR' })); }, 100);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (finished) return; arm(); pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { rows.push(JSON.parse(line)); } catch { finish(new Error('云端目录返回了无效数据')); return; }
      }
    });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 && !pending ? null : new Error('云端目录读取进程未完成')));
    arm();
  });
}
