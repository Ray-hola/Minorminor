import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server.mjs';
import { tr, ui, getLocale, setLocale, languagePicker } from '../public/i18n.js';
import english from '../public/locales/en.js';

test('language selection translates authored UI and preserves interpolated file data', () => {
  try {
    setLocale('en');
    assert.equal(getLocale(), 'en');
    assert.equal(tr('确认移到废纸篓'), 'Confirm move to Trash');
    assert.equal(ui`${1} 个文件`, '1 file');
    assert.equal(ui`${2} 个文件`, '2 files');
    assert.equal(tr('<button title="扫描范围">开始扫描</button>'), '<button title="Scan scope">Start scan</button>');
    const filename = '日志/记忆/设置.md';
    const excerpt = '&lt;script&gt;缓存&lt;/script&gt;';
    assert.equal(ui`<h2>文件</h2><code>${filename}</code><pre>${excerpt}</pre>`, `<h2>Files</h2><code>${filename}</code><pre>${excerpt}</pre>`);
    assert.match(languagePicker(), /value="en" selected/);
    assert.throws(() => setLocale('../../file'), RangeError);
    assert.equal(getLocale(), 'en');
    assert.ok(Object.keys(english).length > 700);
    assert.ok(Object.values(english).every(value => value && !/[\p{Script=Han}]/u.test(value)));
    setLocale('zh-CN');
    assert.equal(tr('确认移到废纸篓'), '确认移到废纸篓');
  } finally { setLocale('zh-CN'); }
});

test('language preference is authenticated, validated, private and restored on a new port', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'minorminor-language-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeDirectory = path.join(root, 'runtime');
  async function start() {
    const server = createApp({ home: root, runtimeDirectory, persistState: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    t.after(close);
    const bootstrap = await fetch(base + '/api/bootstrap').then(response => response.json());
    const post = (body, token = bootstrap.token, origin) => fetch(base + '/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Minorminor-Token': token, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    return { base, bootstrap, post, close };
  }
  const first = await start();
  assert.deepEqual(first.bootstrap.preferences, {});
  assert.equal((await first.post({ locale: 'en' }, 'wrong')).status, 403);
  assert.equal((await first.post({ locale: 'en' }, undefined, 'https://untrusted.invalid')).status, 403);
  assert.equal((await first.post({ locale: 'fr' })).status, 400);
  assert.equal((await first.post({ locale: 'en', path: '/tmp' })).status, 400);
  assert.deepEqual(await (await first.post({ locale: 'en' })).json(), { locale: 'en' });
  const file = path.join(runtimeDirectory, 'preferences.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { locale: 'en' });
  await first.close();
  const next = await start();
  assert.deepEqual(next.bootstrap.preferences, { locale: 'en' });
  for (const asset of ['/i18n.js', '/locales/en.js']) {
    const response = await fetch(next.base + asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
});
