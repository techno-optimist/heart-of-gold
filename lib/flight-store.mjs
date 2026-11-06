import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createProject, validateArtifactBindings, checkAttribution, projectFileSchema, pathSchema } from './project-contract.mjs';
import { z } from 'zod';

export const FLIGHT_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_FLIGHTS = 128;
export const MAX_FLIGHT_BYTES = 384 * 1024;
export const MAX_TOTAL_FLIGHT_BYTES = 8 * 1024 * 1024;

export class FlightError extends Error {
  constructor(code, message, currentRevision) {
    super(message); this.name = 'FlightError'; this.code = code;
    if (currentRevision !== undefined) this.currentRevision = currentRevision;
  }
}
const unavailable = () => new FlightError('FLIGHT_UNAVAILABLE', 'This flight is unavailable or has expired. Its capability may be missing or invalid.');
const digest = token => createHash('sha256').update(token).digest();
const artifactUnavailable = () => new FlightError('ARTIFACT_UNAVAILABLE', 'This artifact channel is unavailable, revoked, or expired.');
export const artifactWriteSchema = z.object({
  flightId: z.string().regex(/^[a-f0-9]{32}$/), artifactToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expectedProjectRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  batchId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/),
  upserts: z.array(projectFileSchema.pick({ path: true, content: true })).max(24),
  deletePaths: z.array(pathSchema).max(24),
}).strict();

/** One latest snapshot per flight, in process memory only. No user/account lookup. */
export class FlightStore {
  #entries = new Map();
  #totalBytes = 0;
  #closed = false;
  #timer;
  #subscribers = 0;
  constructor({ now = Date.now, ttlMs = FLIGHT_TTL_MS, maxFlights = MAX_FLIGHTS,
    maxTotalBytes = MAX_TOTAL_FLIGHT_BYTES, maxSnapshotBytes = MAX_FLIGHT_BYTES,
    eventsUrl = 'https://projectforty2.ai/heartofgold/artifacts/events', maxSubscribers = 32, maxSubscribersPerFlight = 2 } = {}) {
    for (const value of [ttlMs, maxFlights, maxTotalBytes, maxSnapshotBytes, maxSubscribers, maxSubscribersPerFlight]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid flight store limits.');
    Object.assign(this, { now, ttlMs, maxFlights, maxTotalBytes, maxSnapshotBytes, eventsUrl, maxSubscribers, maxSubscribersPerFlight });
    this.#timer = setInterval(() => this.sweep(), Math.min(ttlMs, 60_000));
    this.#timer.unref();
  }
  #encode(snapshot) {
    let encoded;
    try { encoded = JSON.stringify(snapshot); } catch { throw new FlightError('INVALID_FLIGHT', 'The flight snapshot must be valid JSON.'); }
    if (typeof encoded !== 'string') throw new FlightError('INVALID_FLIGHT', 'A flight snapshot is required.');
    const bytes = Buffer.byteLength(encoded);
    if (bytes > this.maxSnapshotBytes) throw new FlightError('FLIGHT_TOO_LARGE', 'This flight exceeds the snapshot size limit. Shorten contribution summaries or project content.');
    return { snapshot: JSON.parse(encoded), bytes };
  }
  #info(entry) { return { id: entry.id, revision: entry.revision, expiresAt: new Date(entry.expiresAt).toISOString(), eventsUrl: this.eventsUrl }; }
  #authorize(id, token, permission) {
    this.sweep();
    if (this.#closed || typeof id !== 'string' || typeof token !== 'string' || token.length !== 43) throw unavailable();
    const entry = this.#entries.get(id);
    if (!entry || !timingSafeEqual(digest(token), permission === 'read' ? entry.readHash : entry.writeHash)) throw unavailable();
    return entry;
  }
  create(snapshot) {
    this.sweep(); if (this.#closed) throw unavailable();
    const encoded = this.#encode(snapshot);
    if (this.#entries.size >= this.maxFlights || this.#totalBytes + encoded.bytes > this.maxTotalBytes) {
      throw new FlightError('FLIGHT_CAPACITY', 'The temporary flight deck is at capacity. Existing flights remain available; try again later.');
    }
    const id = randomBytes(16).toString('hex');
    const readToken = randomBytes(32).toString('base64url');
    const writeToken = randomBytes(32).toString('base64url');
    const entry = { id, ...encoded, revision: 1, expiresAt: this.now() + this.ttlMs, readHash: digest(readToken), writeHash: digest(writeToken), subscribers: new Set(), artifact: null };
    this.#entries.set(id, entry); this.#totalBytes += entry.bytes;
    return { snapshot: structuredClone(entry.snapshot), flight: { ...this.#info(entry), writeToken }, readToken };
  }
  read(id, readToken, afterRevision) {
    const entry = this.#authorize(id, readToken, 'read');
    const flight = this.#info(entry);
    if (afterRevision === entry.revision) return { flight, unchanged: true };
    return { snapshot: structuredClone(entry.snapshot), flight, unchanged: false };
  }
  update(id, writeToken, expectedRevision, snapshot, { editableOnly = false } = {}) {
    const entry = this.#authorize(id, writeToken, 'write');
    this.#checkRevision(entry, expectedRevision);
    if (editableOnly && entry.snapshot.status === 'working') throw new FlightError('FLIGHT_BUSY', 'This flight is working. Wait for the host to finish or stop the work before saving another plan.');
    // Crew progress and edited plans cannot erase or replace a real project.
    // Only the dedicated artifact transaction can change these files.
    const { project: ignoredProject, ...crew } = snapshot;
    return this.#commit(entry, { ...crew, ...(entry.snapshot.project ? { project: entry.snapshot.project } : {}) });
  }
  updateProject(id, writeToken, expectedRevision, input) {
    const entry = this.#authorize(id, writeToken, 'write');
    this.#checkRevision(entry, expectedRevision);
    const project = createProject(input, entry.snapshot, { flightRevision: entry.revision, now: this.now() });
    return this.#commit(entry, { ...entry.snapshot, project });
  }
  openArtifactStream(id, writeToken, expectedRevision, input) {
    const entry = this.#authorize(id, writeToken, 'write'); this.#checkRevision(entry, expectedRevision);
    const bindings = validateArtifactBindings(input, entry.snapshot);
    const artifactToken = randomBytes(32).toString('base64url');
    const bytes = Buffer.byteLength(JSON.stringify(bindings)) + 1024;
    const nextBytes = this.#totalBytes - (entry.artifact?.bytes || 0) + bytes;
    if (nextBytes > this.maxTotalBytes) throw new FlightError('FLIGHT_CAPACITY', 'The temporary flight deck is at capacity.');
    // Rotation revokes the preceding writer; neither raw token is stored.
    entry.artifact = { hash: digest(artifactToken), bindings, bytes, batch: null, tokens: 4, byteTokens: 384 * 1024, rateAt: this.now() };
    this.#totalBytes = nextBytes;
    const projectRevision = entry.snapshot.project?.revision || 0;
    return { flightId: entry.id, artifactToken, flight: this.#info(entry), projectRevision, currentProjectRevision: projectRevision,
      expiresAt: new Date(entry.expiresAt).toISOString(), scopedFiles: this.#scopedFiles(entry) };
  }
  #scopedFiles(entry) {
    const byPath = new Map((entry.snapshot.project?.files || []).map(file => [file.path, file.sha256]));
    return entry.artifact.bindings.flatMap(binding => binding.filePaths.map(path => ({ path, sha256: byPath.get(path) || null })));
  }
  writeArtifacts(input) {
    let parsed; try { parsed = artifactWriteSchema.parse(input); } catch { throw new FlightError('INVALID_ARTIFACT', 'The artifact batch does not meet the documented field or size limits.'); }
    this.sweep();
    const entry = this.#entries.get(parsed.flightId);
    if (this.#closed || !entry?.artifact || !timingSafeEqual(digest(parsed.artifactToken), entry.artifact.hash)) throw artifactUnavailable();
    const channel = entry.artifact;
    const { artifactToken: ignoredToken, ...batchPayload } = parsed;
    const fingerprint = createHash('sha256').update(JSON.stringify(batchPayload)).digest('hex');
    if (channel.batch?.id === parsed.batchId) {
      if (channel.batch.fingerprint !== fingerprint) throw new FlightError('BATCH_CONFLICT', 'A batch identifier cannot be reused for different content.');
      if (channel.batch.projectRevision === (entry.snapshot.project?.revision || 0)) return this.#artifactResult(entry, parsed.batchId, false);
    }
    const current = entry.snapshot.project?.revision || 0;
    if (parsed.expectedProjectRevision !== current) {
      const error = new FlightError('PROJECT_CONFLICT', 'Project source changed. Reconcile the current scoped hashes before retrying.');
      error.currentProjectRevision = current; error.scopedFiles = this.#scopedFiles(entry); throw error;
    }
    const elapsed = Math.max(0, this.now() - channel.rateAt) / 1000;
    channel.tokens = Math.min(4, channel.tokens + elapsed * 2);
    channel.byteTokens = Math.min(384 * 1024, channel.byteTokens + elapsed * 256 * 1024); channel.rateAt = this.now();
    const payloadBytes = Buffer.byteLength(JSON.stringify(batchPayload));
    if (channel.tokens < 1 || channel.byteTokens < payloadBytes) throw new FlightError('ARTIFACT_RATE_LIMIT', 'Artifact updates are arriving too quickly. Retry after a short delay.');
    channel.tokens--; channel.byteTokens -= payloadBytes;
    const owners = new Map(channel.bindings.flatMap(binding => binding.filePaths.map(path => [path, binding])));
    const touched = new Set();
    for (const path of [...parsed.upserts.map(file => file.path), ...parsed.deletePaths]) {
      if (!owners.has(path) || touched.has(path.toLowerCase())) throw new FlightError('ARTIFACT_SCOPE', 'Each changed path must be unique and belong to this artifact channel.');
      touched.add(path.toLowerCase()); checkAttribution(owners.get(path), entry.snapshot);
    }
    const prior = entry.snapshot.project;
    const files = new Map((prior?.files || []).map(({ path, content, memberId, workerId, summary }) => [path, { path, content, memberId, ...(workerId ? { workerId } : {}), ...(summary ? { summary } : {}) }]));
    const changed = new Set();
    for (const file of parsed.upserts) {
      if (files.get(file.path)?.content === file.content) continue;
      const binding = owners.get(file.path);
      files.set(file.path, { ...file, memberId: binding.memberId, ...(binding.workerId ? { workerId: binding.workerId } : {}) }); changed.add(file.path);
    }
    for (const path of parsed.deletePaths) if (files.delete(path)) changed.add(path);
    if (!changed.size) { channel.batch = { id: parsed.batchId, fingerprint, projectRevision: current }; return this.#artifactResult(entry, parsed.batchId, false); }
    const mapped = new Map((prior?.components || []).map(({ sourceDigest: ignored, ...component }) => [component.id, component]));
    for (const binding of channel.bindings) {
      if (!binding.filePaths.some(path => changed.has(path))) continue;
      const filePaths = binding.filePaths.filter(path => files.has(path));
      if (!filePaths.length) mapped.delete(binding.componentId);
      else mapped.set(binding.componentId, { id: binding.componentId, label: binding.label, memberId: binding.memberId, ...(binding.workerId ? { workerId: binding.workerId } : {}), filePaths });
    }
    const components = [...mapped.values()];
    const boundIds = new Set(channel.bindings.map(binding => binding.componentId));
    const changedComponentIds = components.filter(component => boundIds.has(component.id) && component.filePaths.some(path => changed.has(path))).map(component => component.id);
    const projectInput = { title: prior?.title || String(entry.snapshot.mission || 'Live project').slice(0, 160),
      ...(prior?.entrypoint ? { entrypoint: prior.entrypoint } : files.has('index.html') ? { entrypoint: 'index.html' } : {}),
      links: prior?.links || {}, files: [...files.values()], checks: [], components, changedComponentIds,
      ...(prior?.runtime ? { runtime: prior.runtime } : {}) };
    const project = createProject(projectInput, entry.snapshot, { flightRevision: entry.revision, now: this.now() });
    this.#commit(entry, { ...entry.snapshot, project });
    channel.batch = { id: parsed.batchId, fingerprint, projectRevision: project.revision };
    return this.#artifactResult(entry, parsed.batchId, true);
  }
  #artifactResult(entry, batchId, updated) {
    return { updated, flight: this.#info(entry), projectRevision: entry.snapshot.project?.revision || 0,
      sourceDigest: entry.snapshot.project?.sourceDigest || null, acceptedBatchId: batchId, scopedFiles: this.#scopedFiles(entry) };
  }
  subscribe(id, readToken, onEvent) {
    const entry = this.#authorize(id, readToken, 'read');
    if (entry.subscribers.size >= this.maxSubscribersPerFlight || this.#subscribers >= this.maxSubscribers) throw new FlightError('OBSERVER_LIMIT', 'The artifact stream has reached its observer limit.');
    entry.subscribers.add(onEvent); this.#subscribers++;
    const unsubscribe = () => { if (entry.subscribers.delete(onEvent)) this.#subscribers--; };
    return { snapshot: structuredClone(entry.snapshot), flight: this.#info(entry), unsubscribe };
  }
  #notify(entry, type) {
    for (const listener of entry.subscribers) {
      try { listener(type, type === 'expired' ? { code: 'FLIGHT_UNAVAILABLE' } : { ...structuredClone(entry.snapshot), flight: this.#info(entry), resync: false }); }
      catch { if (entry.subscribers.delete(listener)) this.#subscribers--; }
    }
  }
  #remove(entry) {
    this.#notify(entry, 'expired'); this.#subscribers -= entry.subscribers.size; entry.subscribers.clear();
    this.#entries.delete(entry.id); this.#totalBytes -= entry.bytes + (entry.artifact?.bytes || 0);
  }
  #checkRevision(entry, expectedRevision) {
    if (expectedRevision !== entry.revision) {
      const error = new FlightError('FLIGHT_CONFLICT', 'The flight changed. Reconcile the returned current snapshot and user edits before updating; do not blindly retry with a newer revision.', entry.revision);
      // Recovery is returned only after write-capability authorization above.
      error.recovery = { flight: this.#info(entry), currentSnapshot: structuredClone(entry.snapshot) };
      throw error;
    }
  }
  #commit(entry, snapshot) {
    const encoded = this.#encode(snapshot);
    const nextBytes = this.#totalBytes - entry.bytes + encoded.bytes;
    if (nextBytes > this.maxTotalBytes) throw new FlightError('FLIGHT_CAPACITY', 'The temporary flight deck is at capacity. Shorten contribution summaries and retry.');
    this.#totalBytes = nextBytes; entry.snapshot = encoded.snapshot; entry.bytes = encoded.bytes; entry.revision++;
    this.#notify(entry, 'update');
    return { snapshot: structuredClone(entry.snapshot), flight: this.#info(entry) };
  }
  sweep() {
    const now = this.now();
    for (const [id, entry] of this.#entries) if (now >= entry.expiresAt) {
      this.#remove(entry);
    }
  }
  get stats() { this.sweep(); return { flights: this.#entries.size, bytes: this.#totalBytes }; }
  close() { this.#closed = true; clearInterval(this.#timer); for (const entry of this.#entries.values()) this.#remove(entry); this.#totalBytes = 0; }
}
