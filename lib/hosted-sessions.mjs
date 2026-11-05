import { randomBytes } from 'node:crypto';

export class SharedGate {
  constructor(limit = 6) { this.limit = limit; this.active = 0; this.queue = []; }
  acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Request cancelled.'));
      const entry = { resolve, reject, signal };
      entry.abort = () => { this.queue = this.queue.filter(item => item !== entry); reject(new Error('Request cancelled.')); };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry); this.drain();
    });
  }
  drain() {
    while (this.active < this.limit && this.queue.length) {
      const entry = this.queue.shift(); entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) { entry.reject(new Error('Request cancelled.')); continue; }
      this.active++; let released = false;
      entry.resolve(() => { if (!released) { released = true; this.active--; this.drain(); } });
    }
  }
}

export class WindowRateLimit {
  constructor({ limit, windowMs, maxEntries = 512, now = Date.now }) { Object.assign(this, { limit, windowMs, maxEntries, now }); this.entries = new Map(); }
  take(key) {
    const now = this.now();
    for (const [id, item] of this.entries) if (item.until <= now) this.entries.delete(id);
    let item = this.entries.get(key);
    if (!item) {
      if (this.entries.size >= this.maxEntries) return false;
      item = { count: 0, until: now + this.windowMs }; this.entries.set(key, item);
    }
    item.count++; return item.count <= this.limit;
  }
}

/** Credentials are separate from all serializable run/session metadata. */
export class HostedSessions {
  #credentials = new Map();
  constructor({ runtimeFactory, maxSessions = 32, idleMs = 20 * 60000, absoluteMs = 60 * 60000, now = Date.now, onExpire = () => {} }) {
    Object.assign(this, { runtimeFactory, maxSessions, idleMs, absoluteMs, now, onExpire }); this.entries = new Map();
  }
  async create() {
    await this.sweep();
    if (this.entries.size >= this.maxSessions) throw Object.assign(new Error('The ship is at capacity. Please try again later.'), { status: 503, code: 'SESSION_CAPACITY', public: true });
    const now = this.now();
    const session = { id: randomBytes(32).toString('hex'), token: randomBytes(32).toString('hex'), rateId: randomBytes(16).toString('hex'), connectionAttempt: 0, connectController: null, createdAt: now, lastSeenAt: now, absoluteExpiresAt: now + this.absoluteMs, connection: null, busy: false, alive: true, controller: new AbortController(), clients: new Set() };
    this.entries.set(session.id, session);
    try { session.runtime = this.runtimeFactory(session); await session.runtime.init(); }
    catch (error) { this.entries.delete(session.id); throw error; }
    return session;
  }
  get(id, touch = true) {
    const session = this.entries.get(id);
    if (!session || !session.alive) return null;
    if (this.now() >= this.expiresAt(session)) { void this.drop(session); return null; }
    if (touch) session.lastSeenAt = this.now();
    return session;
  }
  rotate(session) {
    const credential = this.#credentials.get(session.id);
    this.#credentials.delete(session.id); this.entries.delete(session.id);
    session.id = randomBytes(32).toString('hex'); session.token = randomBytes(32).toString('hex');
    this.entries.set(session.id, session);
    if (credential) this.#credentials.set(session.id, credential);
    for (const client of session.clients) client.end();
    session.clients.clear();
  }
  expiresAt(session) { return Math.min(session.absoluteExpiresAt, session.lastSeenAt + this.idleMs); }
  setCredential(session, credential, connection) { this.#credentials.set(session.id, { ...credential }); session.connection = { ...connection }; }
  credential(session) { return this.#credentials.get(session.id) || null; }
  clearCredential(session) {
    const credential = this.#credentials.get(session.id);
    if (credential) credential.key = null;
    this.#credentials.delete(session.id); session.connection = null;
  }
  async drop(session) {
    if (!session.alive) return;
    session.alive = false; session.controller.abort(); this.clearCredential(session); this.entries.delete(session.id);
    for (const client of session.clients) client.end();
    session.clients.clear(); this.onExpire(session);
    await session.runtime?.close();
  }
  async sweep() {
    await Promise.all([...this.entries.values()].filter(session => this.now() >= this.expiresAt(session)).map(session => this.drop(session)));
  }
  async close() { await Promise.all([...this.entries.values()].map(session => this.drop(session))); }
}
