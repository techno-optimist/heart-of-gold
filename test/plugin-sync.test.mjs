import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
const source = await readFile(new URL('../plugins/heart-of-gold/ui/app.js', import.meta.url), 'utf8');
// Exercise the production read functions without mounting the unrelated UI.
const names = ['rememberFlight', 'safeSyncDiagnostic', 'recordReadFailure', 'applyReadResult', 'pollFlight'];
const functions = names.map(name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
function harness() {
  const deck = { dataset: {} }, requests = [];
  const state = { flight: { id: 'flight', revision: 1, readToken: 'not-shared', expiresAt: '2099-01-01T00:00:00Z' }, remoteSignature: 'old', connected: true, sync: 'waiting', pollFailures: 0, unchangedReads: 0 };
  const context = { state, document: { hidden: false }, $: () => deck, render: () => {}, notify: () => {}, stopPolling: () => {}, schedulePoll: () => { context.scheduled = true; }, resultError: () => new Error('server error'), refreshSyncLabel: () => { if (context.failRefresh && state.sync === 'watching') throw new TypeError('private render detail'); }, receiveSnapshot: () => { state.remoteSignature = 'new'; if (context.failApply) throw new TypeError('private snapshot detail'); }, app: { callServerTool: async request => { requests.push(request.arguments.afterRevision); if (context.requestError) throw context.requestError; return context.response; } } };
  context.response = { structuredContent: { flight: { id: 'flight', revision: 2, expiresAt: state.flight.expiresAt }, unchanged: false } };
  new Script(functions).runInNewContext(context);
  return { context, state, deck, requests };
}

test('failed snapshot application retries the unacknowledged revision', async () => {
  const { context, state, deck, requests } = harness(); context.failApply = true;
  await context.pollFlight();
  assert.equal(state.flight.revision, 1); assert.equal(state.remoteSignature, 'old');
  assert.equal(deck.dataset.syncDiagnostic, 'apply:TypeError'); assert.equal(context.scheduled, true);
  context.failApply = false; await context.pollFlight();
  assert.deepEqual(requests, [1, 1]); assert.equal(state.flight.revision, 2); assert.equal(state.sync, 'watching');
});

test('unchanged-response refresh failure remains retryable and cannot stop polling', async () => {
  const { context, state, deck } = harness();
  context.response.structuredContent.flight.revision = 1; context.response.structuredContent.unchanged = true; context.failRefresh = true;
  await context.pollFlight();
  assert.equal(state.flight.revision, 1); assert.equal(deck.dataset.syncDiagnostic, 'apply:TypeError');
  assert.equal(state.pollFailures, 1); assert.equal(context.scheduled, true);
  context.failRefresh = false; await context.pollFlight(); assert.equal(state.sync, 'watching');
});

test('diagnostics expose only a fixed phase and numeric code or allowlisted class', async () => {
  const { context, deck } = harness(); context.requestError = { code: -32001, message: 'private token and payload' };
  await context.pollFlight(); assert.equal(deck.dataset.syncDiagnostic, 'request:-32001');
  assert.equal(context.safeSyncDiagnostic({ code: 'private token', name: 'private payload', message: 'secret' }, 'arbitrary phase'), 'apply:Error');
  assert.equal(context.safeSyncDiagnostic({ code: 'REQUEST_TIMEOUT' }, 'request'), 'request:timeout');
  assert.equal(JSON.stringify(deck).includes('private'), false);
});
