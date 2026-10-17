import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const moleRoot = path.join(projectRoot, 'vendor/mole');
export const allowedCommands = ['clean', 'optimize', 'purge', 'installer'];

export function cleanTerminal(text) {
  return text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export async function metadata() {
  try {
    const source = await readFile(path.join(moleRoot, 'mole'), 'utf8');
    const provenance = JSON.parse(await readFile(path.join(projectRoot, 'UPSTREAM.json'), 'utf8').catch(() => '{}'));
    return { available: true, version: source.match(/^VERSION=["']?([^\s"']+)/m)?.[1] || 'unknown', repository: 'https://github.com/tw93/Mole', license: 'GPL-3.0', ...provenance };
  } catch { return { available: false, repository: 'https://github.com/tw93/Mole', license: 'GPL-3.0' }; }
}

export function commandSpec(command, mode = 'preview', inherited = process.env) {
  if (!allowedCommands.includes(command)) throw new Error('不支持的 Mole 命令');
  if (!['preview', 'execute'].includes(mode) || mode === 'execute' && command !== 'clean') throw new Error('只允许执行 Mole clean，其他命令仅支持预览');
  const { MOLE_TEST_MODE, MOLE_TEST_TRASH_DIR, ...env } = inherited;
  return { args: [path.join(moleRoot, 'mole'), command, ...(mode === 'preview' ? ['--dry-run'] : [])], env: { ...env, TERM: 'dumb', NO_COLOR: '1', MOLE_DRY_RUN: mode === 'preview' ? '1' : '0', MOLE_TEST_NO_AUTH: '1', MO_NO_OPLOG: mode === 'preview' ? '1' : '0', MOLE_DELETE_MODE: 'permanent', CI: '1' } };
}

export function runPreview(command, onOutput, onDone) { return runMole(command, 'preview', onOutput, onDone); }
export function runCleanup(onOutput, onDone) { return runMole('clean', 'execute', onOutput, onDone); }

function runMole(command, mode, onOutput, onDone) {
  const spec = commandSpec(command, mode);
  const child = spawn('/bin/bash', spec.args, {
    cwd: moleRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spec.env,
  });
  let finished = false;
  let reason = null;
  let hardStop;
  function cancel(message = '用户已停止扫描') {
    if (finished) return;
    reason = message;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
    hardStop = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500);
    hardStop.unref();
  }
  const timeout = command === 'clean' ? null : setTimeout(() => cancel('预览达到 3 分钟上限，已停止；请查看已收集的结果'), 180_000);
  timeout?.unref();
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => onOutput(cleanTerminal(text)));
  child.stderr.on('data', text => onOutput(cleanTerminal(text)));
  function finish(code, error) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    clearTimeout(hardStop);
    // Clean up any helpers left behind by an exited shell.
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    onDone({ code, error: error || reason });
  }
  child.on('error', error => finish(null, error.message));
  child.on('close', code => finish(code, null));
  return { cancel };
}
