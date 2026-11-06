import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHostedServer, BASE, COOKIE } from '../hosted-server.mjs';
import { FLIGHT_RESOURCE_URI, FLIGHT_RESOURCE_MIME } from '../lib/plugin.mjs';
import { MAX_PLUGIN_BODY_BYTES } from '../lib/crew-contract.mjs';

const ORIGIN = 'https://projectforty2.ai';
const ACCEPT = 'application/json, text/event-stream';
async function fixture(t, options = {}) {
  const counters = { discover: 0, adapter: 0 };
  const flight = await createHostedServer({ publicOrigin: ORIGIN,
    discover: async () => { counters.discover++; throw new Error('No provider discovery expected.'); },
    adapterFactory: () => { counters.adapter++; throw new Error('No provider execution expected.'); },
    ...options,
  });
  await flight.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${flight.server.address().port}${BASE}`;
  t.after(() => flight.close());
  const rpc = async (method = 'tools/list', params = {}, headers = {}) => {
    const response = await fetch(`${base}/mcp`, { method: 'POST', headers: {
      Accept: ACCEPT, 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25', ...headers,
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { response, value: await response.json() };
  };
  return { flight, base, rpc, counters };
}

test('hosted MCP creates no website session, consumes no provider access, and emits no credential cookies', async t => {
  let now = 1000;
  const { flight, rpc, counters } = await fixture(t, { now: () => now, maxSessions: 1 });
  const anonymous = await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'Plan a useful open-source contribution.' } });
  assert.equal(anonymous.response.status, 200); assert.equal(flight.sessions.entries.size, 0);
  const session = await flight.sessions.create();
  const key = 'synthetic-website-key-not-for-plugin';
  flight.sessions.setCredential(session, { key }, { provider: 'openai', model: 'synthetic-model', models: [] });
  const lastSeenAt = session.lastSeenAt; now += 500;
  const connected = await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'A different supplied mission.' } }, {
    Cookie: `${COOKIE}=${session.id}`, Authorization: 'Bearer unrelated-website-credential', 'X-Flight-Token': session.token,
  });
  assert.equal(connected.response.status, 200); assert.equal(flight.sessions.entries.size, 1);
  assert.equal(session.lastSeenAt, lastSeenAt); assert.equal(flight.sessions.credential(session).key, key);
  for (const call of [anonymous, connected]) {
    assert.equal(call.response.headers.get('set-cookie'), null); assert.equal(call.response.headers.get('mcp-session-id'), null);
    assert.equal(call.response.headers.get('access-control-allow-credentials'), null);
    assert(!JSON.stringify(call.value).includes(key)); assert(!JSON.stringify(call.value).includes(session.token));
  }
  assert.deepEqual(counters, { discover: 0, adapter: 0 });
});

test('MCP permits exact configured host origins and server-to-server requests only', async t => {
  const { rpc, flight } = await fixture(t);
  for (const origin of [undefined, ORIGIN, 'https://chatgpt.com', 'https://chat.openai.com']) {
    const { response, value } = await rpc('tools/list', {}, { ...(origin ? { Origin: origin } : {}), 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(response.status, 200); assert.equal(value.result.tools.length, 6);
    assert.equal(response.headers.get('access-control-allow-origin'), origin || null);
    if (origin) assert.equal(response.headers.get('vary'), 'Origin');
  }
  for (const origin of ['https://evil.example', 'https://chatgpt.com.evil.example', 'http://chatgpt.com', 'https://chatgpt.com:444', 'null']) {
    const { response, value } = await rpc('tools/list', {}, { Origin: origin });
    assert.equal(response.status, 403); assert.equal(value.code, 'ORIGIN_DENIED');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  assert.equal(flight.sessions.entries.size, 0);
});

test('MCP preflight permits protocol headers without cookies, auth, or arbitrary methods', async t => {
  const { base, flight } = await fixture(t);
  const response = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: {
    Origin: 'https://chatgpt.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,mcp-protocol-version',
  } });
  assert.equal(response.status, 204); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
  assert.equal(response.headers.get('access-control-allow-credentials'), null); assert.equal(response.headers.get('set-cookie'), null);
  const methods = response.headers.get('access-control-allow-methods'); assert(methods.includes('POST')); assert(!methods.includes('PATCH'));
  const headers = response.headers.get('access-control-allow-headers').toLowerCase();
  assert(headers.includes('content-type')); assert(headers.includes('mcp-protocol-version')); assert(!headers.includes('authorization')); assert(!headers.includes('cookie'));
  const denied = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  for (const method of ['GET', 'DELETE']) {
    const stateless = await fetch(`${base}/mcp`, { method, headers: { Origin: 'https://chatgpt.com' } });
    assert.equal(stateless.status, 405); assert.equal(stateless.headers.get('allow'), 'POST');
  }
  assert.equal(flight.sessions.entries.size, 0);
});

test('allowing ChatGPT MCP origins does not relax website cross-site or CSRF protection', async t => {
  const { base, flight } = await fixture(t);
  for (const headers of [{ Origin: 'https://chatgpt.com' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example' }]) {
    const response = await fetch(`${base}/api/config`, { headers });
    assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(flight.sessions.entries.size, 0);
  const configured = await fetch(`${base}/api/config`, { headers: { Origin: ORIGIN } });
  const config = await configured.json();
  const cookie = configured.headers.get('set-cookie').split(';')[0];
  assert.equal(config.hosted, true); assert.equal(flight.sessions.entries.size, 1);
  const post = (headers) => fetch(`${base}/api/disconnect`, { method: 'POST', headers: {
    Cookie: cookie, 'Content-Type': 'application/json', ...headers,
  }, body: '{}' });
  const foreign = await post({ Origin: 'https://chatgpt.com', 'X-Flight-Token': config.token });
  assert.equal(foreign.status, 403); assert.equal((await foreign.json()).code, 'ORIGIN_DENIED');
  const absentOrigin = await post({ 'X-Flight-Token': config.token });
  assert.equal(absentOrigin.status, 403); assert.equal((await absentOrigin.json()).code, 'ORIGIN_REQUIRED');
  const csrf = await post({ Origin: ORIGIN });
  assert.equal(csrf.status, 403); assert.equal((await csrf.json()).code, 'CSRF_INVALID');
  assert.equal((await post({ Origin: ORIGIN, 'X-Flight-Token': config.token })).status, 200);
});

test('MCP exception is confined to the exact endpoint', async t => {
  const { base } = await fixture(t);
  for (const route of ['/mcp/', '/mcp/../api/config', '/api/runs', '/']) {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { Origin: 'https://chatgpt.com', 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
});

test('plugin preview executes only hashed bundled scripts and connects only to its own artifact origin', async t => {
  const { base, flight } = await fixture(t);
  const response = await fetch(`${base}/plugin-preview/`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  const html = await response.text(); const csp = response.headers.get('content-security-policy');
  assert(csp.includes("default-src 'none'")); assert(csp.includes(`connect-src ${ORIGIN};`));
  assert(csp.includes('font-src data:'));
  assert(csp.includes("base-uri 'none'")); assert(csp.includes("form-action 'none'"));
  const scriptPolicy = csp.split(';').find(part => part.trim().startsWith('script-src'));
  assert(scriptPolicy); assert(!scriptPolicy.includes('unsafe-inline')); assert(!scriptPolicy.includes('unsafe-eval')); assert(!scriptPolicy.includes('https:'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert(scripts.length > 0);
  for (const [, script] of scripts) assert(scriptPolicy.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  assert(!/<script\b[^>]*\bsrc=/i.test(html)); assert.equal(flight.sessions.entries.size, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('hosted resource delivery is the built standalone MCP App and cannot hydrate website private data', async t => {
  const { rpc, flight } = await fixture(t);
  const { response, value } = await rpc('resources/read', { uri: FLIGHT_RESOURCE_URI }, { Origin: 'https://chatgpt.com' });
  assert.equal(response.status, 200);
  const content = value.result.contents[0];
  assert.equal(content.mimeType, FLIGHT_RESOURCE_MIME); assert(content.text.includes('<!doctype html>'));
  assert.deepEqual(content._meta.ui.csp, { connectDomains: [ORIGIN], resourceDomains: [], frameDomains: [ORIGIN] });
  assert(!content.text.includes('/api/connect')); assert(!content.text.includes('/api/runs')); assert.equal(flight.sessions.entries.size, 0);
});

test('optional ingress boundary still applies to MCP and preview before origin relaxation', async t => {
  const ingressToken = 'synthetic-ingress-test-value';
  const { rpc, base, flight } = await fixture(t, { ingressToken });
  const denied = await rpc(); assert.equal(denied.response.status, 403); assert.equal(denied.value.code, 'INGRESS_DENIED');
  const allowed = await rpc('tools/list', {}, { 'X-Hog-Ingress': ingressToken, Origin: 'https://chatgpt.com' });
  assert.equal(allowed.response.status, 200);
  assert.equal((await fetch(`${base}/plugin-preview/`)).status, 403);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal(flight.sessions.entries.size, 0);
});

test('hosted MCP preserves the actual byte bound without entering the website API body parser', async t => {
  const { base, rpc } = await fixture(t);
  const created = (await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'A large but bounded supplied report.' } })).value.result.structuredContent;
  const valid = await rpc('tools/call', { name: 'show_flight', arguments: {
    flightId: created.flight.id, writeToken: created.flight.writeToken, expectedRevision: created.flight.revision,
    mission: 'A supplied completed role pass.', execution: 'guided_passes', status: 'complete', summary: 's'.repeat(6000),
    members: [{ id: 'lead', parentId: null, name: 'Lead', role: 'Coordinator', task: 't'.repeat(2000), output: 'o'.repeat(1000), status: 'complete', result: 'r'.repeat(6000) }],
    constraints: Array.from({ length: 8 }, () => 'c'.repeat(500)),
  } });
  assert.equal(valid.response.status, 200); assert.equal(valid.value.result.isError, undefined);
  const oversized = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: ACCEPT }, body: 'x'.repeat(MAX_PLUGIN_BODY_BYTES + 1) });
  assert.equal(oversized.status, 413); assert.equal(oversized.headers.get('set-cookie'), null);
});

test('hosted board updates persist between MCP requests while website cookies grant no board access', async t => {
  const { rpc, base, flight } = await fixture(t);
  const opened = (await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'Keep one crew board for this mission.' } })).value.result;
  const board = opened.structuredContent;
  const configured = await fetch(`${base}/api/config`); const cookie = configured.headers.get('set-cookie').split(';')[0];
  const { schemaVersion, view, capabilities, provenance, flight: handle, ...input } = board;
  delete input.summary;
  input.members[1].role = 'Revised same-board reviewer';
  const updated = await rpc('tools/call', { name: 'show_flight', arguments: { ...input, flightId: handle.id, writeToken: handle.writeToken, expectedRevision: 1 } });
  assert.equal(updated.value.result.structuredContent.flight.id, handle.id); assert.equal(updated.value.result.structuredContent.flight.revision, 2);
  assert.equal(updated.value.result._meta?.ui, undefined);
  const read = await rpc('tools/call', { name: 'read_flight', arguments: { flightId: handle.id, readToken: opened._meta.flight.readToken, afterRevision: 1 } });
  assert.equal(read.value.result.structuredContent.members[1].role, 'Revised same-board reviewer');
  const denied = await rpc('tools/call', { name: 'read_flight', arguments: { flightId: handle.id, readToken: 'x'.repeat(43) } }, { Cookie: cookie });
  assert.equal(denied.value.result._meta.flightError.code, 'FLIGHT_UNAVAILABLE'); assert.equal(denied.value.result.structuredContent, undefined);
  assert.equal(flight.sessions.entries.size, 1);
  const history = await fetch(`${base}/api/runs`, { headers: { Cookie: cookie } }); assert.deepEqual(await history.json(), []);
});

test('artifact routes mount before website session guards and retain exact CORS and ingress limits', async t => {
  const {base,flight}=await fixture(t);
  const origin='https://projectforty2-ai.web-sandbox.oaiusercontent.com';
  for(const route of ['write','events']){
    const allowed=await fetch(`${base}/artifacts/${route}`,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
    assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),origin);
    assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
    const denied=await fetch(`${base}/artifacts/${route}`,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,403);
    const credential=await fetch(`${base}/artifacts/${route}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'unrelated=private'},body:'{}'});
    assert.equal(credential.status,400);assert.equal((await credential.json()).error.code,'CREDENTIALS_NOT_ALLOWED');
  }
  assert.equal(flight.sessions.entries.size,0);
  const secured=await fixture(t,{ingressToken:'synthetic-ingress'});
  assert.equal((await fetch(`${secured.base}/artifacts/events`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
});
