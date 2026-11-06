import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { FlightStore } from '../lib/flight-store.mjs';
import { createArtifactStreamHandler } from '../lib/artifact-stream.mjs';
import { createProject } from '../lib/project-contract.mjs';

const crew = () => ({ mission: 'Build a useful form', execution: 'native_agents', status: 'working', members: [
  { id: 'lead', parentId: null, status: 'working' }, { id: 'ford', parentId: 'lead', workerId: 'actual-host-worker', status: 'working' },
] });
const bindings = () => [{ componentId: 'entry', label: 'Entry', memberId: 'ford', workerId: 'actual-host-worker', filePaths: ['entry.html', 'entry.css', 'entry.js'] }];
const shell = () => ({ title: 'Live form', entrypoint: 'index.html', files: [{ path: 'index.html', content: '<main data-hog-component="entry"></main>', memberId: 'lead' }], checks: [{ name: 'Prior check', details: 'A check of the prior shell.', status: 'passed', memberId: 'lead' }], components: [] });
const code = expected => error => error.code === expected;
function fixture(t, options = {}) {
  let time = 1000;
  const store = new FlightStore({ now: () => time, ...options }); t.after(() => store.close());
  const opened = store.create(crew());
  const initial = store.updateProject(opened.flight.id, opened.flight.writeToken, 1, shell());
  const channel = store.openArtifactStream(opened.flight.id, opened.flight.writeToken, initial.flight.revision, bindings());
  let sequence = 0;
  const batch = (changes = {}) => ({ flightId: opened.flight.id, artifactToken: channel.artifactToken, expectedProjectRevision: 1, batchId: `batch-${++sequence}`,
    upserts: [{ path: 'entry.html', content: '<form data-hog-component="entry">A real write</form>' }], deletePaths: [], ...changes });
  return { store, opened, channel, batch, advance: ms => { time += ms; } };
}

test('artifact capability is separate, path-scoped, rotatable and never grants crew/read access', t => {
  const { store, opened, channel, batch } = fixture(t);
  assert.notEqual(channel.artifactToken, opened.flight.writeToken); assert.notEqual(channel.artifactToken, opened.readToken);
  assert.throws(() => store.read(opened.flight.id, channel.artifactToken), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.update(opened.flight.id, channel.artifactToken, 2, crew()), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.writeArtifacts(batch({ upserts: [{ path: 'index.html', content: 'unauthorized' }] })), code('ARTIFACT_SCOPE'));
  const other = store.create(crew());
  assert.throws(() => store.writeArtifacts(batch({ flightId: other.flight.id })), code('ARTIFACT_UNAVAILABLE'));
  const rotated = store.openArtifactStream(opened.flight.id, opened.flight.writeToken, 2, bindings());
  assert.throws(() => store.writeArtifacts(batch()), code('ARTIFACT_UNAVAILABLE'));
  assert.equal(store.writeArtifacts(batch({ artifactToken: rotated.artifactToken })).updated, true);
  const read = store.read(opened.flight.id, opened.readToken);
  assert(!JSON.stringify(read).includes(rotated.artifactToken)); assert(!JSON.stringify(store).includes(rotated.artifactToken));
});

test('future paths may be scoped but writes require current actual member/worker attribution', t => {
  const { store, opened, batch } = fixture(t);
  const planned = crew(); planned.members[1] = { ...planned.members[1], status: 'planned', workerId: undefined };
  store.update(opened.flight.id, opened.flight.writeToken, 2, planned);
  assert.throws(() => store.writeArtifacts(batch()), code('INVALID_PROJECT'));
  const replaced = crew(); replaced.members[1].workerId = 'different-worker';
  store.update(opened.flight.id, opened.flight.writeToken, 3, replaced);
  assert.throws(() => store.writeArtifacts(batch()), code('INVALID_PROJECT'));
  assert.throws(() => store.openArtifactStream(opened.flight.id, opened.flight.writeToken, 4, [...bindings(), { ...bindings()[0], componentId: 'other' }]), code('INVALID_PROJECT'));
});

test('actual invalid JavaScript bytes are retained, source receipts derive from writes, and old checks clear', t => {
  const { store, opened, batch } = fixture(t);
  const text = '(ctx) => { const incomplete =';
  const result = store.writeArtifacts(batch({ upserts: [{ path: 'entry.js', content: text }] }));
  assert.equal(result.projectRevision, 2);
  const project = store.read(opened.flight.id, opened.readToken).snapshot.project;
  assert.equal(project.files.find(file => file.path === 'entry.js').content, text);
  assert.deepEqual(project.checks, []); assert.equal(project.events.length, 1);
  assert.deepEqual(project.events[0].changedPaths, ['entry.js']); assert.equal(project.events[0].workerId, 'actual-host-worker');
  assert.equal(project.provenance.verified, false);
});

test('project CAS tolerates crew status writes but rejects source races with only authorized scoped hashes', t => {
  const { store, opened, batch } = fixture(t);
  const progressed = crew(); progressed.members[0].status = 'waiting';
  store.update(opened.flight.id, opened.flight.writeToken, 2, progressed);
  const result = store.writeArtifacts(batch()); assert.equal(result.flight.revision, 4);
  try { store.writeArtifacts(batch()); assert.fail(); }
  catch (error) { assert.equal(error.code, 'PROJECT_CONFLICT'); assert.equal(error.currentProjectRevision, 2);
    assert.deepEqual(error.scopedFiles.map(file => file.path), bindings()[0].filePaths);
    assert(error.scopedFiles.find(file => file.path === 'entry.html').sha256); assert(!JSON.stringify(error).includes('index.html')); }
  try { store.writeArtifacts(batch({ artifactToken: 'x'.repeat(43) })); assert.fail(); }
  catch (error) { assert.equal(error.code, 'ARTIFACT_UNAVAILABLE'); assert.equal(error.scopedFiles, undefined); }
});

test('retry and unchanged files are no-ops; reused batch IDs cannot conceal another write', t => {
  const { store, opened, batch } = fixture(t);
  const request = batch(); const result = store.writeArtifacts(request);
  assert.equal(store.writeArtifacts(request).updated, false);
  assert.equal(store.read(opened.flight.id, opened.readToken).flight.revision, result.flight.revision);
  assert.throws(() => store.writeArtifacts({ ...request, upserts: [{ path: 'entry.html', content: 'different' }] }), code('BATCH_CONFLICT'));
  const noChange = store.writeArtifacts(batch({ expectedProjectRevision: 2 })); assert.equal(noChange.updated, false); assert.equal(noChange.projectRevision, 2);
  store.writeArtifacts(batch({ expectedProjectRevision: 2, upserts: [{ path: 'entry.css', content: 'form { color: gold; }' }] }));
  assert.throws(() => store.writeArtifacts(request), code('PROJECT_CONFLICT'));
});

test('scope and project-size failures leave source/revision intact and rate limits are bounded', t => {
  const { store, opened, batch, advance } = fixture(t);
  const before = store.read(opened.flight.id, opened.readToken);
  assert.throws(() => store.writeArtifacts(batch({ upserts: [{ path: '../secret.js', content: 'x' }] })), code('INVALID_ARTIFACT'));
  assert.throws(() => store.writeArtifacts(batch({ upserts: [{ path: 'entry.js', content: 'x'.repeat(65537) }] })), code('INVALID_ARTIFACT'));
  assert.throws(() => store.writeArtifacts(batch({ upserts: [{ path: 'entry.js', content: 'a' }], deletePaths: ['entry.js'] })), code('ARTIFACT_SCOPE'));
  assert.deepEqual(store.read(opened.flight.id, opened.readToken), before);
  for (let i = 0; i < 3; i++) store.writeArtifacts(batch({ upserts: [] }));
  assert.throws(() => store.writeArtifacts(batch({ upserts: [] })), code('ARTIFACT_RATE_LIMIT'));
  advance(1000); assert.equal(store.writeArtifacts(batch({ upserts: [] })).updated, false);
});

test('subscriptions are scoped and bounded, current-only on reconnect, and closed at fixed expiry', t => {
  const { store, opened, channel, batch, advance } = fixture(t, { ttlMs: 2000, maxSubscribers: 2 });
  const events = []; const a = store.subscribe(opened.flight.id, opened.readToken, (type, value) => events.push({ type, value }));
  const b = store.subscribe(opened.flight.id, opened.readToken, () => {});
  assert.throws(() => store.subscribe(opened.flight.id, opened.readToken, () => {}), code('OBSERVER_LIMIT'));
  assert.throws(() => store.subscribe(opened.flight.id, channel.artifactToken, () => {}), code('FLIGHT_UNAVAILABLE'));
  store.writeArtifacts(batch()); assert.equal(events.length, 1); assert.equal(events[0].type, 'update');
  assert.equal(events[0].value.resync, false); assert.equal(events[0].value.project.revision, 2);
  b.unsubscribe(); const reconnect = store.subscribe(opened.flight.id, opened.readToken, () => {});
  assert.equal(reconnect.snapshot.project.revision, 2); assert.equal(events.length, 1);
  advance(2000); store.sweep(); assert.equal(events.at(-1).type, 'expired');
  assert.deepEqual(store.stats, { flights: 0, bytes: 0 });
  assert.throws(() => store.writeArtifacts(batch()), code('ARTIFACT_UNAVAILABLE')); a.unsubscribe(); reconnect.unsubscribe();
});

test('global reader capacity recovers after unsubscribe and channel metadata counts toward aggregate memory', t => {
  const { store, opened, channel } = fixture(t, { maxSubscribers: 1 });
  const other = store.create(crew()); const first = store.subscribe(opened.flight.id, opened.readToken, () => {});
  assert.throws(() => store.subscribe(other.flight.id, other.readToken, () => {}), code('OBSERVER_LIMIT'));
  first.unsubscribe(); const second = store.subscribe(other.flight.id, other.readToken, () => {}); second.unsubscribe();
  const before = store.stats.bytes;
  store.openArtifactStream(opened.flight.id, opened.flight.writeToken, channel.flight.revision, bindings());
  assert.equal(store.stats.bytes, before, 'rotation replaces capability metadata rather than retaining token history');
  const tiny = new FlightStore({ maxTotalBytes: 1000 }); t.after(() => tiny.close()); const small = tiny.create(crew()); const original = tiny.stats;
  assert.throws(() => tiny.openArtifactStream(small.flight.id, small.flight.writeToken, 1, bindings()), code('FLIGHT_CAPACITY'));
  assert.deepEqual(tiny.stats, original);
});

test('component runtime manifest validates exact mappings and accepts incomplete controller source without execution', () => {
  const input = shell(); input.files.push(
    { path: 'entry.html', content: '<form>Entry</form>', memberId: 'ford', workerId: 'actual-host-worker' },
    { path: 'entry.css', content: 'form{color:gold}', memberId: 'ford', workerId: 'actual-host-worker' },
    { path: 'entry.js', content: '(ctx)=>{incomplete', memberId: 'ford', workerId: 'actual-host-worker' });
  input.components = [{ id: 'entry', label: 'Entry', memberId: 'ford', workerId: 'actual-host-worker', filePaths: bindings()[0].filePaths }];
  input.runtime = { kind: 'components-v1', shellPaths: ['index.html'], components: [{ id: 'entry', htmlPath: 'entry.html', cssPath: 'entry.css', scriptPath: 'entry.js' }] };
  const project = createProject(input, crew(), { flightRevision: 2 }); assert.deepEqual(project.runtime, input.runtime);
  for (const mutate of [
    value => { value.runtime.components[0].id = 'invented'; },
    value => { value.runtime.components[0].htmlPath = 'entry.js'; },
    value => { value.runtime.shellPaths.push('entry.js'); },
    value => { value.runtime.components[0].scriptPath = 'missing.js'; },
    value => { value.runtime.shellPaths = ['entry.js']; },
  ]) { const bad = structuredClone(input); mutate(bad); assert.throws(() => createProject(bad, crew(), { flightRevision: 2 }), code('INVALID_PROJECT')); }
});

async function httpFixture(t, options = {}) {
  const fixtureValue = fixture(t);
  const handler = createArtifactStreamHandler({ store: fixtureValue.store, heartbeatMs: 50, ...options });
  const server = createServer((req, res) => void handler.handle(req, res));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/heartofgold/artifacts`;
  const post = (path, value, headers = {}) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  return { ...fixtureValue, post, base };
}
function eventReader(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
  return { cancel: () => reader.cancel(), async next() {
    for (;;) {
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const part = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const type = part.match(/^event: (.+)$/m)?.[1], data = part.match(/^data: (.+)$/m)?.[1];
        if (type && data) return { type, value: JSON.parse(data) };
      }
      const chunk = await reader.read(); if (chunk.done) return null; buffer += decoder.decode(chunk.value, { stream: true });
    }
  } };
}

test('HTTP stream delivers initial snapshot then actual artifact write without model polling or cookies', async t => {
  const { opened, post, batch } = await httpFixture(t);
  const response = await post('events', { flightId: opened.flight.id, readToken: opened.readToken, afterRevision: 2 }, { Origin: 'https://projectforty2-ai.web-sandbox.oaiusercontent.com' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://projectforty2-ai.web-sandbox.oaiusercontent.com');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  const stream = eventReader(response); t.after(() => stream.cancel());
  const initial = await stream.next(); assert.equal(initial.type, 'snapshot'); assert.equal(initial.value.resync, true);
  assert.equal(initial.value.project.revision, 1); assert(!JSON.stringify(initial).includes(opened.readToken));
  const write = await post('write', batch()); assert.equal(write.status, 200);
  const next = await stream.next(); assert.equal(next.type, 'update'); assert.equal(next.value.resync, false); assert.equal(next.value.project.revision, 2);
  assert(next.value.project.files.some(file => file.content.includes('A real write')));
});

test('artifact HTTP enforces exact origins, body-only capabilities, methods and actual byte limits', async t => {
  const { opened, base, post, batch } = await httpFixture(t);
  for (const origin of ['https://evil.example', 'null', 'https://chatgpt.com.evil.example']) assert.equal((await post('write', batch(), { Origin: origin })).status, 403);
  for (const headers of [{ Cookie: 'session=unrelated' }, { Authorization: 'Bearer unrelated' }]) assert.equal((await post('write', batch(), headers)).status, 400);
  assert.equal((await fetch(`${base}/events?readToken=${opened.readToken}`)).status, 404);
  assert.equal((await fetch(`${base}/events`)).status, 405);
  assert.equal((await post('events', { flightId: opened.flight.id, readToken: 'x'.repeat(43) })).status, 401);
  assert.equal((await post('events', { padding: 'x'.repeat(2048) })).status, 413);
  const preflight = await fetch(`${base}/events`, { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  const denied = await fetch(`${base}/events`, { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } }); assert.equal(denied.status, 403);
});

test('a slow stream is disconnected before buffering source beyond its byte budget', async t => {
  const { store, opened, batch } = fixture(t);
  const handler = createArtifactStreamHandler({ store, maxBufferBytes: 8192 }); t.after(() => handler.close());
  const req = new EventEmitter(); req.url = '/heartofgold/artifacts/events'; req.method = 'POST'; req.headers = { 'content-type': 'application/json' }; req.resume = () => {};
  class Response extends EventEmitter {
    writableLength = 0; destroyed = false; headersSent = false; messages = [];
    setHeader() {} writeHead() { this.headersSent = true; }
    write(value) { this.messages.push(value); this.writableLength += Buffer.byteLength(value); return false; }
    end() { this.emit('close'); } destroy() { this.destroyed = true; this.emit('close'); }
  }
  const res = new Response(); const handling = handler.handle(req, res);
  req.emit('data', Buffer.from(JSON.stringify({ flightId: opened.flight.id, readToken: opened.readToken }))); req.emit('end'); await handling;
  assert.equal(res.messages.length, 1);
  res.writableLength = 8000; store.writeArtifacts(batch());
  assert.equal(res.destroyed, true); assert.equal(res.messages.length, 1, 'over-budget update was not queued');
  const subscribers = [store.subscribe(opened.flight.id, opened.readToken, () => {}), store.subscribe(opened.flight.id, opened.readToken, () => {})];
  subscribers.forEach(subscriber => subscriber.unsubscribe());
});
