import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, projectSnapshotSchema, MAX_PROJECT_FILE_BYTES } from '../lib/project-contract.mjs';
import { FlightStore } from '../lib/flight-store.mjs';

const crew = () => ({ mission: 'Build a working task list.', execution: 'guided_passes', status: 'working', members: [
  { id: 'lead', parentId: null, status: 'working' }, { id: 'builder', parentId: 'lead', status: 'working' },
] });
const input = () => ({ title: 'A small task list', entrypoint: 'index.html', files: [
  { path: 'index.html', content: '<!doctype html>\n<button id="add">Add</button>\n<script src="app.js"></script>\n', memberId: 'builder', summary: 'Add the real task-list entrypoint.' },
  { path: 'app.js', content: 'document.querySelector("#add").onclick=()=>document.body.append("New task");\n', memberId: 'builder' },
], checks: [{ name: 'Browser interaction', status: 'not_run', details: 'No browser interaction has been performed.', memberId: 'lead' }] });
const code = expected => error => error.code === expected;

test('project receipts preserve exact authored text and derive hashes, changes and revision-bound checks', () => {
  const project = createProject(input(), crew(), { flightRevision: 2, now: 0 });
  assert(projectSnapshotSchema.safeParse(project).success);
  assert.equal(project.files[0].content, input().files[0].content);
  assert.equal(project.files[0].sha256, createHash('sha256').update(input().files[0].content).digest('hex'));
  assert.equal(project.files[0].bytes, Buffer.byteLength(input().files[0].content));
  assert.equal(project.files[1].language, 'javascript'); assert.equal(project.revision, 1);
  assert.equal(project.basedOnFlightRevision, 2); assert.equal(project.updatedAt, '1970-01-01T00:00:00.000Z');
  assert.equal(project.provenance.verified, false); assert.equal(project.checks[0].status, 'not_run');
  assert.equal(project.checks[0].projectRevision, 1); assert.equal(project.checks[0].sourceDigest, project.sourceDigest);
  assert.deepEqual(project.changes.map(change => change.operation), ['added', 'added']);
  const next = input(); next.files[0].content += '<p>Changed</p>'; next.files.pop(); next.checks = [];
  const revised = createProject(next, { ...crew(), project }, { flightRevision: 3, now: 1 });
  assert.equal(revised.revision, 2); assert.notEqual(revised.sourceDigest, project.sourceDigest);
  assert.deepEqual(revised.changes.map(change => [change.path, change.operation]), [['index.html', 'modified'], ['app.js', 'deleted']]);
  assert.equal(revised.changes[1].memberId, undefined); assert.deepEqual(revised.checks, []);
  assert(!JSON.stringify(revised).includes(input().files[1].content));
});

test('artifact attribution cannot invent native workers or work on an unstarted crew', () => {
  assert.throws(() => createProject(input(), { ...crew(), execution: 'not_started' }, { flightRevision: 1 }), code('INVALID_PROJECT'));
  const missing = input(); missing.files[0].memberId = 'missing';
  assert.throws(() => createProject(missing, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  const planned = crew(); planned.members[1].status = 'planned';
  assert.throws(() => createProject(input(), planned, { flightRevision: 1 }), code('INVALID_PROJECT'));
  const native = crew(); native.execution = 'native_agents'; native.members[1].workerId = 'actual-worker-123';
  assert.throws(() => createProject(input(), native, { flightRevision: 1 }), code('INVALID_PROJECT'));
  const authored = input(); authored.files.forEach(file => { file.workerId = 'actual-worker-123'; });
  assert.doesNotThrow(() => createProject(authored, native, { flightRevision: 1 }));
  authored.files[0].workerId = 'invented'; assert.throws(() => createProject(authored, native, { flightRevision: 1 }), code('INVALID_PROJECT'));
  assert.throws(() => createProject(authored, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
});

test('unchanged files keep historical authorship after crew edits, but changed content cannot borrow it', () => {
  const project = createProject(input(), crew(), { flightRevision: 2 });
  const nextCrew = { ...crew(), project, members: [crew().members[0], { id: 'new-builder', parentId: 'lead', status: 'working' }] };
  const carried = input(); carried.files.push({ path: 'README.md', content: 'Usage instructions.', memberId: 'new-builder' });
  const updated = createProject(carried, nextCrew, { flightRevision: 3 });
  assert.equal(updated.files[0].memberId, 'builder');
  assert.deepEqual(updated.changes.map(change => change.path), ['README.md']);
  carried.files[0].content += '<p>Changed by somebody else</p>';
  assert.throws(() => createProject(carried, nextCrew, { flightRevision: 3 }), code('INVALID_PROJECT'));
});

test('relative text paths, unique names, entrypoints and safe links are enforced without fetching', () => {
  for (const path of ['/etc/passwd.txt', '../secret.txt', 'a/../b.js', 'C:/file.js', 'a\\b.js', '.env.txt', 'a/.hidden/file.js', 'x.svg', 'x.exe', 'a\n.js']) {
    const value = input(); value.files[1].path = path;
    assert.throws(() => createProject(value, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  }
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:secret@example.com']) {
    assert.throws(() => createProject({ ...input(), links: { preview: url } }, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  }
  const duplicate = input(); duplicate.files.push({ ...duplicate.files[0], path: 'INDEX.HTML' });
  assert.throws(() => createProject(duplicate, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  assert.throws(() => createProject({ ...input(), entrypoint: 'app.js' }, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  const linked = createProject({ ...input(), sourceRevision: 'actual-workspace-commit', links: { repository: 'https://github.com/example/project', preview: 'https://example.com/preview' } }, crew(), { flightRevision: 1 });
  assert.equal(linked.links.preview, 'https://example.com/preview');
});

test('UTF-8/project bounds and obvious credentials fail safely without exposing content', () => {
  for (const content of ['x'.repeat(MAX_PROJECT_FILE_BYTES + 1), '🪐'.repeat(MAX_PROJECT_FILE_BYTES / 4 + 1), 'nul\0byte', '-----BEGIN PRIVATE KEY-----\nprivate-sentinel\n-----END PRIVATE KEY-----']) {
    const value = input(); value.files[1].content = content;
    assert.throws(() => createProject(value, crew(), { flightRevision: 1 }), error => error.code === 'INVALID_PROJECT' && !error.message.includes('private-sentinel'));
  }
  const huge = input(); huge.files = Array.from({ length: 5 }, (_, index) => ({ path: `${index}.txt`, content: 'x'.repeat(60000), memberId: 'builder' })); delete huge.entrypoint;
  assert.throws(() => createProject(huge, crew(), { flightRevision: 1 }), code('PROJECT_TOO_LARGE'));
  const tooMany = input(); tooMany.files = Array.from({ length: 25 }, (_, index) => ({ path: `${index}.txt`, content: '', memberId: 'builder' })); delete tooMany.entrypoint;
  assert.throws(() => createProject(tooMany, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  const unknown = { ...input(), execute: 'node app.js' };
  assert.throws(() => createProject(unknown, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
});

test('project transactions share CAS/capabilities/TTL and survive crew-only writes atomically', t => {
  let now = 0; const store = new FlightStore({ now: () => now, ttlMs: 1000 }); t.after(() => store.close());
  const a = store.create(crew()), b = store.create(crew());
  assert.throws(() => store.updateProject(a.flight.id, b.flight.writeToken, 1, input()), code('FLIGHT_UNAVAILABLE'));
  const authored = store.updateProject(a.flight.id, a.flight.writeToken, 1, input());
  assert.equal(authored.flight.revision, 2); assert.equal(authored.snapshot.project.revision, 1);
  assert.equal(store.read(b.flight.id, b.readToken).snapshot.project, undefined);
  const failed = input(); failed.files[0].memberId = 'wrong';
  const before = store.stats;
  assert.throws(() => store.updateProject(a.flight.id, a.flight.writeToken, 2, failed), code('INVALID_PROJECT'));
  assert.deepEqual(store.stats, before); assert.equal(store.read(a.flight.id, a.readToken).flight.revision, 2);
  assert.throws(() => store.updateProject(a.flight.id, a.flight.writeToken, 1, input()), error => error.code === 'FLIGHT_CONFLICT' && error.recovery.currentSnapshot.project.files[0].content === input().files[0].content);
  now = 800;
  const progressed = store.update(a.flight.id, a.flight.writeToken, 2, { ...crew(), mission: 'Progressed', project: { forged: true } });
  assert.deepEqual(progressed.snapshot.project, authored.snapshot.project);
  const saved = store.update(a.flight.id, a.flight.writeToken, 3, { ...crew(), status: 'complete' });
  const draft = store.update(a.flight.id, a.flight.writeToken, 4, { ...crew(), status: 'planned', execution: 'not_started' }, { editableOnly: true });
  assert.deepEqual(draft.snapshot.project, saved.snapshot.project); assert.equal(draft.flight.expiresAt, a.flight.expiresAt);
  now = 1000;
  assert.throws(() => store.read(a.flight.id, a.readToken), code('FLIGHT_UNAVAILABLE')); assert.equal(store.stats.bytes, 0);
});

test('project aggregate capacity failure leaves the old project and revision intact', t => {
  const store = new FlightStore({ maxTotalBytes: 5000 }); t.after(() => store.close()); const a = store.create(crew());
  const first = store.updateProject(a.flight.id, a.flight.writeToken, 1, input()); const before = store.stats;
  const larger = input(); larger.files[1].content = 'x'.repeat(4500);
  assert.throws(() => store.updateProject(a.flight.id, a.flight.writeToken, 2, larger), code('FLIGHT_CAPACITY'));
  assert.deepEqual(store.stats, before); assert.deepEqual(store.read(a.flight.id, a.readToken).snapshot.project, first.snapshot.project);
});
