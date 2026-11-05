import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedServer, BASE, COOKIE } from '../hosted-server.mjs';
import { SharedGate, HostedSessions } from '../lib/hosted-sessions.mjs';
import { SwarmRuntime } from '../lib/runtime.mjs';

const ORIGIN = 'https://projectforty2.ai';
const KEY = 'sk-private-sentinel-never-persist-this';
const leaf = { summary: 'Finished.', result: 'A useful bounded report.', children: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(5); } throw new Error('Condition timed out.'); }
async function fixture(t, options = {}) {
  const seen = [];
  const flight = await createHostedServer({ publicOrigin: ORIGIN,
    discover: async input => { seen.push({ provider: input.provider, key: input.key }); return [{ id: 'gpt-4.1-mini', label: 'Small' }, { id: 'gpt-4.1', label: 'Large' }]; },
    adapterFactory: () => ({ async run() { return leaf; } }), ...options });
  await flight.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${flight.server.address().port}${BASE}`;
  t.after(() => flight.close());
  async function browser() {
    const state = { cookie: '', token: '', config: null };
    state.request = async (route, { method = 'GET', data, headers = {}, signal } = {}) => {
      const response = await fetch(url + '/api/' + route, { method, signal, headers: { ...(state.cookie ? { Cookie: state.cookie } : {}), ...(method === 'POST' ? { Origin: ORIGIN, 'X-Flight-Token': state.token, 'Content-Type': 'application/json' } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
      const cookie = response.headers.get('set-cookie'); if (cookie) state.cookie = cookie.split(';')[0];
      const value = await response.json();
      if (value.token) { state.token = value.token; state.config = value; }
      return { response, value };
    };
    state.first = await state.request('config');
    return state;
  }
  return { flight, url, browser, seen };
}
const connect = browser => browser.request('connect', { method: 'POST', data: { provider: 'openai', key: KEY } });
const launch = (browser, overrides = {}) => browser.request('runs', { method: 'POST', data: { task: 'Produce one useful report.', mode: 'api', maxDepth: 0, maxAgents: 1, ...overrides } });

test('hosted connection rotates credentials, exposes only model metadata, and rejects local CLI mode', async t => {
  const { browser, seen } = await fixture(t); const user = await browser();
  const cookieHeader = user.first.response.headers.get('set-cookie');
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/heartofgold/']) assert(cookieHeader.includes(part));
  assert(!cookieHeader.includes('Domain='));
  const oldCookie = user.cookie, oldToken = user.token;
  const connected = await connect(user); assert.equal(connected.response.status, 200);
  assert.notEqual(user.cookie, oldCookie); assert.notEqual(user.token, oldToken);
  assert.equal(seen[0].key, KEY); assert.equal(user.config.connection.model, 'gpt-4.1-mini');
  assert(!JSON.stringify(connected.value).includes(KEY));
  assert.equal((await user.request('model', { method: 'POST', data: { model: 'gpt-4.1' } })).response.status, 200);
  assert.equal((await user.request('model', { method: 'POST', data: { model: 'custom-server-model' } })).response.status, 400);
  assert.equal((await launch(user, { mode: 'codex' })).response.status, 400);
});

test('sessions cannot read, cancel, list, or subscribe to another session run', async t => {
  const { browser, url } = await fixture(t); const a = await browser(), b = await browser(); await connect(a);
  const abortA = new AbortController(), abortB = new AbortController();
  t.after(() => { abortA.abort(); abortB.abort(); });
  const streamA = await fetch(url + '/api/events', { headers: { Cookie: a.cookie }, signal: abortA.signal });
  const streamB = await fetch(url + '/api/events', { headers: { Cookie: b.cookie }, signal: abortB.signal });
  const readerA = streamA.body.getReader(), readerB = streamB.body.getReader();
  await readerA.read(); await readerB.read();
  const created = await launch(a); const id = created.value.id; assert(id);
  assert.equal((await b.request(`runs/${id}`)).response.status, 404);
  assert.equal((await b.request(`runs/${id}/cancel`, { method: 'POST', data: {} })).response.status, 404);
  assert.deepEqual((await b.request('runs')).value, []);
  const event = new TextDecoder().decode((await readerA.read()).value); assert(event.includes(id));
  const leak = await Promise.race([readerB.read().then(() => true).catch(() => false), sleep(70).then(() => false)]);
  assert.equal(leak, false);
  abortA.abort(); abortB.abort();
});

test('CSRF, foreign origin, missing session and forged cookie fail closed', async t => {
  const { browser } = await fixture(t); const user = await browser();
  assert.equal((await user.request('connect', { method: 'POST', data: {}, headers: { Origin: 'https://evil.example' } })).response.status, 403);
  const csrf = await user.request('connect', { method: 'POST', data: {}, headers: { 'X-Flight-Token': 'wrong' } }); assert.equal(csrf.value.code, 'CSRF_INVALID');
  user.cookie = `${COOKIE}=${'a'.repeat(64)}`;
  const missing = await user.request('runs'); assert.equal(missing.response.status, 401); assert.equal(missing.value.code, 'SESSION_EXPIRED');
});

test('disconnect aborts live work, removes key, and leaves credential-free run receipts', async t => {
  let started = false, aborted = false;
  const { browser } = await fixture(t, { adapterFactory: () => ({ run: ({ signal }) => new Promise((_, reject) => {
    started = true; signal.addEventListener('abort', () => { aborted = true; reject(new Error(KEY)); }, { once: true });
  }) }) });
  const user = await browser(); await connect(user); const created = await launch(user); await until(() => started);
  assert.equal((await launch(user)).response.status, 409);
  const disconnected = await user.request('disconnect', { method: 'POST', data: {} });
  assert.equal(disconnected.response.status, 200); assert.equal(disconnected.value.connection, null); assert(aborted);
  const run = (await user.request(`runs/${created.value.id}`)).value;
  assert.equal(run.status, 'cancelled'); assert(!JSON.stringify(run).includes(KEY));
  assert.equal((await launch(user)).value.code, 'PROVIDER_NOT_CONNECTED');
});

for (const providerStatus of [401, 403]) test(`provider ${providerStatus} access failure clears connection without echoing secrets`, async t => {
  const { browser } = await fixture(t, { adapterFactory: () => ({ async run() { throw Object.assign(new Error(KEY), { status: providerStatus, code: 'authentication' }); } }) });
  const user = await browser(); await connect(user); const created = await launch(user);
  await sleep(15);
  const run = (await user.request(`runs/${created.value.id}`)).value;
  assert.equal(run.status, 'failed'); assert(!JSON.stringify(run).includes(KEY));
  assert.equal((await user.request('config')).value.connection, null);
});

test('expired sessions cancel work and do not restore keys after a new config request', async t => {
  let now = 1000;
  const { browser, flight } = await fixture(t, { now: () => now, idleMs: 100, absoluteMs: 1000 });
  const user = await browser(); await connect(user); const oldCookie = user.cookie;
  now += 101; await flight.sessions.sweep();
  assert.equal((await user.request('runs')).value.code, 'SESSION_EXPIRED');
  const fresh = await user.request('config'); assert.equal(fresh.value.connection, null); assert.notEqual(user.cookie, oldCookie);
});

test('connect cancellation cannot reattach a key after disconnect', async t => {
  let release, began = false;
  const { browser } = await fixture(t, { discover: async () => { began = true; await new Promise(resolve => { release = resolve; }); return [{ id: 'gpt-4.1-mini' }]; } });
  const user = await browser();
  const connecting = connect(user); await until(() => began);
  await user.request('disconnect', { method: 'POST', data: {} }); release();
  assert.equal((await connecting).value.code, 'CONNECTION_CANCELLED');
  assert.equal((await user.request('config')).value.connection, null);
});

test('session creation and connection rate limits stay bounded across cookie rotation', async t => {
  const { browser } = await fixture(t, { maxSessions: 2 });
  const first = await browser(); await browser();
  assert.equal((await browser()).first.response.status, 503);
  for (let i = 0; i < 6; i++) assert.equal((await connect(first)).response.status, 200);
  assert.equal((await connect(first)).response.status, 429);
});

test('global live mission cap is shared across sessions', async t => {
  const { browser } = await fixture(t, { maxLiveRuns: 1, adapterFactory: () => ({ run: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) }) });
  const a = await browser(), b = await browser(); await connect(a); await connect(b);
  assert.equal((await launch(a)).response.status, 201);
  assert.equal((await launch(b)).value.code, 'FLIGHT_CAPACITY');
  await a.request('disconnect', { method: 'POST', data: {} });
});

test('shared provider gate caps paid calls and removes aborted queued requests', async () => {
  const gate = new SharedGate(2); const controller = new AbortController();
  const releaseA = await gate.acquire(new AbortController().signal), releaseB = await gate.acquire(new AbortController().signal);
  const pending = gate.acquire(controller.signal); assert.equal(gate.active, 2); assert.equal(gate.queue.length, 1);
  controller.abort(); await assert.rejects(pending); assert.equal(gate.queue.length, 0);
  releaseA(); releaseB(); assert.equal(gate.active, 0);
});

test('hosted runtime is memory-only, snapshots provider/model and keeps only five receipts', async () => {
  const runtime = new SwarmRuntime({ memoryOnly: true, allowedModes: ['api'], maxHistory: 5, adapterFactory: () => ({ async run(input) { assert.equal(input.cwd, undefined); return leaf; } }) });
  await runtime.init();
  for (let i = 0; i < 7; i++) { const run = runtime.createRun({ task: 'bounded report', mode: 'api', provider: 'openai', model: `test-${i}`, maxDepth: 0 }); await until(() => runtime.getRun(run.id)?.status === 'completed'); }
  assert.equal(runtime.listRuns().length, 5); assert(runtime.listRuns().every(run => run.provider === 'openai'));
  assert.equal(runtime.dataDir, null); await runtime.close();
});

test('health is sessionless and hosted HTML is marked fail-closed', async t => {
  const { url, flight } = await fixture(t);
  const health = await fetch(url + '/api/health'); assert.equal(health.status, 200); assert.equal(flight.sessions.entries.size, 0);
  const page = await fetch(url + '/'); assert.match(await page.text(), /data-runtime="hosted"/);
});

test('a late authentication failure from an old run cannot revoke a new connection', async t => {
  let rejectOld, started = false;
  const { browser, flight } = await fixture(t, { adapterFactory: () => ({ run: () => new Promise((_, reject) => { rejectOld = reject; started = true; }) }) });
  const user = await browser(); await connect(user); await launch(user); await until(() => started);
  const disconnecting = user.request('disconnect', { method: 'POST', data: {} });
  await until(() => [...flight.sessions.entries.values()][0].connection === null);
  assert.equal((await connect(user)).response.status, 200);
  rejectOld(Object.assign(new Error(KEY), { status: 401, code: 'authentication' }));
  await disconnecting;
  assert.equal((await user.request('config')).value.connection.provider, 'openai');
});
