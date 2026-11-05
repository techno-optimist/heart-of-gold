import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrew, showFlight, flightSnapshotSchema, PRESETS, MAX_PLUGIN_BODY_BYTES } from '../lib/crew-contract.mjs';
import { createPluginHandler, FLIGHT_RESOURCE_URI, FLIGHT_RESOURCE_MIME } from '../lib/plugin.mjs';

const requestInput = snapshot => {
  const { schemaVersion, view, capabilities, provenance, ...input } = snapshot;
  if (!input.summary) delete input.summary;
  return input;
};
const plan = () => requestInput(buildCrew({ mission: 'Compare two approaches with evidence.', crewSize: 3 }));

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hog-plugin-'));
  const resourcePath = join(directory, 'flight-deck.html');
  await writeFile(resourcePath, '<!doctype html><html><body>Flight deck fixture</body></html>');
  const plugin = await createPluginHandler({ resourcePath, ...options });
  const server = http.createServer((req, res) => { plugin.handle(req, res).catch(() => res.destroy()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/heartofgold/mcp`;
  t.after(async () => { await plugin.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  async function rpc(method, params = {}, extra = {}) {
    const response = await fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', ...extra.headers,
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return { response, value: await response.json() };
  }
  return { plugin, rpc, url, directory };
}

test('all recipes produce deterministic, bounded, unstarted valid crews', () => {
  for (const preset of PRESETS) for (const crewSize of [3, 4, 7]) {
    const input = { mission: 'Make an accessible community handbook.', preset, crewSize };
    const a = buildCrew(input), b = buildCrew(input);
    assert.deepEqual(a, b); assert.equal(a.members.length, crewSize);
    assert.equal(a.view, 'builder'); assert.equal(a.execution, 'not_started');
    assert(a.members.every(member => member.status === 'planned'));
    assert.equal(a.members.filter(member => member.parentId === null).length, 1);
    assert.equal(a.capabilities.callsModels, false); assert.equal(a.provenance.verified, false);
    assert(flightSnapshotSchema.safeParse(a).success);
    assert.equal(showFlight(requestInput(a)).view, 'builder');
    a.members[0].name = 'Changed'; assert.equal(b.members[0].name, 'Deep Thought');
  }
});

test('flight rejects duplicate IDs, missing parents, multiple roots, cycles and excess depth', () => {
  const mutate = fn => { const input = plan(); fn(input.members); assert.throws(() => showFlight(input)); };
  mutate(members => { members[1].id = members[0].id; });
  mutate(members => { members[1].parentId = 'missing'; });
  mutate(members => { members[1].parentId = null; });
  mutate(members => { members[1].parentId = members[2].id; members[2].parentId = members[1].id; });
  mutate(members => { members[1].parentId = members[1].id; });
  const deep = requestInput(buildCrew({ mission: 'Work', crewSize: 4 }));
  deep.members[2].parentId = deep.members[1].id; deep.members[3].parentId = deep.members[2].id;
  assert.throws(() => showFlight(deep));
  deep.members[3].parentId = deep.members[1].id; assert.doesNotThrow(() => showFlight(deep));
});

test('specialized and revised unstarted crews remain editable builder snapshots', () => {
  const revised = plan();
  const ids = revised.members.map(member => member.id);
  revised.members[1].role = 'README newcomer reviewer';
  revised.members[1].task = 'Identify unclear setup steps and the first useful contribution in the supplied welcome README.';
  revised.members[1].output = 'A prioritized list of newcomer obstacles with proposed section headings.';
  revised.constraints = ['Plan only.', 'Use the supplied README; no external services.'];
  const snapshot = showFlight(revised);
  assert.equal(snapshot.view, 'builder'); assert.equal(snapshot.execution, 'not_started'); assert.equal(snapshot.status, 'planned');
  assert.deepEqual(snapshot.members.map(member => member.id), ids);
  assert.deepEqual(snapshot.members, revised.members); assert.deepEqual(snapshot.constraints, revised.constraints);
  const performed = structuredClone(revised);
  performed.execution = 'guided_passes'; performed.status = 'partial'; performed.members[1].status = 'complete';
  performed.members[1].result = 'The supplied draft does not identify a first contribution; other reviews remain undone.';
  assert.equal(showFlight(performed).view, 'report');
});

test('completion requires concrete results and summary; unstarted flights cannot fake work', () => {
  const input = plan(); input.members[1].status = 'complete'; input.members[1].result = 'A finding.';
  assert.throws(() => showFlight(input));
  input.execution = 'guided_passes'; input.status = 'complete';
  assert.throws(() => showFlight(input));
  input.members.forEach(member => { member.status = 'complete'; member.result = 'Observed result.'; });
  assert.throws(() => showFlight(input));
  input.summary = 'A synthesized report.'; assert.equal(showFlight(input).status, 'complete');
  input.members[1].result = ' '; assert.throws(() => showFlight(input));
});

test('native execution requires actual reported worker IDs for started children, never an invented lead ID', () => {
  const input = plan(); input.execution = 'native_agents'; input.status = 'working';
  input.members[0].status = 'working'; input.members[1].status = 'working';
  assert.throws(() => showFlight(input));
  input.members[1].workerId = 'host-returned-worker-123';
  assert.equal(showFlight(input).members[0].workerId, undefined);
  input.execution = 'guided_passes'; assert.throws(() => showFlight(input));
});

test('contract bounds crew sizes, user strings, links and unknown fields', () => {
  for (const crewSize of [0, 2, 8, 3.5]) assert.throws(() => buildCrew({ mission: 'Work', crewSize }));
  assert.throws(() => buildCrew({ mission: 'a'.repeat(6001) }));
  assert.throws(() => buildCrew({ mission: 'Work', token: 'secret' }));
  const input = plan(); input.members.push(...structuredClone(input.members), ...structuredClone(input.members));
  assert.throws(() => showFlight(input));
  for (const url of ['javascript:alert(1)', 'http://example.com', 'data:text/html,hello', 'https://user:password@example.com']) {
    const linked = plan(); linked.members[0].evidence = [{ label: 'Source', url }]; assert.throws(() => showFlight(linked));
  }
  const linked = plan(); linked.members[0].evidence = [{ label: 'Source', url: 'https://example.com/research' }];
  assert.doesNotThrow(() => showFlight(linked));
});

test('partial receipts do not claim continuing work', () => {
  const input = plan(); input.execution = 'guided_passes'; input.status = 'partial'; input.members[0].status = 'waiting';
  assert.throws(() => showFlight(input)); input.members[0].status = 'failed'; assert.doesNotThrow(() => showFlight(input));
});

test('MCP initializes and advertises two no-auth read-only tools without session cookies', async t => {
  const { rpc } = await fixture(t);
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.response.status, 200); assert.equal(initialized.value.result.serverInfo.name, 'heart-of-gold');
  assert.equal(initialized.response.headers.get('mcp-session-id'), null); assert.equal(initialized.response.headers.get('set-cookie'), null);
  const listed = await rpc('tools/list');
  assert.deepEqual(listed.value.result.tools.map(tool => tool.name), ['build_crew', 'show_flight']);
  for (const tool of listed.value.result.tools) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }]);
    assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool._meta.ui.resourceUri, FLIGHT_RESOURCE_URI); assert(tool.outputSchema);
  }
});

test('MCP tool calls render supplied data without crossing visitor state or writing histories', async t => {
  const { rpc, directory } = await fixture(t);
  const calls = await Promise.all(['PRIVATE-A', 'PRIVATE-B'].map(mission => rpc('tools/call', {
    name: 'build_crew', arguments: { mission, crewSize: 3 },
  }, { headers: { Cookie: '__Secure-hog=untrusted-cookie', 'Mcp-Session-Id': 'untrusted-id' } })));
  for (const [index, call] of calls.entries()) {
    assert.equal(call.response.status, 200); assert.equal(call.value.result.isError, undefined);
    const snapshot = call.value.result.structuredContent;
    assert.equal(snapshot.mission, index === 0 ? 'PRIVATE-A' : 'PRIVATE-B');
    assert(!JSON.stringify(snapshot).includes(index === 0 ? 'PRIVATE-B' : 'PRIVATE-A'));
    assert.equal(snapshot.capabilities.persistsHistory, false);
  }
  const revised = await rpc('tools/call', { name: 'show_flight', arguments: requestInput(calls[0].value.result.structuredContent) });
  assert.equal(revised.value.result.structuredContent.view, 'builder');
  assert.deepEqual(await readdir(directory), ['flight-deck.html']);
});

test('MCP resource is self-contained with no network domains', async t => {
  const { rpc } = await fixture(t);
  const list = await rpc('resources/list'); assert.equal(list.value.result.resources[0].uri, FLIGHT_RESOURCE_URI);
  const read = await rpc('resources/read', { uri: FLIGHT_RESOURCE_URI });
  const resource = read.value.result.contents[0];
  assert.equal(resource.mimeType, FLIGHT_RESOURCE_MIME); assert(resource.text.includes('Flight deck fixture'));
  assert.deepEqual(resource._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.equal(resource._meta.ui.domain, 'https://projectforty2.ai');
  assert(!resource.text.includes('PRIVATE-A'));
});

test('MCP malformed tool arguments fail instead of rendering invented execution', async t => {
  const { rpc } = await fixture(t);
  const bad = plan(); bad.execution = 'native_agents'; bad.status = 'working'; bad.members[1].status = 'working';
  const result = await rpc('tools/call', { name: 'show_flight', arguments: bad });
  assert.equal(result.value.result.isError, true); assert.equal(result.value.result.structuredContent, undefined);
  const unknown = await rpc('tools/call', { name: 'spawn_agents', arguments: {} });
  assert(unknown.value.error || unknown.value.result?.isError);
});

test('HTTP rejects unsupported streaming/session methods, malformed JSON and oversized actual bytes', async t => {
  const { url } = await fixture(t);
  for (const method of ['GET', 'DELETE', 'PUT']) assert.equal((await fetch(url, { method })).status, 405);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const malformed = await fetch(url, { method: 'POST', headers, body: '{secret-sentinel-invalid' });
  assert.equal(malformed.status, 400); assert(!(await malformed.text()).includes('secret-sentinel'));
  assert.equal((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(MAX_PLUGIN_BODY_BYTES + 1) })).status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.write('x'.repeat(MAX_PLUGIN_BODY_BYTES)); request.end('more');
  });
  assert.equal(chunked, 413);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/jsonp' }, body: '{}' })).status, 415);
});

test('incomplete bodies time out without exposing partial content', async t => {
  const { url } = await fixture(t, { bodyTimeoutMs: 20 });
  const result = await new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { request.end(); resolve({ status: response.statusCode, body }); });
    });
    request.on('error', reject); request.write('{"secret":"partial-sensitive');
  });
  assert.equal(result.status, 408); assert(!result.body.includes('partial-sensitive'));
});
