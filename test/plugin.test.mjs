import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrew, showFlight, flightSnapshotSchema, PRESETS, MAX_PLUGIN_BODY_BYTES } from '../lib/crew-contract.mjs';
import { createPluginHandler, FLIGHT_RESOURCE_URI, FLIGHT_RESOURCE_MIME } from '../lib/plugin.mjs';

const requestInput = snapshot => {
  const { schemaVersion, view, capabilities, provenance, flight, unchanged, ...input } = snapshot;
  if (!input.summary) delete input.summary;
  return input;
};
const plan = () => requestInput(buildCrew({ mission: 'Compare two approaches with evidence.', crewSize: 3 }));
const writer = snapshot => ({ flightId: snapshot.flight.id, writeToken: snapshot.flight.writeToken, expectedRevision: snapshot.flight.revision });
const reader = result => ({ flightId: result.structuredContent.flight.id, readToken: result._meta.flight.readToken });
const draft = snapshot => ({ mission: snapshot.mission, deliverable: snapshot.deliverable, constraints: snapshot.constraints,
  members: snapshot.members.map(({ id, parentId, name, role, task, output }) => ({ id, parentId, name, role, task, output })) });

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

test('preselected execution modes on untouched plans normalize to editable unstarted crews', () => {
  for (const execution of ['guided_passes', 'native_agents']) {
    const input = plan(); input.execution = execution;
    input.members[1].task = 'Review the welcome README when the user authorizes work.';
    const before = structuredClone(input);
    const output = showFlight(input);
    assert.equal(output.execution, 'not_started'); assert.equal(output.view, 'builder'); assert.equal(output.status, 'planned');
    assert.deepEqual(output.members, input.members); assert.deepEqual(input, before);
  }
  const working = plan(); working.execution = 'guided_passes'; working.status = 'working'; working.members[0].status = 'working';
  const receipt = showFlight(working);
  assert.equal(receipt.execution, 'guided_passes'); assert.equal(receipt.view, 'report');
});

test('planned snapshots cannot discard results or worker evidence through normalization', () => {
  const resultBearing = plan(); resultBearing.execution = 'guided_passes'; resultBearing.members[1].result = 'A reported prior contribution.';
  assert.throws(() => showFlight(resultBearing), /planned flight cannot contain results or worker IDs/);
  const workerBearing = plan(); workerBearing.execution = 'native_agents'; workerBearing.members[1].workerId = 'actual-host-worker';
  assert.throws(() => showFlight(workerBearing), /planned flight cannot contain results or worker IDs/);
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

test('MCP creates only one render tool; updates are UI-less and app polling tools require capabilities', async t => {
  const { rpc } = await fixture(t);
  const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initialized.response.status, 200); assert.equal(initialized.value.result.serverInfo.name, 'heart-of-gold');
  assert.equal(initialized.value.result.serverInfo.version, '0.4.1');
  assert.equal(initialized.response.headers.get('mcp-session-id'), null); assert.equal(initialized.response.headers.get('set-cookie'), null);
  const listed = await rpc('tools/list');
  assert.deepEqual(listed.value.result.tools.map(tool => tool.name), ['build_crew', 'show_flight', 'read_flight', 'save_plan']);
  for (const tool of listed.value.result.tools) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'noauth' }]);
    assert.equal(tool.annotations.readOnlyHint, tool.name === 'read_flight'); assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.annotations.idempotentHint, tool.name === 'read_flight');
    assert.equal(tool._meta.ui.resourceUri, tool.name === 'build_crew' ? FLIGHT_RESOURCE_URI : undefined); assert(tool.outputSchema);
    assert.deepEqual(tool._meta.ui.visibility, ['read_flight', 'save_plan'].includes(tool.name) ? ['app'] : ['model']);
    assert.equal(tool._meta['openai/outputTemplate'], undefined);
  }
});

test('MCP requests update the same board, isolate capabilities, and never write histories to disk', async t => {
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
    assert(snapshot.flight.writeToken); assert(call.value.result._meta.flight.readToken);
    assert(!JSON.stringify(snapshot).includes(call.value.result._meta.flight.readToken));
    assert(!JSON.stringify(call.value.result.content).includes(snapshot.flight.writeToken));
  }
  const a = calls[0].value.result, b = calls[1].value.result;
  const input = requestInput(a.structuredContent); input.members[1].task = 'An updated assignment.';
  const revised = await rpc('tools/call', { name: 'show_flight', arguments: { ...input, ...writer(a.structuredContent) } });
  assert.equal(revised.value.result.structuredContent.updated, true);
  assert.equal(revised.value.result.structuredContent.flight.id, a.structuredContent.flight.id);
  assert.equal(revised.value.result.structuredContent.flight.revision, 2);
  assert.equal(revised.value.result.structuredContent.members, undefined);
  assert.equal(revised.value.result._meta?.ui, undefined);
  const read = await rpc('tools/call', { name: 'read_flight', arguments: { ...reader(a), afterRevision: 1 } });
  assert.equal(read.value.result.structuredContent.view, 'builder'); assert.equal(read.value.result.structuredContent.members[1].task, 'An updated assignment.');
  assert.equal(read.value.result.structuredContent.flight.writeToken, undefined);
  const noChange = await rpc('tools/call', { name: 'read_flight', arguments: { ...reader(a), afterRevision: 2 } });
  assert.equal(noChange.value.result.structuredContent.unchanged, true); assert.equal(noChange.value.result.structuredContent.members, undefined);
  const denied = await rpc('tools/call', { name: 'read_flight', arguments: { flightId: a.structuredContent.flight.id, readToken: b._meta.flight.readToken } });
  assert.equal(denied.value.result._meta.flightError.code, 'FLIGHT_UNAVAILABLE'); assert.equal(denied.value.result.structuredContent, undefined);
  const untouched = await rpc('tools/call', { name: 'read_flight', arguments: reader(b) });
  assert.equal(untouched.value.result.structuredContent.flight.revision, 1); assert.equal(untouched.value.result.structuredContent.mission, 'PRIVATE-B');
  assert.deepEqual(await readdir(directory), ['flight-deck.html']);
});

test('saved UI drafts persist on the same board and stale writers receive authenticated recovery only', async t => {
  const { rpc } = await fixture(t);
  const created = (await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'Review our welcome README.' } })).value.result;
  const edited = draft(created.structuredContent); edited.members[1].role = 'Newcomer advocate'; edited.constraints = ['Do not browse.'];
  const saved = await rpc('tools/call', { name: 'save_plan', arguments: { ...writer(created.structuredContent), plan: edited } });
  assert.equal(saved.value.result.structuredContent.flight.revision, 2); assert.equal(saved.value.result.structuredContent.execution, 'not_started');
  assert.equal(saved.value.result.structuredContent.members[1].role, 'Newcomer advocate'); assert.equal(saved.value.result.structuredContent.flight.writeToken, undefined);
  const stale = await rpc('tools/call', { name: 'show_flight', arguments: { ...requestInput(created.structuredContent), ...writer(created.structuredContent) } });
  assert.equal(stale.value.result.isError, true); assert.equal(stale.value.result._meta.flightError.code, 'FLIGHT_CONFLICT');
  assert.equal(stale.value.result.structuredContent.flight.revision, 2);
  assert.equal(stale.value.result.structuredContent.currentSnapshot.members[1].role, 'Newcomer advocate');
  assert.deepEqual(stale.value.result.structuredContent.currentSnapshot.constraints, ['Do not browse.']);
  assert(!JSON.stringify(stale.value.result).includes(created.structuredContent.flight.writeToken));
  const invalid = await rpc('tools/call', { name: 'show_flight', arguments: { ...requestInput(created.structuredContent), ...writer(created.structuredContent), writeToken: 'x'.repeat(43) } });
  assert.equal(invalid.value.result._meta.flightError.code, 'FLIGHT_UNAVAILABLE'); assert.equal(invalid.value.result.structuredContent, undefined);
  const working = requestInput(saved.value.result.structuredContent); working.execution = 'guided_passes'; working.status = 'working'; working.members[0].status = 'working';
  const updated = await rpc('tools/call', { name: 'show_flight', arguments: { ...working, ...writer(created.structuredContent), expectedRevision: 2 } });
  assert.equal(updated.value.result.structuredContent.flight.revision, 3);
  const busy = await rpc('tools/call', { name: 'save_plan', arguments: { ...writer(created.structuredContent), expectedRevision: 3, plan: edited } });
  assert.equal(busy.value.result._meta.flightError.code, 'FLIGHT_BUSY');
});

test('board expiration is fixed across MCP requests and only explicit valid capabilities can poll', async t => {
  let now = 0;
  const { rpc } = await fixture(t, { storeOptions: { now: () => now, ttlMs: 1000 } });
  const created = (await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'An expiring plan.' } })).value.result;
  const beforeExpiry = created.structuredContent.flight.expiresAt;
  now = 999;
  const read = await rpc('tools/call', { name: 'read_flight', arguments: reader(created) });
  assert.equal(read.value.result.structuredContent.flight.expiresAt, beforeExpiry);
  now = 1000;
  const expired = await rpc('tools/call', { name: 'read_flight', arguments: reader(created) });
  assert.equal(expired.value.result._meta.flightError.code, 'FLIGHT_UNAVAILABLE');
  assert.equal(expired.value.result.structuredContent, undefined);
  const missing = await rpc('tools/call', { name: 'read_flight', arguments: { flightId: created.structuredContent.flight.id } });
  assert.equal(missing.value.result.isError, true);
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

test('v6 is the rendering cache key while earlier resources remain readable aliases', async t => {
  const { rpc } = await fixture(t);
  assert.equal(FLIGHT_RESOURCE_URI, 'ui://heart-of-gold/flight-deck-v6.html');
  const listed = (await rpc('resources/list')).value.result.resources;
  assert.deepEqual(listed.map(resource => resource.uri), [FLIGHT_RESOURCE_URI, 'ui://heart-of-gold/flight-deck-v1.html', 'ui://heart-of-gold/flight-deck-v2.html', 'ui://heart-of-gold/flight-deck-v3.html', 'ui://heart-of-gold/flight-deck-v4.html', 'ui://heart-of-gold/flight-deck-v5.html']);
  const outputs = await Promise.all(listed.map(resource => rpc('resources/read', { uri: resource.uri })));
  for (const [index, output] of outputs.entries()) {
    assert.equal(output.value.result.contents[0].uri, listed[index].uri);
    assert.equal(output.value.result.contents[0].mimeType, FLIGHT_RESOURCE_MIME);
    assert.equal(output.value.result.contents[0].text, outputs[0].value.result.contents[0].text);
  }
  const tools = (await rpc('tools/list')).value.result.tools;
  assert.deepEqual(tools.filter(tool => tool._meta.ui.resourceUri).map(tool => tool._meta.ui.resourceUri), [FLIGHT_RESOURCE_URI]);
});

test('MCP malformed tool arguments fail instead of rendering invented execution', async t => {
  const { rpc } = await fixture(t);
  const created = (await rpc('tools/call', { name: 'build_crew', arguments: { mission: 'A validation plan.' } })).value.result.structuredContent;
  const bad = plan(); bad.execution = 'native_agents'; bad.status = 'working'; bad.members[1].status = 'working';
  const result = await rpc('tools/call', { name: 'show_flight', arguments: { ...bad, ...writer(created) } });
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
