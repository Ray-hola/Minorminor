import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, symlink, lstat, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { readCloudDirectory } from '../lib/cloud-directory.mjs';
import { measure } from '../lib/scanner.mjs';

test('isolated cloud traversal counts files and allocation, including hidden entries, without following links', async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-cloud-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cloud = path.join(home, 'Library/Mobile Documents/provider'), nested = path.join(cloud, '.hidden');
  await mkdir(nested, { recursive: true });
  await writeFile(path.join(nested, 'data.bin'), 'fixture payload');
  await symlink(home, path.join(cloud, 'outside'));
  const result = await measure(home), info = await lstat(path.join(nested, 'data.bin'));
  assert.equal(result.count, 1); assert.equal(result.bytes, info.blocks * 512); assert.equal(result.symlinks, 1); assert.equal(result.skipped, 0);
  assert.equal((await measure(cloud)).available, true);
});

test('a blocked filesystem child times out, is terminated, and cannot hold the caller or publish late data', async t => {
  let child;
  const spawnProcess = (_, args, options) => child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
  t.after(() => child?.kill('SIGKILL'));
  const started = Date.now();
  await assert.rejects(readCloudDirectory('/unused', { timeoutMs: 100, spawnProcess }), error => error.code === 'ETIMEDOUT' && Array.isArray(error.entries));
  assert.ok(Date.now() - started < 2000); assert.equal(child.killed, true);
});

test('isolated directory reads can be cancelled while the filesystem has not returned', async t => {
  let child;
  const spawnProcess = (_, args, options) => child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
  t.after(() => child?.kill('SIGKILL'));
  await assert.rejects(readCloudDirectory('/unused', { cancelled: () => true, spawnProcess }), { code: 'ABORT_ERR' });
  assert.equal(child.killed, true);
});

test('a replaced cloud directory is refused and missing paths retain their precise error', async t => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'minor-cloud-guard-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const redirected = path.join(home, 'redirected'); await symlink(home, redirected);
  const rows = await readCloudDirectory(redirected);
  assert.equal(rows.length, 1); assert.equal(rows[0].error.code, 'SYMLINK_ROOT');
  assert.equal((await readCloudDirectory(path.join(home, 'missing')))[0].error.code, 'ENOENT');
});
