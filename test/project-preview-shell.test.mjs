import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHostedServer } from '../hosted-server.mjs';
import { PROJECT_PREVIEW_CSP, PROJECT_PREVIEW_SHELL } from '../lib/project-preview-shell.mjs';

test('project relay accepts one bounded document from its parent only', () => {
  const listeners = [], writes = [], messages = [];
  const parent = { postMessage: value => messages.push(value) };
  const window = { parent, addEventListener: (name, fn) => listeners.push(fn) };
  const document = { open() {}, write: text => writes.push(text), close() {} };
  vm.runInNewContext(PROJECT_PREVIEW_SHELL.match(/<script>([\s\S]*?)<\/script>/)[1], { window, document });
  assert.equal(messages[0].type, 'hog:preview-ready');
  const deliver = (source, html, nonce = 'test') => listeners[0]({ source, data: { type: 'hog:render-project', nonce, html } });
  deliver({}, '<h1>Foreign</h1>'); deliver(parent, 'x'.repeat(900001)); deliver(parent, '<h1>Invalid nonce</h1>', null);
  assert.deepEqual(writes, []);
  deliver(parent, '<h1>Actual project</h1>'); deliver(parent, '<h1>Replacement rejected</h1>');
  assert.deepEqual(writes, ['<h1>Actual project</h1>']);
});

test('project relay is isolated, credential-free and embeddable while website routes stay protected', async t => {
  const flight = await createHostedServer(); await flight.listen(0, '127.0.0.1'); t.after(() => flight.close());
  const base = `http://127.0.0.1:${flight.server.address().port}/heartofgold`;
  const headers = { Origin: 'https://chatgpt.com', 'Sec-Fetch-Site': 'cross-site', Cookie: 'unrelated=value' };
  const response = await fetch(`${base}/project-preview.html`, { headers });
  assert.equal(response.status, 200); assert.equal(await response.text(), PROJECT_PREVIEW_SHELL);
  assert.equal(response.headers.get('content-security-policy'), PROJECT_PREVIEW_CSP);
  assert.equal(response.headers.get('x-frame-options'), null); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(flight.sessions.entries.size, 0);
  assert(!PROJECT_PREVIEW_CSP.includes('allow-same-origin')); assert(PROJECT_PREVIEW_CSP.includes("connect-src 'none'"));
  for (const route of ['/api/config', '/project-preview.html/']) assert.equal((await fetch(`${base}${route}`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/project-preview.html`, { method: 'POST', headers })).status, 405);
});
