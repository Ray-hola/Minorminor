import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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

test('language preference stays in the browser and survives a reload without an API request', async t => {
  const keys = ['document', 'localStorage', 'location', 'fetch'];
  const original = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const storage = new Map([['minorminor.language', 'en']]);
  let change, reloads = 0;
  const loading = { textContent: '正在连接…' };
  const document = { documentElement: { lang: '' }, querySelector: () => loading, addEventListener: (type, handler) => { if (type === 'change') change = handler; } };
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: document },
    localStorage: { configurable: true, value: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } },
    location: { configurable: true, value: { reload: () => reloads++ } },
    fetch: { configurable: true, value: () => { throw new Error('Language switching must not call a backend'); } },
  });
  const first = await import('../public/i18n.js?browser-preference');
  assert.equal(first.getLocale(), 'en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(loading.textContent, 'Connecting…');
  let stopped = false;
  change({ target: { closest: () => ({ value: 'zh-CN' }) }, stopImmediatePropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(storage.get('minorminor.language'), 'zh-CN');
  assert.equal(reloads, 1);
  const reloaded = await import('../public/i18n.js?browser-reload');
  assert.equal(reloaded.getLocale(), 'zh-CN');
  change({ target: { closest: () => ({ value: '../../file' }) } });
  assert.equal(reloads, 1);
  assert.equal(storage.get('minorminor.language'), 'zh-CN');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage unavailable'); } });
  const restricted = await import('../public/i18n.js?restricted-storage');
  assert.equal(restricted.getLocale(), 'zh-CN');
  assert.doesNotThrow(() => restricted.setLocale('en'));
  assert.equal(document.documentElement.lang, 'en');
});

test('the Web service serves both language modules as JavaScript', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'minorminor-language-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = createApp({ home: root, runtimeDirectory: path.join(root, 'runtime') });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const asset of ['/i18n.js', '/locales/en.js']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.match(await response.text(), /export/);
  }
});
