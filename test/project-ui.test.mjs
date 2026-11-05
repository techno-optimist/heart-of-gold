import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { normalizeProject, resolveProjectPath, buildPreviewDocument, changedProjectFiles, safeProjectLink } from '../plugins/heart-of-gold/ui/project-preview.mjs';

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
  assert.match(ui, /event\.source !== frame\.contentWindow/);
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
