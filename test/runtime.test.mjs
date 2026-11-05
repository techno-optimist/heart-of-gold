import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwarmRuntime } from '../lib/runtime.mjs';
import { CodexAdapter, validateResult } from '../lib/adapters.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 4000) {
  const start = Date.now();
  while (!fn()) { if (Date.now() - start > timeout) throw new Error('Condition timed out.'); await pause(5); }
}
async function fixture(t, adapter, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'heart-of-gold-test-'));
  const runtime = new SwarmRuntime({ dataDir, adapterFactory: () => adapter, ...options });
  await runtime.init();
  t.after(async () => { await runtime.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { runtime, dataDir };
}
const leaf = (result = 'A useful report') => ({ summary: 'Finished.', result, children: [] });

test('recursive children join before synthesis, obey concurrency, and persist a report', async t => {
  let active = 0, peak = 0;
  const adapter = { async run({ node, phase, children }) {
    active++; peak = Math.max(peak, active); await pause(15); active--;
    if (phase === 'synthesize') { assert(children.every(child => child.status === 'completed')); return leaf(children.map(child => child.result).join(' + ')); }
    if (node.depth < 2) return { summary: 'Delegating', result: '', children: ['A', 'B'].map(letter => ({ name: letter, role: 'Worker', task: `${node.task}/${letter}` })) };
    return leaf(node.task);
  } };
  const { runtime, dataDir } = await fixture(t, adapter);
  const { id } = runtime.createRun({ task: 'mission', maxAgents: 7, maxDepth: 2, concurrency: 2 });
  await until(() => runtime.getRun(id).status === 'completed');
  const run = runtime.getRun(id);
  assert.equal(run.nodes.length, 7); assert.equal(peak, 2);
  assert(run.nodes.every(node => node.status === 'completed'));
  assert.equal(run.result, 'mission/A/A + mission/A/B + mission/B/A + mission/B/B');
  assert.equal(await readFile(join(dataDir, id, 'report.md'), 'utf8'), run.result);
  const stored = JSON.parse(await readFile(join(dataDir, id, 'run.json'), 'utf8'));
  assert.equal(stored.status, 'completed');
  assert.equal(new Set(run.events.map(event => event.id)).size, run.events.length);
});

test('depth zero prevents delegation and oversized plans fail without exceeding crew budget', async t => {
  const { runtime } = await fixture(t, { async run({ canDelegate }) {
    assert.equal(canDelegate, false);
    return { summary: 'invalid plan', result: '', children: [{ name: 'Worker', role: 'Worker', task: 'extra' }] };
  } });
  const { id } = runtime.createRun({ task: 'mission', maxDepth: 0, maxAgents: 1 });
  await until(() => runtime.getRun(id).status === 'failed');
  assert.equal(runtime.getRun(id).nodes.length, 1);
  assert.match(runtime.getRun(id).error, /branch depth/);
});

test('global node reservation rejects oversized sibling plans atomically', async t => {
  const { runtime } = await fixture(t, { async run() { return { summary: '', result: '', children: [1, 2, 3].map(i => ({ name: `Crew ${i}`, role: 'Worker', task: 'child' })) }; } });
  const { id } = runtime.createRun({ task: 'mission', maxAgents: 2 });
  await until(() => runtime.getRun(id).status === 'failed');
  assert.equal(runtime.getRun(id).nodes.length, 1);
  assert.match(runtime.getRun(id).error, /crew budget/);
});

test('cancellation aborts active work, removes pending work, and never emits completion', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, { async run({ node, signal }) {
    calls++;
    if (node.depth === 0) return { summary: '', result: '', children: [1, 2].map(i => ({ name: `Crew ${i}`, role: 'Worker', task: 'wait' })) };
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return leaf();
  } });
  const { id } = runtime.createRun({ task: 'mission', concurrency: 1 });
  await until(() => calls === 2);
  runtime.cancelRun(id);
  await until(() => runtime.sessions.size === 0);
  const run = runtime.getRun(id);
  assert.equal(run.status, 'cancelled'); assert.equal(calls, 2);
  assert(!run.events.some(event => event.type === 'run.completed'));
  assert(run.nodes.every(node => node.status === 'cancelled'));
});

test('one failed child stops siblings and prevents parent synthesis', async t => {
  let synthesized = false;
  const { runtime } = await fixture(t, { async run({ node, signal, phase }) {
    if (phase === 'synthesize') synthesized = true;
    if (node.depth === 0) return { summary: '', result: '', children: ['bad', 'wait'].map(name => ({ name, role: 'Worker', task: name })) };
    if (node.name === 'bad') { await pause(20); throw new Error('Evidence unavailable'); }
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    return leaf();
  } });
  const { id } = runtime.createRun({ task: 'mission' });
  await until(() => runtime.sessions.size === 0);
  assert.equal(runtime.getRun(id).status, 'failed');
  assert.equal(runtime.getRun(id).error, 'Evidence unavailable'); assert.equal(synthesized, false);
});

test('run timeout aborts execution and records a failed expedition', async t => {
  const { runtime } = await fixture(t, { run: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })) }, { runTimeoutMs: 25 });
  const { id } = runtime.createRun({ task: 'mission' });
  await until(() => runtime.sessions.size === 0);
  assert.equal(runtime.getRun(id).status, 'failed'); assert.match(runtime.getRun(id).error, /time limit/);
});

test('restart retains completed history and marks active snapshots interrupted without execution', async t => {
  const { runtime, dataDir } = await fixture(t, { async run() { return leaf('saved'); } });
  const { id } = runtime.createRun({ task: 'mission' });
  await until(() => runtime.getRun(id).status === 'completed');
  const stored = runtime.getRun(id); stored.status = 'running'; stored.nodes[0].status = 'running';
  await writeFile(join(dataDir, id, 'run.json'), JSON.stringify(stored));
  let called = false;
  const restarted = new SwarmRuntime({ dataDir, adapterFactory: () => { called = true; } });
  await restarted.init();
  assert.equal(restarted.getRun(id).status, 'interrupted'); assert.equal(called, false);
  assert.equal(restarted.getRun(id).nodes[0].status, 'interrupted');
  await restarted.close();
});

test('input boundaries and adapter structured output reject malformed data', async t => {
  const { runtime } = await fixture(t, { async run() { return leaf(); } });
  for (const input of [{ task: '' }, { task: 'x', maxAgents: 8 }, { task: 'x', maxDepth: 3 }, { task: 'x', concurrency: 0 }, { task: 'x', mode: 'unknown' }]) assert.throws(() => runtime.createRun(input));
  assert.throws(() => validateResult({ summary: '', result: 'x', children: [{}] }));
  assert.throws(() => validateResult({ summary: '', result: 'x'.repeat(24001), children: [] }));
});

test('Codex adapter uses real subprocess transport with bounded flags and structured output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hog-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const command = join(dir, 'fake-codex');
  await writeFile(command, `#!/usr/bin/env node\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.writeFileSync('args.json',JSON.stringify(args)); process.stdin.resume(); process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.completed'})); fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({summary:'Done',result:'Verified transport',children:[]}));});`);
  await chmod(command, 0o700);
  const adapter = new CodexAdapter({ command, timeoutMs: 2000 });
  const activities = [];
  const result = await adapter.run({ node: { name: 'Tester', role: 'Verifier' }, task: 'test', phase: 'plan', children: [], canDelegate: false, remainingAgents: 0, signal: new AbortController().signal, onActivity: x => activities.push(x), cwd: dir });
  assert.equal(result.result, 'Verified transport'); assert(activities.length);
  const args = JSON.parse(await readFile(join(dir, 'args.json'), 'utf8'));
  assert(args.includes('--ignore-user-config')); assert(args.includes('--ephemeral'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--disable') + 1], 'multi_agent');
});

test('Codex transport timeout kills a non-responsive subprocess', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hog-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const command = join(dir, 'fake-codex');
  await writeFile(command, '#!/usr/bin/env node\nsetInterval(()=>{},1000);'); await chmod(command, 0o700);
  const adapter = new CodexAdapter({ command, timeoutMs: 50 });
  await assert.rejects(adapter.run({ node: { name: 'Tester', role: 'Verifier' }, task: 'test', phase: 'plan', children: [], canDelegate: false, remainingAgents: 0, signal: new AbortController().signal, onActivity: () => {}, cwd: dir }), /turn limit/);
});

test('concurrent planners receive non-overlapping helper reservations', async t => {
  const allowances = [];
  const adapter = { async run({ node, phase, canDelegate, remainingAgents }) {
    if (phase === 'synthesize') return leaf('Joined within budget.');
    if (node.depth === 1) allowances.push(remainingAgents);
    await pause(20);
    if (canDelegate) return { summary: 'Delegating within reserved allowance.', result: '', children: Array.from({ length: remainingAgents }, (_, i) => ({ name: `${node.depth}-${i}`, role: 'Worker', task: `Bounded ${node.depth}-${i}` })) };
    return leaf();
  } };
  const { runtime } = await fixture(t, adapter);
  const { id } = runtime.createRun({ task: 'mission', maxAgents: 6, concurrency: 3 });
  await until(() => ['completed', 'failed'].includes(runtime.getRun(id).status));
  assert.equal(runtime.getRun(id).status, 'completed');
  assert.equal(runtime.getRun(id).nodes.length, 6);
  assert.deepEqual(allowances.sort(), [1, 2]);
});

test('unused helper reservations are released before parent synthesis', async t => {
  let calls = 0;
  const { runtime } = await fixture(t, { async run({ node, phase, remainingAgents }) {
    calls++;
    if (phase === 'synthesize') { assert.equal(remainingAgents, 0); return leaf(); }
    if (node.depth === 0) return { summary: '', result: '', children: [{ name: 'One', role: 'Worker', task: 'one child' }] };
    return leaf();
  } });
  const { id } = runtime.createRun({ task: 'mission', maxAgents: 3 });
  await until(() => runtime.getRun(id).status === 'completed');
  assert.equal(calls, 3); assert.equal(runtime.getRun(id).nodes.length, 2);
});

test('Codex protocol failure terminates a child process group before returning', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hog-process-group-'));
  let grandchildPid;
  t.after(async () => {
    if (grandchildPid) { try { process.kill(grandchildPid, 'SIGKILL'); } catch {} }
    await rm(dir, { recursive: true, force: true });
  });
  const command = join(dir, 'fake-codex');
  await writeFile(command, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"], { stdio: 'ignore' });
fs.writeFileSync('grandchild.pid', String(child.pid));
setTimeout(()=>console.log(JSON.stringify({type:'error',message:'provider failed'})),150);
setInterval(()=>{},1000);
`);
  await chmod(command, 0o700);
  const adapter = new CodexAdapter({ command, timeoutMs: 8000 });
  await assert.rejects(adapter.run({ node: { name: 'Tester', role: 'Verifier' }, task: 'test', phase: 'plan', children: [], canDelegate: false, remainingAgents: 0, signal: new AbortController().signal, onActivity: () => {}, cwd: dir }), /execution error/);
  grandchildPid = Number(await readFile(join(dir, 'grandchild.pid'), 'utf8'));
  await until(() => { try { process.kill(grandchildPid, 0); return false; } catch { return true; } });
});
