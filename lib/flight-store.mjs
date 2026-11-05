import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const FLIGHT_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_FLIGHTS = 128;
export const MAX_FLIGHT_BYTES = 96 * 1024;
export const MAX_TOTAL_FLIGHT_BYTES = 8 * 1024 * 1024;

export class FlightError extends Error {
  constructor(code, message, currentRevision) {
    super(message); this.name = 'FlightError'; this.code = code;
    if (currentRevision !== undefined) this.currentRevision = currentRevision;
  }
}
const unavailable = () => new FlightError('FLIGHT_UNAVAILABLE', 'This flight is unavailable or has expired. Its capability may be missing or invalid.');
const digest = token => createHash('sha256').update(token).digest();

/** One latest snapshot per flight, in process memory only. No user/account lookup. */
export class FlightStore {
  #entries = new Map();
  #totalBytes = 0;
  #closed = false;
  #timer;
  constructor({ now = Date.now, ttlMs = FLIGHT_TTL_MS, maxFlights = MAX_FLIGHTS,
    maxTotalBytes = MAX_TOTAL_FLIGHT_BYTES, maxSnapshotBytes = MAX_FLIGHT_BYTES } = {}) {
    for (const value of [ttlMs, maxFlights, maxTotalBytes, maxSnapshotBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid flight store limits.');
    Object.assign(this, { now, ttlMs, maxFlights, maxTotalBytes, maxSnapshotBytes });
    this.#timer = setInterval(() => this.sweep(), Math.min(ttlMs, 60_000));
    this.#timer.unref();
  }
  #encode(snapshot) {
    let encoded;
    try { encoded = JSON.stringify(snapshot); } catch { throw new FlightError('INVALID_FLIGHT', 'The flight snapshot must be valid JSON.'); }
    if (typeof encoded !== 'string') throw new FlightError('INVALID_FLIGHT', 'A flight snapshot is required.');
    const bytes = Buffer.byteLength(encoded);
    if (bytes > this.maxSnapshotBytes) throw new FlightError('FLIGHT_TOO_LARGE', 'This flight exceeds the snapshot size limit. Shorten contribution summaries.');
    return { snapshot: JSON.parse(encoded), bytes };
  }
  #info(entry) { return { id: entry.id, revision: entry.revision, expiresAt: new Date(entry.expiresAt).toISOString() }; }
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
    const entry = { id, ...encoded, revision: 1, expiresAt: this.now() + this.ttlMs, readHash: digest(readToken), writeHash: digest(writeToken) };
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
    if (expectedRevision !== entry.revision) {
      const error = new FlightError('FLIGHT_CONFLICT', 'The flight changed. Reconcile the returned current snapshot and user edits before updating; do not blindly retry with a newer revision.', entry.revision);
      // Recovery is returned only after write-capability authorization above.
      error.recovery = { flight: this.#info(entry), currentSnapshot: structuredClone(entry.snapshot) };
      throw error;
    }
    if (editableOnly && entry.snapshot.status === 'working') throw new FlightError('FLIGHT_BUSY', 'This flight is working. Wait for the host to finish or stop the work before saving another plan.');
    const encoded = this.#encode(snapshot);
    const nextBytes = this.#totalBytes - entry.bytes + encoded.bytes;
    if (nextBytes > this.maxTotalBytes) throw new FlightError('FLIGHT_CAPACITY', 'The temporary flight deck is at capacity. Shorten contribution summaries and retry.');
    this.#totalBytes = nextBytes; entry.snapshot = encoded.snapshot; entry.bytes = encoded.bytes; entry.revision++;
    return { snapshot: structuredClone(entry.snapshot), flight: this.#info(entry) };
  }
  sweep() {
    const now = this.now();
    for (const [id, entry] of this.#entries) if (now >= entry.expiresAt) {
      this.#entries.delete(id); this.#totalBytes -= entry.bytes;
    }
  }
  get stats() { this.sweep(); return { flights: this.#entries.size, bytes: this.#totalBytes }; }
  close() { this.#closed = true; clearInterval(this.#timer); this.#entries.clear(); this.#totalBytes = 0; }
}
