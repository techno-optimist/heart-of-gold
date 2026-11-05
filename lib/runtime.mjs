import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createAdapter, validateResult } from './adapters.mjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const clone = value => structuredClone(value);
const abortError = () => Object.assign(new Error('Expedition cancelled.'), { name: 'AbortError' });

class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.waiting = []; }
  acquire(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const entry = { resolve, reject, signal, abort: null };
      entry.abort = () => { this.waiting = this.waiting.filter(item => item !== entry); reject(abortError()); };
      signal.addEventListener('abort', entry.abort, { once: true });
      this.waiting.push(entry); this.drain();
    });
  }
  drain() {
    while (this.active < this.limit && this.waiting.length) {
      const entry = this.waiting.shift();
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) { entry.reject(abortError()); continue; }
      this.active++;
      let released = false;
      entry.resolve(() => { if (!released) { released = true; this.active--; this.drain(); } });
    }
  }
}

function boundedInteger(value, fallback, min, max, label) {
  const actual = value ?? fallback;
  if (!Number.isInteger(actual) || actual < min || actual > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return actual;
}

export class SwarmRuntime extends EventEmitter {
  constructor({ dataDir, adapterFactory = createAdapter, runTimeoutMs = 600000 } = {}) {
    super();
    if (!dataDir) throw new Error('dataDir is required.');
    this.dataDir = resolve(dataDir); this.adapterFactory = adapterFactory;
    this.runTimeoutMs = boundedInteger(runTimeoutMs, 600000, 10, 3600000, 'Run timeout');
    this.runs = new Map(); this.sessions = new Map(); this.globalGate = new Semaphore(3);
    this.ready = false; this.closed = false;
  }
  async init() {
    if (this.ready) return this;
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    for (const entry of readdirSync(this.dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      try {
        const run = JSON.parse(readFileSync(join(this.dataDir, entry.name, 'run.json'), 'utf8'));
        if (run.id !== entry.name || !Array.isArray(run.nodes) || !Array.isArray(run.events)) continue;
        this.runs.set(run.id, run);
        if (!TERMINAL.has(run.status)) {
          run.status = 'interrupted'; run.error = 'The local bridge stopped during this expedition. Start a new expedition to try again.';
          for (const node of run.nodes) if (!TERMINAL.has(node.status)) node.status = 'interrupted';
          this.record(run, 'run.interrupted', { message: run.error });
        }
      } catch { /* Ignore incomplete or unrelated directories; no automatic execution on startup. */ }
    }
    this.ready = true; return this;
  }
  persist(run) {
    const directory = join(this.dataDir, run.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, 'run.json.tmp'), JSON.stringify(run, null, 2), { mode: 0o600 });
    renameSync(join(directory, 'run.json.tmp'), join(directory, 'run.json'));
  }
  record(run, type, data = {}) {
    run.updatedAt = new Date().toISOString();
    run.sequence = (run.sequence || 0) + 1;
    const event = { id: `${run.id}:${run.sequence}`, runId: run.id, type, at: run.updatedAt, data: clone(data) };
    run.events.push(event);
    if (run.events.length > 1000) run.events.splice(0, run.events.length - 1000);
    this.persist(run); this.emit('event', clone(event));
  }
  listRuns() { return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone); }
  getRun(id) { const run = this.runs.get(id); return run ? clone(run) : null; }
  createRun({ task, mode = 'demo', maxAgents = 7, maxDepth = 2, concurrency = 3 } = {}) {
    if (!this.ready || this.closed) throw new Error('The bridge is not ready.');
    if (typeof task !== 'string' || !task.trim() || task.length > 6000) throw new Error('Mission must contain between 1 and 6,000 characters.');
    if (!['demo', 'codex'].includes(mode)) throw new Error('Choose demo or codex mode.');
    if (this.sessions.size >= 4) throw new Error('Four expeditions are already running. Finish or cancel one first.');
    const limits = {
      maxAgents: boundedInteger(maxAgents, 7, 1, 7, 'Crew size'),
      maxDepth: boundedInteger(maxDepth, 2, 0, 2, 'Branch depth'),
      concurrency: boundedInteger(concurrency, 3, 1, 3, 'Parallel agents'),
      runTimeoutMs: this.runTimeoutMs,
    };
    const adapter = this.adapterFactory(mode);
    const now = new Date().toISOString();
    const run = { id: randomUUID(), task: task.trim(), mode, status: 'running', createdAt: now, updatedAt: now, nodes: [], events: [], sequence: 0, result: '', error: null, limits };
    this.runs.set(run.id, run);
    const controller = new AbortController();
    const session = { controller, gate: new Semaphore(limits.concurrency), adapter, timer: null, promise: null, reservedNodes: 0 };
    this.sessions.set(run.id, session);
    this.record(run, 'run.created', { task: run.task, mode, limits });
    const root = this.createNode(run, null, { name: 'Deep Thought', role: 'Lead', task: run.task });
    session.timer = setTimeout(() => this.failRun(run, new Error('Expedition reached its time limit.')), this.runTimeoutMs);
    session.timer.unref();
    session.promise = Promise.resolve().then(async () => {
      try {
        await this.executeNode(run, root, session);
        if (controller.signal.aborted || TERMINAL.has(run.status)) return;
        run.result = root.result; run.status = 'completed';
        writeFileSync(join(this.dataDir, run.id, 'report.md'), run.result, { mode: 0o600 });
        this.record(run, 'run.completed', { result: run.result });
      } catch (error) {
        if (!TERMINAL.has(run.status)) this.failRun(run, error);
      } finally {
        clearTimeout(session.timer); this.sessions.delete(run.id);
      }
    });
    return clone(run);
  }
  createNode(run, parent, { name, role, task }) {
    if (run.nodes.length >= run.limits.maxAgents) throw new Error('Delegation exceeded the crew budget.');
    const node = { id: randomUUID(), parentId: parent?.id || null, name, role, task, depth: parent ? parent.depth + 1 : 0, status: 'queued', summary: '', result: '', children: [], activityCount: 0 };
    run.nodes.push(node); if (parent) parent.children.push(node.id);
    this.record(run, 'node.created', { node: clone(node) });
    return node;
  }
  async callAdapter(run, node, session, phase, children = []) {
    const signal = session.controller.signal;
    const releaseRun = await session.gate.acquire(signal);
    let releaseGlobal, reservedSlots = 0, handedOff = false;
    try {
      releaseGlobal = await this.globalGate.acquire(signal);
      if (signal.aborted) throw abortError();
      node.status = 'running'; this.record(run, 'node.started', { nodeId: node.id, phase });
      const unreservedAgents = run.limits.maxAgents - run.nodes.length - session.reservedNodes;
      reservedSlots = phase === 'plan' && node.depth < run.limits.maxDepth ? Math.min(2, unreservedAgents) : 0;
      session.reservedNodes += reservedSlots;
      const remainingAgents = reservedSlots;
      const result = validateResult(await session.adapter.run({
        node: clone(node), task: node.task, phase, children: clone(children),
        canDelegate: reservedSlots > 0,
        remainingAgents, signal,
        cwd: join(this.dataDir, run.id, node.id),
        onActivity: message => {
          if (signal.aborted || TERMINAL.has(run.status) || typeof message !== 'string' || node.activityCount >= 100) return;
          node.activityCount++; this.record(run, 'node.activity', { nodeId: node.id, message: message.slice(0, 1000) });
        },
      }));
      if (signal.aborted) throw abortError();
      handedOff = true;
      return { ...result, reservedSlots };
    } finally {
      if (!handedOff) session.reservedNodes -= reservedSlots;
      releaseGlobal?.(); releaseRun();
    }
  }
  async executeNode(run, node, session) {
    let pendingReservation = 0;
    try {
      const plan = await this.callAdapter(run, node, session, 'plan');
      pendingReservation = plan.reservedSlots;
      node.summary = plan.summary;
      if (plan.children.length) {
        if (node.depth >= run.limits.maxDepth) throw new Error('Agent requested delegation beyond the permitted branch depth.');
        if (plan.children.length > pendingReservation || plan.children.length > run.limits.maxAgents - run.nodes.length) throw new Error('Agent requested more helpers than the remaining crew budget.');
        node.status = 'waiting';
        const children = plan.children.map(child => this.createNode(run, node, child));
        session.reservedNodes -= pendingReservation; pendingReservation = 0;
        this.record(run, 'node.waiting', { nodeId: node.id, children: node.children, summary: node.summary });
        // Release execution slots before awaiting children. A waiting parent never occupies a slot.
        const results = await Promise.allSettled(children.map(child => this.executeNode(run, child, session)));
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected) throw rejected.reason;
        if (session.controller.signal.aborted) throw abortError();
        const report = await this.callAdapter(run, node, session, 'synthesize', children);
        if (report.children.length) throw new Error('A synthesis response cannot create more children.');
        node.summary = report.summary; node.result = report.result;
      } else node.result = plan.result;
      node.status = 'completed';
      this.record(run, 'node.completed', { nodeId: node.id, summary: node.summary, result: node.result });
    } catch (error) {
      if (!TERMINAL.has(node.status)) {
        node.status = session.controller.signal.aborted ? 'cancelled' : 'failed';
        node.summary = error.message;
        this.record(run, node.status === 'cancelled' ? 'node.cancelled' : 'node.failed', { nodeId: node.id, message: error.message });
      }
      if (!session.controller.signal.aborted) this.failRun(run, error);
      throw error;
    } finally { session.reservedNodes -= pendingReservation; }
  }
  failRun(run, error) {
    if (TERMINAL.has(run.status)) return;
    run.status = 'failed'; run.error = error.message || 'An agent failed.';
    this.sessions.get(run.id)?.controller.abort();
    for (const node of run.nodes) if (!TERMINAL.has(node.status)) { node.status = 'cancelled'; node.summary = 'Stopped because this expedition failed.'; }
    this.record(run, 'run.failed', { message: run.error });
  }
  cancelRun(id) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (TERMINAL.has(run.status)) return clone(run);
    run.status = 'cancelled';
    this.sessions.get(id)?.controller.abort();
    for (const node of run.nodes) if (!TERMINAL.has(node.status)) node.status = 'cancelled';
    this.record(run, 'run.cancelled', { message: 'You pressed the improbability brake. All pending and active work is stopping.' });
    return clone(run);
  }
  async close() {
    this.closed = true;
    const sessions = [...this.sessions.entries()];
    for (const [id] of sessions) this.cancelRun(id);
    await Promise.allSettled(sessions.map(([, session]) => session.promise));
  }
}
