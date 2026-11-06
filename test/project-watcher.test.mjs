import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { watchProject, validateWatcherManifest } from '../lib/project-watcher.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const token = 'z'.repeat(43);
const timing = { stableMs: 12, coalesceMs: 12, minWriteMs: 30, rescanMs: 30, deleteGraceMs: 80, requestTimeoutMs: 100, retryBaseMs: 10, maxRetryMs: 50 };
const manifest = paths => ({ bindings: paths.map((path, i) => ({ componentId: `component-${i}`, label: `Component ${i}`, memberId: i ? `crew-${i}` : 'lead', filePaths: [path] })) });
const connection = extra => ({ flightId: 'a'.repeat(32), artifactToken: token, ingestUrl: 'https://projectforty2.ai/heartofgold/artifacts/write', projectRevision: 0, ...extra });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, paths = ['index.html']) {
  const directory = await mkdtemp(join(tmpdir(), 'hog-watch-'));
  const root = join(directory, 'artifacts'); await mkdir(root);
  const receipts = [], calls = [], remote = new Map(paths.map(path => [path, null])); let revision = 0;
  const response = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const accept = payload => {
    let updated = false;
    for (const { path, content } of payload.upserts) { const digest = sha(content); updated ||= remote.get(path) !== digest; remote.set(path, digest); }
    for (const path of payload.deletePaths) { updated ||= remote.get(path) !== null; remote.set(path, null); }
    if (updated) revision++;
    return response({ updated, flight: { id: 'a'.repeat(32), revision: revision + 1, expiresAt: '2030-01-01T00:00:00.000Z' }, projectRevision: revision, sourceDigest: sha(JSON.stringify([...remote])), acceptedBatchId: payload.batchId, scopedFiles: [...remote].map(([path, sha256]) => ({ path, sha256 })) });
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url, connection().ingestUrl); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    const payload = JSON.parse(options.body); calls.push({ payload, at: Date.now() }); return accept(payload);
  };
  let watcher;
  t.after(async () => { await watcher?.stop({ flush: false }); await rm(directory, { recursive: true, force: true }); });
  return { directory, root, receipts, calls, remote, response, accept,
    setRevision(value) { revision = value; },
    async start(extra = {}) { watcher = await watchProject({ root, manifest: manifest(paths), connection: connection(), fetchImpl, onReceipt: row => receipts.push(row), timing, ...extra }); return watcher; },
  };
}

test('streams exact genuine saves including malformed code, UTF-8 and BOM; ignores unlisted files', async t => {
  const f = await fixture(t, ['index.html', 'component.js']);
  await writeFile(join(f.root, 'index.html'), '<main data-hog-component="component-0"></main>');
  await writeFile(join(f.root, 'component.js'), '\uFEFF(ctx) => { /* Café 🌌 */ broken(');
  await writeFile(join(f.root, '.env'), 'UNRELATED_SECRET=never-read');
  const watcher = await f.start(); await watcher.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].payload.upserts.find(file => file.path === 'component.js').content, '\uFEFF(ctx) => { /* Café 🌌 */ broken(');
  await writeFile(join(f.root, 'component.js'), '(ctx) => { ctx.state.count = 1; }');
  await watcher.flush();
  assert.equal(f.calls.at(-1).payload.upserts[0].content, '(ctx) => { ctx.state.count = 1; }');
  assert.equal(f.calls.at(-1).payload.upserts.length, 1);
  const count = f.calls.length; await writeFile(join(f.root, 'component.js'), '(ctx) => { ctx.state.count = 1; }'); await watcher.flush();
  assert.equal(f.calls.length, count, 'same bytes do not emit progress');
  assert(!JSON.stringify(f.calls).includes('UNRELATED_SECRET'));
  assert(!JSON.stringify(f.receipts).includes(token));
  assert(!JSON.stringify(f.receipts).includes('ctx.state'));
  assert(f.receipts.some(row => row.files?.some(file => file.path === 'component.js' && file.sha256 === sha('(ctx) => { ctx.state.count = 1; }'))));
});

test('coalesces real bursts, enforces one in-flight request, then sends only the latest pending bytes', async t => {
  const f = await fixture(t, ['index.html', 'a.js', 'b.js']);
  await writeFile(join(f.root, 'index.html'), '<main>shell</main>');
  let release, inFlight = 0, maximum = 0;
  const watcher = await f.start({ fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body); f.calls.push({ payload, at: Date.now() }); maximum = Math.max(maximum, ++inFlight);
    if (f.calls.length === 1) await new Promise(resolve => { release = resolve; });
    inFlight--; return f.accept(payload);
  } });
  while (!release) await wait(5);
  await writeFile(join(f.root, 'a.js'), 'one'); await writeFile(join(f.root, 'b.js'), 'two');
  await wait(25); await writeFile(join(f.root, 'a.js'), 'latest'); await wait(35);
  release(); await watcher.flush();
  assert.equal(maximum, 1);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].payload.upserts.map(file => [file.path, file.content]), [['a.js', 'latest'], ['b.js', 'two']]);
  assert(f.calls[1].at - f.calls[0].at >= timing.minWriteMs - 2);
});

test('atomic rename is observed; transient absence is not deletion; stable deletion is sent', async t => {
  const f = await fixture(t, ['index.html', 'component.js']);
  await writeFile(join(f.root, 'index.html'), '<main></main>'); await writeFile(join(f.root, 'component.js'), 'before');
  const watcher = await f.start(); await watcher.flush();
  await rename(join(f.root, 'component.js'), join(f.root, 'component.pending'));
  await wait(20); await writeFile(join(f.root, 'component.pending'), 'after'); await rename(join(f.root, 'component.pending'), join(f.root, 'component.js'));
  await watcher.flush(); assert(f.calls.every(call => call.payload.deletePaths.length === 0));
  assert.equal(f.calls.at(-1).payload.upserts[0].content, 'after');
  await rm(join(f.root, 'component.js')); await watcher.flush();
  assert.deepEqual(f.calls.at(-1).payload.deletePaths, ['component.js']);
});

test('rejects unsafe or overlapping allowlists and a manifest inside the watched root', async t => {
  for (const paths of [['../secret.js'], ['.env'], ['/tmp/a.js'], ['a.js', 'A.js'], ['a.js', 'a.js'], ['nested\\a.js']]) assert.throws(() => validateWatcherManifest(manifest(paths)));
  const f = await fixture(t); const path = join(f.root, 'manifest.json'); await writeFile(path, '{}');
  await assert.rejects(f.start({ manifestPath: path }), /outside/);
  await assert.rejects(f.start({ connection: connection({ ingestUrl: 'https://example.org/heartofgold/artifacts/write' }) }), /canonical/);
});

test('rejects symbolic/hard links and nonregular allowed paths before upload', async t => {
  for (const type of ['symbolic', 'hard', 'directory', 'ancestor']) {
    await t.test(type, async sub => {
      const paths = type === 'ancestor' ? ['nested/index.html'] : ['index.html'];
      const f = await fixture(sub, paths); const outside = join(f.directory, 'outside.html'); await writeFile(outside, 'PRIVATE_OUTSIDE');
      if (type === 'symbolic') await symlink(outside, join(f.root, 'index.html'));
      else if (type === 'hard') await link(outside, join(f.root, 'index.html'));
      else if (type === 'directory') await mkdir(join(f.root, 'index.html'));
      else await symlink(f.directory, join(f.root, 'nested'));
      const watcher = await f.start(); const done = await watcher.done;
      assert.equal(done.ok, false); assert.equal(done.error.code, 'UNSAFE_PATH'); assert.equal(f.calls.length, 0);
    });
  }
});

test('rejects oversized, NUL, and invalid UTF-8 source without leaking its bytes', async t => {
  for (const content of [Buffer.alloc(65537, 65), Buffer.from('private\0source'), Buffer.from([0xc3, 0x28])]) {
    await t.test(`input ${content.length} bytes`, async sub => {
      const f = await fixture(sub); await writeFile(join(f.root, 'index.html'), content);
      const watcher = await f.start(); assert.equal((await watcher.done).ok, false); assert.equal(f.calls.length, 0);
      assert(!JSON.stringify(f.receipts).includes('private'));
    });
  }
});

test('reconciles an independent project revision only when scoped hashes are unchanged', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'index.html'), 'actual'); let calls = 0;
  const watcher = await f.start({ fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body); f.calls.push({ payload });
    if (!calls++) { f.setRevision(4); return f.response({ error: { code: 'PROJECT_CONFLICT', currentProjectRevision: 4, scopedFiles: [{ path: 'index.html', sha256: null }] } }, 409); }
    assert.equal(payload.expectedProjectRevision, 4); return f.accept(payload);
  } });
  await watcher.flush(); assert.equal(f.calls.length, 2); assert.notEqual(f.calls[0].payload.batchId, f.calls[1].payload.batchId);
});

test('stops rather than overwriting an externally changed authorized path', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'index.html'), 'local');
  const watcher = await f.start({ fetchImpl: async () => f.response({ error: { code: 'PROJECT_CONFLICT', currentProjectRevision: 2, scopedFiles: [{ path: 'index.html', sha256: sha('external edit') }] } }, 409) });
  const done = await watcher.done; assert.equal(done.error.code, 'EXTERNAL_FILE_CHANGE');
});

test('ambiguous network failure and rate limiting retry the identical batch without echoing errors', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'index.html'), 'actual source'); let count = 0;
  const watcher = await f.start({ fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body); f.calls.push({ payload });
    if (count++ === 0) throw new Error(`echo ${token} actual source`);
    if (count === 2) return f.response({ error: { message: token } }, 429, { 'Retry-After': '0.01' });
    return f.accept(payload);
  } });
  await watcher.flush(); assert.equal(f.calls.length, 3);
  assert.equal(JSON.stringify(f.calls[0].payload), JSON.stringify(f.calls[1].payload));
  assert.equal(JSON.stringify(f.calls[0].payload), JSON.stringify(f.calls[2].payload));
  assert(!JSON.stringify(f.receipts).includes(token));
});

test('expiry stops, remote messages stay private, and stop flushes final real bytes', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'index.html'), 'start');
  const watcher = await f.start(); await watcher.flush();
  await writeFile(join(f.root, 'index.html'), 'final'); const stopped = await watcher.stop();
  assert(stopped.ok); assert.equal(f.calls.at(-1).payload.upserts[0].content, 'final');
  const expired = await f.start({ fetchImpl: async () => f.response({ error: { code: 'ARTIFACT_UNAVAILABLE', message: `secret ${token}` } }, 401) });
  const done = await expired.done; assert.equal(done.error.code, 'ARTIFACT_UNAVAILABLE'); assert(!JSON.stringify(f.receipts).includes(token));
});

test('request timeout terminates with sanitized metadata and explicit stop aborts in-flight work', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'index.html'), 'start');
  let aborts = 0;
  const watcher = await f.start({ timing: { ...timing, requestTimeoutMs: 20 }, fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborts++; reject(new Error(token)); }, { once: true });
  }) });
  const done = await watcher.done; assert.equal(done.error.code, 'NETWORK_ERROR'); assert.equal(aborts, 4); assert(!JSON.stringify(f.receipts).includes(token));
  const next = await f.start({ fetchImpl: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(token)), { once: true })) });
  await wait(60); assert((await next.stop({ flush: false })).ok);
});

test('CLI validates stdin without exposing credentials and package-relative import works', async t => {
  const f = await fixture(t); const manifestPath = join(f.directory, 'bindings.json'); await writeFile(manifestPath, JSON.stringify(manifest(['index.html'])));
  const result = spawnSync(process.execPath, ['scripts/watch-project.mjs', '--root', f.root, '--manifest', manifestPath], { input: JSON.stringify(connection({ ingestUrl: `https://example.org/${token}` })), encoding: 'utf8' });
  assert.equal(result.status, 1); assert(!result.stdout.includes(token)); assert(!result.stderr.includes(token)); assert.match(result.stdout, /INVALID_CONNECTION/);
});
