import { watch, constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const FILE_BYTES = 64 * 1024;
const PROJECT_BYTES = 256 * 1024;
const RESPONSE_BYTES = 1024 * 1024;
const EXTENSIONS = /\.(?:html?|css|m?js|md|markdown|json|txt)$/i;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const DEFAULT_TIMING = { stableMs: 150, coalesceMs: 250, minWriteMs: 500, rescanMs: 1000, deleteGraceMs: 750, requestTimeoutMs: 10000, retryBaseMs: 500, maxRetryMs: 30000 };
const hash = value => createHash('sha256').update(value).digest('hex');
const inside = (root, path) => { const value = relative(root, path); return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value)); };
const sameStat = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ProjectWatcherError extends Error {
  constructor(code, message) { super(message); this.name = 'ProjectWatcherError'; this.code = code; }
}
const error = (code, message) => new ProjectWatcherError(code, message);
const requireThat = (condition, code, message) => { if (!condition) throw error(code, message); };

export function validateWatcherManifest(input) {
  requireThat(input && Array.isArray(input.bindings) && input.bindings.length > 0 && input.bindings.length <= 12, 'INVALID_MANIFEST', 'Supply 1–12 explicit component bindings.');
  const paths = new Set(), folded = new Set(), ids = new Set();
  const bindings = input.bindings.map(binding => {
    requireThat(binding && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(binding.componentId || '') && !ids.has(binding.componentId), 'INVALID_MANIFEST', 'Component IDs must be valid and unique.');
    ids.add(binding.componentId);
    requireThat(typeof binding.label === 'string' && binding.label.trim() && binding.label.length <= 120 && ID.test(binding.memberId || '') && (binding.workerId === undefined || typeof binding.workerId === 'string' && binding.workerId.length > 0 && binding.workerId.length <= 160 && !/[\r\n\0]/.test(binding.workerId)), 'INVALID_MANIFEST', 'Supply valid component labels and reported member identifiers.');
    requireThat(Array.isArray(binding.filePaths) && binding.filePaths.length > 0 && binding.filePaths.length <= 24, 'INVALID_MANIFEST', 'Each component needs an explicit file allowlist.');
    for (const path of binding.filePaths) {
      requireThat(typeof path === 'string' && path.length <= 160 && path.split('/').length <= 8 && path.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)) && EXTENSIONS.test(path) && !folded.has(path.toLowerCase()), 'INVALID_MANIFEST', 'Use disjoint, safe, non-hidden relative text-file paths.');
      paths.add(path); folded.add(path.toLowerCase());
    }
    return { componentId: binding.componentId, label: binding.label, memberId: binding.memberId, ...(binding.workerId ? { workerId: binding.workerId } : {}), filePaths: [...binding.filePaths] };
  });
  requireThat(paths.size <= 24, 'INVALID_MANIFEST', 'The allowlist is limited to 24 files.');
  return { bindings, paths: [...paths].sort() };
}

export async function validateWatcherPaths(rootInput, manifestPath) {
  const suppliedRoot = resolve(rootInput);
  const rootStat = await lstat(suppliedRoot).catch(() => { throw error('INVALID_ROOT', 'The dedicated artifact directory is unavailable.'); });
  requireThat(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'INVALID_ROOT', 'Use a real dedicated directory, not a symbolic link.');
  const root = await realpath(suppliedRoot);
  if (manifestPath !== undefined) {
    const manifest = await realpath(resolve(manifestPath)).catch(() => { throw error('INVALID_MANIFEST', 'The lead-owned manifest is unavailable.'); });
    requireThat(!inside(root, manifest), 'INVALID_MANIFEST', 'Keep the lead-owned manifest outside the watched artifact directory.');
  }
  return { root, rootStat };
}

function scopedHashes(files, paths) {
  requireThat(Array.isArray(files) && files.length === paths.length, 'INVALID_CONNECTION', 'The connection must supply every allowed path baseline.');
  const hashes = new Map();
  for (const file of files) {
    requireThat(file && paths.includes(file.path) && !hashes.has(file.path) && (file.sha256 === null || typeof file.sha256 === 'string' && HASH.test(file.sha256)), 'INVALID_CONNECTION', 'The scoped file baseline is invalid.');
    hashes.set(file.path, file.sha256);
  }
  return hashes;
}

function connectionDetails(input, paths) {
  requireThat(input && /^[a-f0-9]{32}$/.test(input.flightId || '') && /^[A-Za-z0-9_-]{43}$/.test(input.artifactToken || ''), 'INVALID_CONNECTION', 'Supply the scoped artifact connection on standard input.');
  let endpoint;
  try { endpoint = new URL(input.ingestUrl); } catch { throw error('INVALID_CONNECTION', 'The artifact endpoint is invalid.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  requireThat(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash && endpoint.pathname === '/heartofgold/artifacts/write' && ((endpoint.protocol === 'https:' && endpoint.hostname === 'projectforty2.ai' && !endpoint.port) || (local && endpoint.protocol === 'http:')), 'INVALID_CONNECTION', 'Use the canonical HTTPS artifact endpoint or its loopback test equivalent.');
  const revision = input.projectRevision ?? input.currentProjectRevision ?? input.expectedProjectRevision;
  requireThat(Number.isSafeInteger(revision) && revision >= 0, 'INVALID_CONNECTION', 'Supply the current project revision.');
  const baseline = input.scopedFiles === undefined && revision === 0 ? new Map(paths.map(path => [path, null])) : scopedHashes(input.scopedFiles, paths);
  return { flightId: input.flightId, token: input.artifactToken, endpoint: endpoint.href, revision, baseline };
}

// Reads only explicitly allowed regular files. Parsing/running their source is
// deliberately absent: a malformed draft must reach the source viewer exactly.
async function readAllowed(root, path) {
  const target = resolve(root, path);
  requireThat(inside(root, target), 'UNSAFE_PATH', 'An allowed path escaped the artifact directory.');
  try {
    let parent = root;
    for (const segment of path.split('/').slice(0, -1)) {
      parent = resolve(parent, segment);
      const stat = await lstat(parent);
      requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', 'An artifact path contains a link or non-directory.');
    }
    const before = await lstat(target);
    requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'UNSAFE_PATH', 'Allowed artifacts must be regular files without symbolic or hard links.');
    requireThat(before.size <= FILE_BYTES, 'FILE_TOO_LARGE', 'An allowed artifact exceeds 64 KiB.');
    requireThat(inside(root, await realpath(target)), 'UNSAFE_PATH', 'An artifact path escaped its directory.');
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (!sameStat(before, opened)) return { unstable: true };
      const buffer = Buffer.alloc(FILE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      requireThat(length <= FILE_BYTES, 'FILE_TOO_LARGE', 'An allowed artifact exceeds 64 KiB.');
      const after = await handle.stat(), current = await lstat(target);
      requireThat(!current.isSymbolicLink() && current.isFile() && inside(root, await realpath(target)), 'UNSAFE_PATH', 'An artifact path changed to an unsafe target.');
      if (!sameStat(opened, after) || !sameStat(after, current) || length !== after.size) return { unstable: true };
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)); }
      catch { throw error('INVALID_TEXT', 'An allowed artifact is not valid UTF-8 text.'); }
      requireThat(!content.includes('\0'), 'INVALID_TEXT', 'Artifact text cannot contain null bytes.');
      return { path, content, sha256: hash(buffer.subarray(0, length)), bytes: length, modifiedAt: new Date(after.mtimeMs).toISOString() };
    } finally { await handle.close(); }
  } catch (cause) {
    if (cause instanceof ProjectWatcherError) throw cause;
    if (cause.code === 'ENOENT') return { path, content: null, sha256: null, bytes: 0 };
    if (cause.code === 'ELOOP') throw error('UNSAFE_PATH', 'Symbolic links are not allowed in artifact paths.');
    throw error('FILE_READ_FAILED', 'An allowed artifact could not be read safely.');
  }
}

async function responseJSON(response) {
  requireThat(Number(response.headers.get('content-length') || 0) <= RESPONSE_BYTES, 'INVALID_RESPONSE', 'Artifact response exceeded its limit.');
  const reader = response.body?.getReader();
  requireThat(reader, 'INVALID_RESPONSE', 'Artifact endpoint returned no response body.');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_BYTES) { await reader.cancel(); throw error('INVALID_RESPONSE', 'Artifact response exceeded its limit.'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (cause) {
    if (cause instanceof ProjectWatcherError) throw cause;
    throw error('INVALID_RESPONSE', 'Artifact endpoint returned an invalid response.');
  } finally { reader.releaseLock(); }
}

class Watcher {
  #root; #rootStat; #manifest; #connection; #fetch; #receipt; #timing;
  #candidates = new Map(); #stable = new Map(); #scanTimer; #sendTimer; #interval; #watch;
  #scanning = false; #scanAgain = false; #sending = false; #lastAttempt = 0; #closed = false; #stopping = false;
  #controller; #resolveDone; #done; #failure;
  #delays = new Set();
  constructor({ root, rootStat, manifest, connection, fetchImpl, onReceipt, timing }) {
    this.#root = root; this.#rootStat = rootStat; this.#manifest = manifest; this.#connection = connection;
    this.#fetch = fetchImpl; this.#receipt = onReceipt; this.#timing = { ...DEFAULT_TIMING, ...timing };
    for (const value of Object.values(this.#timing)) requireThat(Number.isFinite(value) && value > 0, 'INVALID_OPTIONS', 'Watcher timing values must be positive.');
    this.#done = new Promise(resolve => { this.#resolveDone = resolve; });
  }
  #emit(event, metadata = {}) {
    try { this.#receipt({ event, at: new Date().toISOString(), ...metadata }); } catch { /* A receipt consumer cannot expose internal state or break the watcher. */ }
  }
  #fail(cause) {
    if (this.#closed) return;
    this.#failure = cause instanceof ProjectWatcherError ? cause : error('WATCH_FAILED', 'Artifact watching stopped unexpectedly.');
    this.#emit('watch.error', { code: this.#failure.code, message: this.#failure.message });
    this.#close(false);
  }
  #close(ok) {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#scanTimer); clearTimeout(this.#sendTimer); clearInterval(this.#interval);
    this.#watch?.close(); this.#controller?.abort();
    for (const delay of this.#delays) { clearTimeout(delay.timer); delay.resolve(); }
    this.#delays.clear();
    this.#connection.token = '';
    this.#emit('watch.stopped', { ok, projectRevision: this.#connection.revision });
    this.#resolveDone({ ok, projectRevision: this.#connection.revision, ...(this.#failure ? { error: { code: this.#failure.code, message: this.#failure.message } } : {}) });
  }
  #delay(ms) {
    if (this.#closed) return Promise.resolve();
    return new Promise(resolve => {
      const delay = { resolve, timer: setTimeout(() => { this.#delays.delete(delay); resolve(); }, ms) };
      this.#delays.add(delay);
    });
  }
  #scheduleScan(delay = 0) {
    if (this.#closed || this.#scanTimer) return;
    this.#scanTimer = setTimeout(() => { this.#scanTimer = undefined; this.#scan().catch(cause => this.#fail(cause)); }, delay);
  }
  async #scan() {
    if (this.#closed) return;
    if (this.#scanning) { this.#scanAgain = true; return; }
    this.#scanning = true;
    try {
      const currentRoot = await lstat(this.#root);
      requireThat(currentRoot.isDirectory() && !currentRoot.isSymbolicLink() && currentRoot.dev === this.#rootStat.dev && currentRoot.ino === this.#rootStat.ino, 'UNSAFE_PATH', 'The watched artifact directory was replaced.');
      const reads = await Promise.all(this.#manifest.paths.map(path => readAllowed(this.#root, path)));
      requireThat(reads.reduce((sum, file) => sum + (file.bytes || 0), 0) <= PROJECT_BYTES, 'PROJECT_TOO_LARGE', 'The allowed source files exceed 256 KiB.');
      const now = Date.now(); let settling = false;
      for (let index = 0; index < reads.length; index++) {
        const path = this.#manifest.paths[index], file = reads[index];
        if (file.unstable) { this.#candidates.delete(path); this.#stable.delete(path); settling = true; continue; }
        let candidate = this.#candidates.get(path);
        if (!candidate || candidate.file.sha256 !== file.sha256) {
          candidate = { file, since: now, observedAt: new Date(now).toISOString() }; this.#candidates.set(path, candidate);
        } else candidate.file = file;
        const grace = file.sha256 === null ? this.#timing.deleteGraceMs : this.#timing.stableMs;
        if (now - candidate.since >= grace) this.#stable.set(path, { ...file, observedAt: candidate.observedAt });
        else settling = true;
      }
      if (settling) this.#scheduleScan(this.#timing.stableMs);
      this.#scheduleSend();
    } finally {
      this.#scanning = false;
      if (this.#scanAgain) { this.#scanAgain = false; this.#scheduleScan(); }
    }
  }
  #delta() {
    const changed = [];
    for (const path of this.#manifest.paths) {
      const file = this.#stable.get(path), candidate = this.#candidates.get(path);
      if (file && candidate?.file.sha256 === file.sha256 && file.sha256 !== this.#connection.baseline.get(path)) changed.push(file);
    }
    return changed;
  }
  #scheduleSend() {
    if (this.#closed || this.#sending || this.#sendTimer || !this.#delta().length) return;
    const delay = Math.max(this.#timing.coalesceMs, this.#timing.minWriteMs - (Date.now() - this.#lastAttempt));
    this.#sendTimer = setTimeout(() => { this.#sendTimer = undefined; this.#send().catch(cause => this.#fail(cause)); }, delay);
  }
  async #request(payload) {
    this.#controller = new AbortController();
    const timeout = setTimeout(() => this.#controller?.abort(), this.#timing.requestTimeoutMs);
    try {
      const response = await this.#fetch(this.#connection.endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), signal: this.#controller.signal });
      return { response, body: await responseJSON(response) };
    } catch (cause) {
      if (cause instanceof ProjectWatcherError) throw cause;
      throw error('NETWORK_ERROR', 'The artifact endpoint could not be reached or timed out.');
    } finally { clearTimeout(timeout); this.#controller = undefined; }
  }
  async #send() {
    if (this.#closed || this.#sending) return;
    const changed = this.#delta(); if (!changed.length) return;
    this.#sending = true;
    let payload = { flightId: this.#connection.flightId, artifactToken: this.#connection.token, expectedProjectRevision: this.#connection.revision, batchId: randomUUID(), upserts: changed.filter(file => file.sha256 !== null).map(({ path, content }) => ({ path, content })), deletePaths: changed.filter(file => file.sha256 === null).map(file => file.path) };
    requireThat(Buffer.byteLength(JSON.stringify(payload)) <= 384 * 1024, 'PROJECT_TOO_LARGE', 'The encoded artifact update exceeds 384 KiB.');
    let attempts = 0, conflicts = 0;
    try {
      while (!this.#closed) {
        const remaining = this.#timing.minWriteMs - (Date.now() - this.#lastAttempt); if (remaining > 0) await this.#delay(remaining);
        if (this.#closed) return;
        this.#lastAttempt = Date.now();
        let result;
        try { result = await this.#request(payload); }
        catch (cause) {
          if (cause.code !== 'NETWORK_ERROR' || ++attempts > 3) throw cause;
          this.#emit('artifact.retry', { code: 'NETWORK_ERROR', attempt: attempts });
          await this.#delay(Math.min(this.#timing.maxRetryMs, this.#timing.retryBaseMs * 2 ** (attempts - 1))); continue;
        }
        const { response, body } = result;
        if (response.status === 409 && body?.error?.code === 'PROJECT_CONFLICT') {
          requireThat(++conflicts <= 3, 'PROJECT_CONFLICT', 'Project updates keep conflicting; reconcile before restarting the bridge.');
          const remote = scopedHashes(body.error.scopedFiles, this.#manifest.paths);
          requireThat(this.#manifest.paths.every(path => remote.get(path) === this.#connection.baseline.get(path)), 'EXTERNAL_FILE_CHANGE', 'An authorized path changed externally. Reconcile the source before restarting the bridge.');
          requireThat(Number.isSafeInteger(body.error.currentProjectRevision) && body.error.currentProjectRevision > this.#connection.revision, 'INVALID_RESPONSE', 'Artifact conflict response has an invalid revision.');
          this.#connection.revision = body.error.currentProjectRevision;
          payload = { ...payload, expectedProjectRevision: this.#connection.revision, batchId: randomUUID() };
          this.#emit('artifact.reconciled', { projectRevision: this.#connection.revision }); continue;
        }
        if (response.status === 429 || response.status >= 500) {
          requireThat(++attempts <= 3, 'ENDPOINT_UNAVAILABLE', 'The artifact endpoint remains unavailable; restart after resolving the connection.');
          const retryHeader = response.headers.get('retry-after');
          const seconds = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) * 1000 : retryHeader ? Date.parse(retryHeader) - Date.now() : 0;
          const retryMs = Math.min(this.#timing.maxRetryMs, Math.max(this.#timing.retryBaseMs * 2 ** (attempts - 1), Number.isFinite(seconds) ? seconds : 0));
          this.#emit('artifact.retry', { code: response.status === 429 ? 'ARTIFACT_RATE_LIMIT' : 'SERVER_ERROR', attempt: attempts, retryAfterMs: retryMs });
          await this.#delay(retryMs); continue;
        }
        if (!response.ok) {
          const codes = { 401: ['ARTIFACT_UNAVAILABLE', 'The artifact connection expired, was revoked, or is unavailable.'], 403: ['ARTIFACT_SCOPE', 'The update is outside this artifact connection’s scope. Reconcile the approved bindings.'], 413: ['PROJECT_TOO_LARGE', 'The artifact update exceeds its size limit.'], 409: ['BATCH_CONFLICT', 'The artifact batch conflicts with another update.'], 400: ['INVALID_ARTIFACT', 'The artifact update was rejected. Check the scoped source and bindings.'] };
          const [code, message] = codes[response.status] || ['ENDPOINT_REJECTED', 'The artifact endpoint rejected the update.']; throw error(code, message);
        }
        requireThat(body?.acceptedBatchId === payload.batchId && Number.isSafeInteger(body.projectRevision) && body.projectRevision >= this.#connection.revision && typeof body.sourceDigest === 'string' && HASH.test(body.sourceDigest), 'INVALID_RESPONSE', 'Artifact acknowledgement is invalid.');
        const expected = new Map(this.#connection.baseline);
        for (const file of changed) expected.set(file.path, file.sha256);
        const acknowledged = body.scopedFiles ? scopedHashes(body.scopedFiles, this.#manifest.paths) : expected;
        requireThat(this.#manifest.paths.every(path => acknowledged.get(path) === expected.get(path)), 'EXTERNAL_FILE_CHANGE', 'Acknowledged artifact paths differ from the submitted source. Reconcile before restarting.');
        this.#connection.baseline = acknowledged; this.#connection.revision = body.projectRevision;
        this.#emit('artifact.accepted', { projectRevision: body.projectRevision, sourceDigest: body.sourceDigest, updated: body.updated === true, files: changed.map(({ path, sha256, bytes, modifiedAt, observedAt }) => ({ path, sha256, bytes, ...(modifiedAt ? { modifiedAt } : {}), observedAt })) });
        return;
      }
    } finally { this.#sending = false; this.#scheduleSend(); }
  }
  async start() {
    try {
      this.#watch = watch(this.#root, { recursive: true }, () => this.#scheduleScan());
      this.#watch.on('error', () => { this.#watch?.close(); this.#watch = undefined; this.#emit('watch.polling', { reason: 'Filesystem notifications unavailable; allowlist rescans remain active.' }); });
    } catch { this.#emit('watch.polling', { reason: 'Filesystem notifications unavailable; allowlist rescans remain active.' }); }
    this.#interval = setInterval(() => this.#scheduleScan(), this.#timing.rescanMs);
    this.#emit('watch.ready', { paths: this.#manifest.paths, components: this.#manifest.bindings.length, projectRevision: this.#connection.revision });
    try { await this.#scan(); } catch (cause) { this.#fail(cause); }
    return Object.freeze({ done: this.#done, flush: options => this.flush(options), stop: options => this.stop(options) });
  }
  async flush({ timeoutMs = 10000 } = {}) {
    const until = Date.now() + timeoutMs;
    this.#scheduleScan();
    while (!this.#closed && Date.now() < until) {
      await pause(Math.min(25, this.#timing.stableMs));
      const settled = this.#manifest.paths.every(path => this.#stable.get(path)?.sha256 === this.#candidates.get(path)?.file.sha256 && this.#stable.has(path));
      if (settled && !this.#scanning && !this.#scanTimer && !this.#sending && !this.#sendTimer && !this.#delta().length) return { projectRevision: this.#connection.revision };
    }
    if (this.#failure) throw this.#failure;
    if (this.#closed) return { projectRevision: this.#connection.revision };
    throw error('FLUSH_TIMEOUT', 'Pending artifact changes did not finish before the flush deadline.');
  }
  async stop({ flush = true, timeoutMs = 10000 } = {}) {
    if (this.#closed || this.#stopping) return this.#done;
    this.#stopping = true;
    try { if (flush) await this.flush({ timeoutMs }); this.#close(true); }
    catch (cause) { this.#fail(cause); }
    return this.#done;
  }
}

export async function watchProject({ root, manifest, connection, manifestPath, fetchImpl = globalThis.fetch, onReceipt = () => {}, timing = {} }) {
  requireThat(typeof root === 'string' && typeof fetchImpl === 'function' && typeof onReceipt === 'function', 'INVALID_OPTIONS', 'Supply a root directory and valid watcher callbacks.');
  const checked = validateWatcherManifest(manifest);
  const locations = await validateWatcherPaths(root, manifestPath);
  const details = connectionDetails(connection, checked.paths);
  return new Watcher({ ...locations, manifest: checked, connection: details, fetchImpl, onReceipt, timing }).start();
}
