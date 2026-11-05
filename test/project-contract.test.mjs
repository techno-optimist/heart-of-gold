import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProject, projectSnapshotSchema, MAX_PROJECT_FILE_BYTES, MAX_COMPONENT_EVENT_BYTES } from '../lib/project-contract.mjs';
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

const componentInput = () => ({ ...input(), components: [
  { id: 'task-form', label: 'Task form', memberId: 'builder', filePaths: ['index.html'] },
  { id: 'task-actions', label: 'Task actions', memberId: 'builder', filePaths: ['app.js'] },
], changedComponentIds: ['task-form', 'task-actions'] });

test('component checkpoints derive events from actual file changes, while metadata keeps the same source identity', () => {
  const first = createProject(componentInput(), crew(), { flightRevision: 2, now: 10 });
  assert.equal(first.components.length, 2); assert.equal(first.events.length, 2);
  assert.deepEqual(first.events.map(event => [event.seq, event.componentId, event.changedPaths]), [[1, 'task-form', ['index.html']], [2, 'task-actions', ['app.js']]]);
  assert.equal(first.events[0].flightRevision, 3); assert.equal(first.events[0].projectRevision, 1);
  assert.equal(first.events[0].at, '1970-01-01T00:00:00.010Z');
  assert.equal(first.events[0].sourceDigest, first.sourceDigest); assert.equal(first.events[0].kind, 'component.updated');
  assert.equal(first.changedComponentIds, undefined); assert(!JSON.stringify(first.events).includes(first.files[0].content));
  const metadata = input(); metadata.title = 'A revised project label'; metadata.checks = [];
  const second = createProject(metadata, { ...crew(), project: first }, { flightRevision: 3, now: 20 });
  assert.equal(second.revision, 2); assert.equal(second.sourceDigest, first.sourceDigest);
  assert.deepEqual(second.components, first.components); assert.deepEqual(second.events, first.events); assert.deepEqual(second.changes, []);
  const checkpoint = input(); checkpoint.files[1].content += 'document.body.dataset.ready="yes";'; checkpoint.changedComponentIds = ['task-actions'];
  const third = createProject(checkpoint, { ...crew(), project: second }, { flightRevision: 4, now: 30 });
  assert.equal(third.events.length, 3); assert.equal(third.events.at(-1).seq, 3);
  assert.equal(third.events.at(-1).componentId, 'task-actions'); assert.deepEqual(third.events.at(-1).changedPaths, ['app.js']);
  assert.equal(third.components[0].sourceDigest, first.components[0].sourceDigest);
  assert.notEqual(third.components[1].sourceDigest, first.components[1].sourceDigest);
});

test('component declarations cannot fabricate activity, arbitrary selectors, or unsupported mappings', () => {
  const first = createProject(componentInput(), crew(), { flightRevision: 1 });
  assert.throws(() => createProject(componentInput(), { ...crew(), project: first }, { flightRevision: 2 }), code('INVALID_PROJECT'));
  for (const modify of [
    value => { value.changedComponentIds = ['missing']; },
    value => { value.changedComponentIds = ['task-form', 'task-form']; },
    value => { value.components[1].id = 'task-form'; },
    value => { value.components[0].filePaths = ['missing.html']; },
    value => { value.components[0].filePaths = ['index.html', 'index.html']; },
    value => { value.components[0].selector = 'body *'; },
    value => { value.components[0].id = 'unsafe"] body'; },
    value => { value.components[0].memberId = 'unknown-worker'; },
    value => { value.components = Array.from({ length: 13 }, (_, i) => ({ id: `component-${i}`, label: 'Part', memberId: 'builder', filePaths: ['index.html'] })); },
  ]) {
    const value = componentInput(); modify(value);
    assert.throws(() => createProject(value, crew(), { flightRevision: 1 }), code('INVALID_PROJECT'));
  }
  const unrelated = input(); unrelated.files[1].content += '/* changed */'; unrelated.changedComponentIds = ['task-form'];
  assert.throws(() => createProject(unrelated, { ...crew(), project: first }, { flightRevision: 2 }), code('INVALID_PROJECT'));
});

test('component mapping retention is explicit when files disappear and historical owners cannot author new changes', () => {
  const first = createProject(componentInput(), crew(), { flightRevision: 1 });
  const removed = input(); removed.files.pop();
  assert.throws(() => createProject(removed, { ...crew(), project: first }, { flightRevision: 2 }), code('INVALID_PROJECT'));
  removed.components = []; const cleared = createProject(removed, { ...crew(), project: first }, { flightRevision: 2 });
  assert.deepEqual(cleared.components, []); assert.deepEqual(cleared.events, first.events);
  const nextCrew = { ...crew(), project: first, members: [crew().members[0], { id: 'new-builder', parentId: 'lead', status: 'working' }] };
  const retained = createProject(input(), nextCrew, { flightRevision: 2 });
  assert.equal(retained.components[0].memberId, 'builder');
  const changed = input(); changed.files[0].content += '<p>New content</p>'; changed.files[0].memberId = 'new-builder'; changed.changedComponentIds = ['task-form'];
  assert.throws(() => createProject(changed, nextCrew, { flightRevision: 2 }), code('INVALID_PROJECT'));
  changed.components = componentInput().components; changed.components[0].memberId = 'new-builder';
  const updated = createProject(changed, nextCrew, { flightRevision: 2 });
  assert.equal(updated.events.at(-1).memberId, 'new-builder');
});

test('component events retain only bounded metadata with monotonic sequence across skipped polls', () => {
  let current = crew();
  for (let i = 1; i <= 70; i++) {
    const value = componentInput(); value.files[0].content = `<p data-hog-component="task-form">Checkpoint ${i}</p>`;
    value.changedComponentIds = ['task-form'];
    current = { ...current, project: createProject(value, current, { flightRevision: i, now: i }) };
  }
  assert.equal(current.project.events.length, 64); assert.equal(current.project.events[0].seq, 7); assert.equal(current.project.events.at(-1).seq, 70);
  assert(current.project.files[0].content.includes('Checkpoint 70')); assert(!JSON.stringify(current.project.events).includes('Checkpoint 1'));
  assert(Buffer.byteLength(JSON.stringify(current.project.events)) <= MAX_COMPONENT_EVENT_BYTES);
  let large = crew();
  for (let i = 1; i <= 15; i++) {
    const files = Array.from({ length: 24 }, (_, index) => ({ path: `file-${index}-${'x'.repeat(140)}.txt`, content: String(i), memberId: 'builder' }));
    const value = { title: 'Long path receipts', files, checks: [], components: [{ id: 'all-files', label: 'Files', memberId: 'builder', filePaths: files.map(file => file.path) }], changedComponentIds: ['all-files'] };
    large = { ...large, project: createProject(value, large, { flightRevision: i, now: i }) };
  }
  assert(large.project.events.length < 15); assert.equal(large.project.events.at(-1).seq, 15);
  assert(Buffer.byteLength(JSON.stringify(large.project.events)) <= MAX_COMPONENT_EVENT_BYTES);
});

test('component receipts use the same atomic CAS and cannot advance on rejected writes or crew status updates', t => {
  const store = new FlightStore(); t.after(() => store.close()); const a = store.create(crew());
  const first = store.updateProject(a.flight.id, a.flight.writeToken, 1, componentInput());
  const checkpoint = input(); checkpoint.files[1].content += '/* real edit */'; checkpoint.changedComponentIds = ['task-actions'];
  assert.throws(() => store.updateProject(a.flight.id, a.flight.writeToken, 1, checkpoint), code('FLIGHT_CONFLICT'));
  const before = store.read(a.flight.id, a.readToken); assert.deepEqual(before.snapshot.project.events, first.snapshot.project.events);
  const statusOnly = store.update(a.flight.id, a.flight.writeToken, 2, { ...crew(), status: 'complete' });
  assert.deepEqual(statusOnly.snapshot.project, first.snapshot.project);
  const updated = store.updateProject(a.flight.id, a.flight.writeToken, 3, checkpoint);
  assert.equal(updated.snapshot.project.events.at(-1).seq, 3); assert.equal(updated.snapshot.project.events.at(-1).flightRevision, 4);
});
