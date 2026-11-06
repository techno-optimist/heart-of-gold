import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { normalizeProject, resolveProjectPath, buildPreviewDocument, changedProjectFiles, safeProjectLink } from '../plugins/heart-of-gold/ui/project-preview.mjs';
import { awaitingProjectSource } from '../plugins/heart-of-gold/ui/swarm-adapter.mjs';
import { componentEventsSince, boundedComponentRects, sanitizedComponentGeometry, projectRenderKey, installComponentProbe } from '../plugins/heart-of-gold/ui/component-canvas.mjs';

const fixture = () => ({ revision: 2, title: 'Authored test project', entrypoint: 'index.html', files: [
  { path: 'index.html', memberId: 'builder', content: '<!doctype html><html><head><link rel="stylesheet" href="./styles/site.css"></head><body><button id="add">Add item</button><output id="count">0</output><script src="scripts/app.js"></script></body></html>' },
  { path: 'styles/site.css', memberId: 'builder', content: '@import "./palette.css"; button { color: var(--ink); }' },
  { path: 'styles/palette.css', memberId: 'builder', content: ':root { --ink: rebeccapurple; }' },
  { path: 'scripts/app.js', memberId: 'builder', content: 'let count=0; document.getElementById("add").onclick=()=>document.getElementById("count").textContent=String(++count);' },
], checks: [], changes: [] });

test('preview resolves actual submitted files and preserves authored behavior', () => {
  const project = normalizeProject(fixture(), new Set(['builder']));
  const output = buildPreviewDocument(project, 'test-receipt');
  assert.match(output.html, /--ink: rebeccapurple/);
  assert.match(output.html, /button \{ color: var\(--ink\); \}/);
  assert.ok(output.html.includes(project.files[3].content));
  assert.doesNotMatch(output.html, /<script[^>]+src=/);
  assert.doesNotMatch(output.html, /<link[^>]+stylesheet/);
  const scripts = [...output.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const script of scripts) assert.doesNotThrow(() => new Script(script[1]));
  assert.deepEqual(output.warnings, []);
});

test('preview is network-restricted and cannot receive flight authority', async () => {
  const output = buildPreviewDocument(normalizeProject(fixture()), 'receipt');
  assert.match(output.html, /connect-src &#39;none&#39;/);
  assert.match(output.html, /frame-src &#39;none&#39;/);
  assert.match(output.html, /form-action &#39;none&#39;/);
  assert.doesNotMatch(output.html, /writeToken|readToken|flightId/);
  const ui = await readFile(new URL('../plugins/heart-of-gold/ui/project-preview.mjs', import.meta.url), 'utf8');
  assert.match(ui, /setAttribute\('sandbox', 'allow-scripts allow-forms'\)/);
  assert.doesNotMatch(ui, /allow-same-origin|allow-top-navigation|allow-popups/);
  assert.match(ui, /event\.source === frame\.element\.contentWindow/);
  assert.match(ui, /event\.data\.nonce !== record\.nonce/);
});

test('external dependencies fail visibly without fetching substitutes', () => {
  const project = normalizeProject({ ...fixture(), files: [{ path: 'index.html', memberId: 'builder', content: '<html><head><link rel="stylesheet" href="https://example.com/x.css"></head><body><script src="https://example.com/app.js"></script></body></html>' }] });
  const output = buildPreviewDocument(project, 'receipt');
  assert.equal(output.warnings.length, 2);
  assert.doesNotMatch(output.html, /example\.com/);
  assert.equal(resolveProjectPath('https://example.com/code.js', 'index.html'), null);
  assert.equal(resolveProjectPath('../app.js', 'src/index.html'), 'app.js');
  assert.equal(safeProjectLink('javascript:alert(1)'), null);
  assert.equal(safeProjectLink('https://user:pass@example.com'), null);
});

test('local source edits run separately and do not mutate the reported project', () => {
  const project = normalizeProject(fixture());
  const original = project.files[3].content;
  const drafts = new Map([['scripts/app.js', 'document.title="A local experiment";']]);
  const draft = buildPreviewDocument(project, 'draft', drafts);
  assert.match(draft.html, /A local experiment/);
  assert.equal(project.files[3].content, original);
  assert.deepEqual(changedProjectFiles(project, drafts), [{ path: 'scripts/app.js', content: drafts.get('scripts/app.js') }]);
  assert.ok(buildPreviewDocument(project, 'reported').html.includes(original));
});

test('invalid project file paths, duplicate files, missing entrypoints and byte limits are rejected', () => {
  for (const path of ['../secret.txt', '/absolute.js', 'a/../b.js', 'https://example.com/x.js', 'a\\b.js']) assert.throws(() => normalizeProject({ revision: 1, files: [{ path, content: '', memberId: 'builder' }] }));
  assert.throws(() => normalizeProject({ revision: 1, files: [{ path: 'a.js', content: 'x'.repeat(65537) }] }), /limits/);
  assert.throws(() => normalizeProject({ revision: 1, files: [{ path: 'a.js', content: '' }, { path: 'a.js', content: '' }] }), /repeated/);
  assert.throws(() => buildPreviewDocument({ files: [{ path: 'readme.md', content: '# Hello' }] }, 'receipt'), /no HTML entrypoint/);
});

test('historical file contributor IDs survive later crew-plan changes', () => {
  const project = normalizeProject(fixture(), new Set(['new-crew']));
  assert.equal(project.files[0].memberId, 'builder');
  assert.ok(project.files[0].content.includes('Add item'));
});

test('classic head defer scripts run after authored body elements, in declaration order', () => {
  const project = normalizeProject({ revision: 1, entrypoint: 'index.html', files: [
    { path: 'index.html', memberId: 'builder', content: '<html><head><script defer src="first.js"></script><script src="second.js" defer></script></head><body><button id="ready">Ready</button></body></html>' },
    { path: 'first.js', memberId: 'builder', content: 'document.getElementById("ready").textContent="first";' },
    { path: 'second.js', memberId: 'builder', content: 'document.getElementById("ready").textContent+=" second";' },
  ] });
  const output = buildPreviewDocument(project, 'defer-check');
  const button = output.html.indexOf('<button id="ready">');
  const first = output.html.indexOf('data-project-file="first.js"');
  const second = output.html.indexOf('data-project-file="second.js"');
  assert.ok(button < first && first < second && second < output.html.indexOf('</body>'));
});

test('inert project template scripts never become executable JavaScript', () => {
  const project = normalizeProject({ revision: 1, entrypoint: 'index.html', files: [{ path: 'index.html', memberId: 'builder', content: '<html><head></head><body><script type="text/template"><p>A template, not JavaScript.</p></script></body></html>' }] });
  const output = buildPreviewDocument(project, 'template-check');
  assert.match(output.html, /<script type="text\/template" data-project-file="index.html"><p>A template, not JavaScript\.<\/p><\/script>/);
});

test('component events baseline history and animate only newly observed source receipts', () => {
  const event = seq => ({ seq, kind: 'component.updated', componentId: 'task-entry', projectRevision: seq });
  const hydration = componentEventsSince([event(8), event(9)], 0, true);
  assert.deepEqual(hydration, { events: [], lastSeq: 9 });
  assert.deepEqual(componentEventsSince([event(8), event(9)], hydration.lastSeq), { events: [], lastSeq: 9 });
  const live = componentEventsSince([null, event(9), event(10), event(11)], hydration.lastSeq);
  assert.deepEqual(live.events.map(item => item.seq), [10, 11]);
  assert.equal(live.lastSeq, 11);
  assert.deepEqual(componentEventsSince([event(1)], 0, false).events, [event(1)], 'the first project after an established live baseline is a new receipt');
});

test('component geometry accepts only bounded visible rectangles for known anchors', () => {
  const geometry = boundedComponentRects({ rects: [null, 1, { id: 'unknown', x: 1, y: 1, width: 30, height: 30 }, { id: 'entry', x: -10, y: 10, width: 100, height: 80 }, { id: 'list', x: 250, y: 180, width: 150, height: 80 }, { id: 'bad', x: NaN, y: 0, width: 2, height: 2 }] }, new Set(['entry', 'list', 'bad']), 300, 200);
  assert.deepEqual([...geometry], [['entry', { x: 0, y: 10, width: 90, height: 80 }], ['list', { x: 250, y: 180, width: 50, height: 20 }]]);
});

test('offscreen component anchors are not reported as missing Source fallbacks', () => {
  const ids = new Set(['filters', 'entry']);
  const offscreen = sanitizedComponentGeometry({ rects: [{ id: 'filters', x: 10, y: 600, width: 200, height: 100 }], missing: [] }, ids, 640, 360);
  assert.deepEqual(offscreen, { rects: [], missing: [] });
  const absent = sanitizedComponentGeometry({ rects: [], missing: ['entry', 'unknown', null, 'entry'], arbitrary: 'never retained' }, ids, 640, 360);
  assert.deepEqual(absent, { rects: [], missing: ['entry'] });
});

test('preview identity survives metadata/check changes and follows the effective HTML entrypoint', () => {
  const project = normalizeProject(fixture());
  project.sourceDigest = 'a'.repeat(64);
  const key = projectRenderKey(project);
  assert.equal(projectRenderKey({ ...project, revision: 9, checks: [{ name: 'New check', status: 'passed' }], components: [{ id: 'entry' }] }), key);
  assert.notEqual(projectRenderKey({ ...project, entrypoint: 'other.html' }), key);
  const implicit = { ...project, entrypoint: '', files: [{ path: 'one.html', content: 'one' }, { path: 'two.html', content: 'two' }] };
  assert.notEqual(projectRenderKey(implicit), projectRenderKey({ ...implicit, files: [...implicit.files].reverse() }));
});

test('component preview instrumentation is self-contained and does not replay events by default', () => {
  const project = normalizeProject({ ...fixture(), components: [{ id: 'task-entry', label: 'Task entry', memberId: 'builder', filePaths: ['index.html'] }], events: [{ id: 'receipt-2', seq: 2, kind: 'component.updated', componentId: 'task-entry', memberId: 'builder', changedPaths: ['index.html'] }] });
  const initial = buildPreviewDocument(project, 'component-check');
  assert.ok(initial.html.includes('"ids":["task-entry"],"arrivalIds":[]'));
  assert.ok(initial.html.includes("event.source !== parent"));
  const observed = buildPreviewDocument(project, 'component-check', new Map(), { arrivalIds: ['task-entry'], motionAllowed: true });
  assert.ok(observed.html.includes('"arrivalIds":["task-entry"]'));
  for (const script of observed.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Script(script[1]));
});

test('hidden pending preview reports readiness even when animation frames never run', () => {
  const listeners = new Map(), messages = [];
  const context = {
    parent: { postMessage: message => messages.push(message) },
    document: { hidden: false, documentElement: {}, querySelectorAll: () => [], addEventListener: () => {} },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: (name, callback) => listeners.set(name, callback),
    requestAnimationFrame: () => 1,
    setTimeout: () => 1,
    innerWidth: 640, innerHeight: 360,
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} unobserve() {} },
  };
  new Script(`(${installComponentProbe.toString()})({nonce:'hidden-frame',ids:[],arrivalIds:[]});`).runInNewContext(context);
  listeners.get('DOMContentLoaded')();
  assert.ok(messages.some(message => message.type === 'hog:project-ready' && message.nonce === 'hidden-frame'));
  assert.ok(messages.some(message => message.type === 'hog:component-geometry'));
});

test('working app builds wait for source while plans and non-build missions keep the crew field', () => {
  const flight = { status: 'working', mission: 'Build a useful Towelboard web app with a native crew.', deliverable: '', members: [] };
  assert.equal(awaitingProjectSource(flight), true);
  assert.equal(awaitingProjectSource({ ...flight, status: 'planned' }), false);
  assert.equal(awaitingProjectSource({ ...flight, status: 'complete' }), false);
  assert.equal(awaitingProjectSource({ ...flight, project: fixture() }), false);
  assert.equal(awaitingProjectSource({ ...flight, mission: 'Research how to build a web app.' }), false);
  assert.equal(awaitingProjectSource({ ...flight, mission: 'Build a welcoming open-source community.', members: [{ role: 'Builder', task: 'Develop a practical solution using the available evidence.', output: 'A concrete proposed deliverable.' }] }), false);
  assert.equal(awaitingProjectSource(null), false);
});

test('concrete app deliverables and source implementation contracts identify preparation without invented ownership', () => {
  const flight = { status: 'working', mission: 'Make Towelboard.', members: [] };
  assert.equal(awaitingProjectSource({ ...flight, deliverable: 'A runnable task-board application.' }), true);
  assert.equal(awaitingProjectSource({ ...flight, members: [{ task: 'Implement the task entry component in entry.js.', output: 'The authored source file.' }] }), true);
  assert.equal(awaitingProjectSource({ ...flight, members: [{ task: 'Review entry.js for correctness.', output: 'Ranked review findings.' }] }), false);
});
