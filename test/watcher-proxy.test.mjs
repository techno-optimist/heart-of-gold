import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { needsProxyBootstrap } from '../lib/project-watcher.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const privateProxy = 'http://proxy-user:proxy-private-value@127.0.0.1:1';

test('proxy startup respects existing host settings and explicit opt-out without disclosing values', () => {
  const decide = (env, nodeVersion = '22.21.0', execArgv = []) => needsProxyBootstrap({ env, nodeVersion, execArgv });
  assert.equal(decide({}), false);
  assert.equal(decide({ HTTPS_PROXY: privateProxy }), true);
  assert.equal(decide({ http_proxy: privateProxy }, '24.0.0'), true);
  assert.equal(decide({ HTTPS_PROXY: privateProxy, NODE_USE_ENV_PROXY: '1' }), false, 'child does not restart twice');
  for (const value of ['0', '', 'false']) assert.equal(decide({ HTTPS_PROXY: privateProxy, NODE_USE_ENV_PROXY: value }, '22.0.0'), false);
  assert.equal(decide({ HTTPS_PROXY: privateProxy }, '26.0.0', ['--no-use-env-proxy']), false);
  assert.equal(decide({ HTTPS_PROXY: privateProxy, NODE_OPTIONS: '--no-use-env-proxy' }), false);
  assert.equal(decide({ HTTPS_PROXY: privateProxy, NODE_OPTIONS: '"--use-env-proxy"' }), false);
  assert.equal(decide({ ALL_PROXY: privateProxy }), false, 'does not invent an HTTP proxy from ALL_PROXY');
  for (const version of ['20.19.0', '22.20.0', '23.11.0']) assert.throws(() => decide({ HTTPS_PROXY: privateProxy }, version), cause => cause.code === 'PROXY_NODE_UNSUPPORTED' && !cause.message.includes('proxy-private-value'));
  for (const value of ['http://synthetic-user:synthetic-password@bad host', 'unsupported://synthetic-user:synthetic-password@localhost', 'http://synthetic-user:%not-valid@localhost']) {
    assert.throws(() => decide({ HTTPS_PROXY: value }), cause => cause.code === 'INVALID_PROXY_CONFIGURATION' && !cause.message.includes('synthetic'));
    assert.equal(decide({ HTTPS_PROXY: value, NODE_USE_ENV_PROXY: '0' }), false, 'explicit opt-out remains intact');
  }
  assert.equal(decide({ https_proxy: privateProxy, HTTPS_PROXY: 'invalid credential-bearing address' }), true, 'unused uppercase value does not override the effective lowercase setting');
});

test('automatic bootstrap rejects a malformed credential-bearing proxy before Node can print it', () => {
  const env = { ...process.env, HTTPS_PROXY: 'http://synthetic-user:synthetic-password@bad host' };
  for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS']) delete env[key];
  // The parent intentionally starts without proxy activation. A host that enables
  // invalid proxy settings before launching any JS fails outside CLI control.
  const result = spawnSync(process.execPath, ['scripts/watch-project.mjs', '--root', '/unused-artifacts', '--manifest', '/unused-bindings.json'], { env, input: '', encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.code, 'INVALID_PROXY_CONFIGURATION');
  assert(!`${result.stdout}${result.stderr}`.includes('synthetic-user'));
  assert(!`${result.stdout}${result.stderr}`.includes('synthetic-password'));
  assert(!`${result.stdout}${result.stderr}`.includes('bad host'));
  assert.equal(result.stderr, '');
});

async function localTransport(t, extraEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hog-proxy-'));
  const root = join(directory, 'source'); await mkdir(root);
  const manifestPath = join(directory, 'bindings.json');
  await writeFile(manifestPath, JSON.stringify({ bindings: [{ componentId: 'shell', label: 'Shell', memberId: 'lead', filePaths: ['index.html'] }] }));
  await writeFile(join(root, 'index.html'), '<main>First real source</main>');
  const payloads = [], sockets = new Set(); let revision = 0, currentHash = null, proxyConnections = 0;
  const origin = createServer(async (request, response) => {
    assert.equal(request.url, '/heartofgold/artifacts/write');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks)); payloads.push(payload);
    if (payload.upserts.length) { currentHash = sha(payload.upserts[0].content); revision++; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ updated: payload.upserts.length > 0, projectRevision: revision, sourceDigest: sha(currentHash || ''), acceptedBatchId: payload.batchId, scopedFiles: [{ path: 'index.html', sha256: currentHash }] }));
  });
  const proxy = createServer((request, response) => {
    proxyConnections++;
    const target = new URL(request.url);
    assert.equal(target.hostname, '127.0.0.1'); assert.equal(Number(target.port), origin.address().port);
    const headers = { ...request.headers }; delete headers['proxy-authorization'];
    const upstream = httpRequest(target, { method: request.method, headers, agent: false }, incoming => { response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response); });
    upstream.on('error', () => response.destroy()); request.pipe(upstream);
  });
  for (const server of [origin, proxy]) server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', (request, socket, head) => {
    proxyConnections++;
    const [host, port] = request.url.split(':');
    assert.equal(host, '127.0.0.1'); assert.equal(Number(port), origin.address().port);
    const upstream = connect(Number(port), host, () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); socket.pipe(upstream); upstream.pipe(socket); });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  });
  await Promise.all([origin, proxy].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const env = { ...process.env };
  for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_OPTIONS']) delete env[key];
  Object.assign(env, { HTTP_PROXY: `http://proxy-user:proxy-private-value@127.0.0.1:${proxy.address().port}`, NO_PROXY: '', ...extraEnv });
  const child = spawn(process.execPath, ['scripts/watch-project.mjs', '--root', root, '--manifest', manifestPath], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; let stdout = '', stderr = '', buffer = '';
  child.stdout.on('data', chunk => { stdout += chunk; buffer += chunk; const parts = buffer.split('\n'); buffer = parts.pop(); for (const line of parts) if (line) lines.push(JSON.parse(line)); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(JSON.stringify({ flightId: 'a'.repeat(32), artifactToken: 'z'.repeat(43), ingestUrl: `http://127.0.0.1:${origin.address().port}/heartofgold/artifacts/write`, projectRevision: 0, scopedFiles: [{ path: 'index.html', sha256: null }] }));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); for (const socket of sockets) socket.destroy(); await Promise.all([origin, proxy].map(server => new Promise(resolve => server.close(resolve)))); await closed; await rm(directory, { recursive: true, force: true }); });
  return { child, root, closed, payloads, lines, get proxyConnections() { return proxyConnections; }, output: () => stdout + stderr,
    async until(predicate) { const end = Date.now() + 8000; while (!predicate() && Date.now() < end) await delay(15); assert(predicate(), 'Expected local transport receipt before deadline'); },
  };
}

test('CLI restarts with inherited private stdin, uses the host HTTP proxy, and SIGTERM drains a final save', { timeout: 15000 }, async t => {
  const f = await localTransport(t);
  await f.until(() => f.lines.some(row => row.event === 'artifact.accepted'));
  assert(f.proxyConnections > 0);
  assert.equal(f.lines.filter(row => row.event === 'watch.ready').length, 1);
  await writeFile(join(f.root, 'index.html'), '<main>Final real source</main>');
  f.child.kill('SIGTERM');
  assert.deepEqual(await f.closed, { code: 0, signal: null });
  assert.equal(f.payloads.at(-1).upserts[0].content, '<main>Final real source</main>');
  assert(!f.output().includes('proxy-private-value')); assert(!f.output().includes('z'.repeat(43))); assert(!f.output().includes('Final real source'));
});

test('local endpoint still works with NO_PROXY and explicit Node proxy opt-out', { timeout: 20000 }, async t => {
  for (const env of [{ NO_PROXY: '*' }, { NODE_USE_ENV_PROXY: '0' }]) {
    await t.test(JSON.stringify(env), async sub => {
      const f = await localTransport(sub, env);
      await f.until(() => f.lines.some(row => row.event === 'artifact.accepted'));
      f.child.kill('SIGTERM'); assert.equal((await f.closed).code, 0);
      assert.equal(f.proxyConnections, 0);
    });
  }
});
