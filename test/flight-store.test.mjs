import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightStore } from '../lib/flight-store.mjs';

const snapshot = value => ({ status: 'planned', mission: value });
const code = expected => error => error.code === expected;

test('flight read and write capabilities are separate, unguessable and scoped to one board', t => {
  const store = new FlightStore(); t.after(() => store.close());
  const a = store.create(snapshot('private-a')), b = store.create(snapshot('private-b'));
  assert.match(a.flight.id, /^[a-f0-9]{32}$/); assert.match(a.flight.writeToken, /^[A-Za-z0-9_-]{43}$/); assert.match(a.readToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.readToken, a.flight.writeToken); assert.notEqual(a.flight.id, b.flight.id);
  assert.throws(() => store.read(a.flight.id, b.readToken), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.read(a.flight.id, a.flight.writeToken), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.update(a.flight.id, a.readToken, 1, snapshot('stolen')), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.update(a.flight.id, b.flight.writeToken, 1, snapshot('stolen')), code('FLIGHT_UNAVAILABLE'));
  assert.equal(store.read(a.flight.id, a.readToken).snapshot.mission, 'private-a');
  assert(!JSON.stringify(store).includes('private-a')); assert(!JSON.stringify(store).includes(a.readToken));
});

test('reads return copies or an unchanged marker without exposing capability material', t => {
  const store = new FlightStore(); t.after(() => store.close());
  const original = snapshot('original'); const a = store.create(original); original.mission = 'mutated';
  a.snapshot.mission = 'mutated-result';
  const read = store.read(a.flight.id, a.readToken);
  assert.equal(read.snapshot.mission, 'original'); read.snapshot.mission = 'mutated-read';
  assert.equal(store.read(a.flight.id, a.readToken).snapshot.mission, 'original');
  const unchanged = store.read(a.flight.id, a.readToken, 1);
  assert.equal(unchanged.unchanged, true); assert.equal(unchanged.snapshot, undefined);
  assert(!JSON.stringify(read).includes(a.flight.writeToken)); assert(!JSON.stringify(read).includes(a.readToken));
});

test('fixed expiration is not extended by polling or writes and releases memory', t => {
  let now = 0; const store = new FlightStore({ now: () => now, ttlMs: 1000 }); t.after(() => store.close());
  const a = store.create(snapshot('temporary')); const expiresAt = a.flight.expiresAt;
  now = 500; store.read(a.flight.id, a.readToken);
  now = 999; const update = store.update(a.flight.id, a.flight.writeToken, 1, snapshot('updated'));
  assert.equal(update.flight.expiresAt, expiresAt); assert.equal(store.stats.flights, 1);
  now = 1000;
  assert.throws(() => store.read(a.flight.id, a.readToken), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.update(a.flight.id, a.flight.writeToken, 2, snapshot('revive')), code('FLIGHT_UNAVAILABLE'));
  assert.deepEqual(store.stats, { flights: 0, bytes: 0 });
});

test('capacity rejects allocations without evicting valid flights, then recovers after expiry', t => {
  let now = 0; const store = new FlightStore({ now: () => now, ttlMs: 1000, maxFlights: 1 }); t.after(() => store.close());
  const a = store.create(snapshot('keep'));
  assert.throws(() => store.create(snapshot('new')), code('FLIGHT_CAPACITY'));
  assert.equal(store.read(a.flight.id, a.readToken).snapshot.mission, 'keep');
  now = 1000; const b = store.create(snapshot('new')); assert.notEqual(a.flight.id, b.flight.id);
  assert.equal(store.stats.flights, 1);
});

test('snapshot and aggregate memory limits count UTF-8 bytes and failed writes stay atomic', t => {
  const store = new FlightStore({ maxSnapshotBytes: 100, maxTotalBytes: 120 }); t.after(() => store.close());
  const a = store.create(snapshot('a')), b = store.create(snapshot('b'));
  const before = store.stats;
  assert.throws(() => store.update(a.flight.id, a.flight.writeToken, 1, snapshot('x'.repeat(90))), code('FLIGHT_TOO_LARGE'));
  assert.throws(() => store.update(a.flight.id, a.flight.writeToken, 1, snapshot('🪐'.repeat(20))), code('FLIGHT_TOO_LARGE'));
  assert.throws(() => store.update(a.flight.id, a.flight.writeToken, 1, snapshot('x'.repeat(60))), code('FLIGHT_CAPACITY'));
  assert.deepEqual(store.stats, before); assert.equal(store.read(a.flight.id, a.readToken).flight.revision, 1);
  assert.equal(store.read(b.flight.id, b.readToken).snapshot.mission, 'b');
});

test('concurrent optimistic writes accept one winner and give only authorized writers recovery data', async t => {
  const store = new FlightStore(); t.after(() => store.close()); const a = store.create(snapshot('original'));
  const results = await Promise.allSettled(['edit-a', 'edit-b'].map(mission => Promise.resolve().then(() => store.update(a.flight.id, a.flight.writeToken, 1, snapshot(mission)))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const conflict = results.find(result => result.status === 'rejected').reason;
  assert.equal(conflict.code, 'FLIGHT_CONFLICT'); assert.equal(conflict.currentRevision, 2);
  assert.equal(conflict.recovery.currentSnapshot.mission, 'edit-a');
  assert(!JSON.stringify(conflict.recovery).includes(a.flight.writeToken)); assert(!JSON.stringify(conflict.recovery).includes(a.readToken));
  conflict.recovery.currentSnapshot.mission = 'tampered';
  assert.equal(store.read(a.flight.id, a.readToken).snapshot.mission, 'edit-a');
  try { store.update(a.flight.id, 'x'.repeat(43), 1, snapshot('attack')); assert.fail(); }
  catch (error) { assert.equal(error.code, 'FLIGHT_UNAVAILABLE'); assert.equal(error.recovery, undefined); assert.equal(error.currentRevision, undefined); }
});

test('draft saving cannot overwrite working state and shutdown clears all temporary data', () => {
  const store = new FlightStore(); const a = store.create({ status: 'working', mission: 'active' });
  assert.throws(() => store.update(a.flight.id, a.flight.writeToken, 1, snapshot('new plan'), { editableOnly: true }), code('FLIGHT_BUSY'));
  assert.equal(store.read(a.flight.id, a.readToken).snapshot.status, 'working');
  store.close(); assert.deepEqual(store.stats, { flights: 0, bytes: 0 });
  assert.throws(() => store.read(a.flight.id, a.readToken), code('FLIGHT_UNAVAILABLE'));
  assert.throws(() => store.create(snapshot('revive')), code('FLIGHT_UNAVAILABLE'));
  const restarted = new FlightStore();
  try { assert.throws(() => restarted.read(a.flight.id, a.readToken), code('FLIGHT_UNAVAILABLE')); }
  finally { restarted.close(); }
});
