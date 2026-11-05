import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SwarmRuntime } from './lib/runtime.mjs';
import { DemoAdapter } from './lib/adapters.mjs';
import { HostedSessions, SharedGate, WindowRateLimit } from './lib/hosted-sessions.mjs';
import { discoverModels, ProviderAdapter, PROVIDERS } from './lib/provider-adapter.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const BASE = '/heartofgold';
export const COOKIE = '__Secure-hog';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code, public: true });
function sessionId(req) {
  const values = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
  if (values.length !== 1) return null;
  const id = values[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(id) ? id : null;
}
async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw httpError(415, 'CONTENT_TYPE', 'Send application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw httpError(413, 'BODY_TOO_LARGE', 'Request exceeds 16 KiB.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw httpError(400, 'INVALID_JSON', 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'INVALID_BODY', 'A JSON object is required.');
  return value;
}
function providerError(error) {
  const codes = {
    authentication: ['PROVIDER_AUTH', 'The provider rejected these credentials. Check the API key and account permissions.'],
    rate_limit: ['PROVIDER_RATE_LIMIT', 'The provider rate or quota limit was reached.'],
    unavailable: ['PROVIDER_UNAVAILABLE', 'The provider is temporarily unavailable.'],
    timeout: ['PROVIDER_TIMEOUT', 'The provider request timed out.'],
    cancelled: ['REQUEST_CANCELLED', 'The request was cancelled.'],
  };
  const [code, message] = codes[error?.code] || ['PROVIDER_REQUEST_FAILED', 'The provider request could not be completed. Check the selected provider, key, workspace, and model.'];
  return httpError([401, 403, 429].includes(error?.status) ? error.status : 400, code, message);
}

export async function createHostedServer({
  publicOrigin = process.env.PUBLIC_ORIGIN || 'https://projectforty2.ai',
  dev = process.env.HOSTED_DEV === 'true',
  ingressToken = process.env.HOG_INGRESS_TOKEN || '',
  publicDir = path.join(ROOT, 'public'),
  discover = discoverModels,
  adapterFactory = options => new ProviderAdapter(options),
  now = Date.now,
  maxSessions = 32,
  idleMs = 20 * 60000,
  absoluteMs = 60 * 60000,
  maxLiveRuns = 8,
  globalConcurrency = 6,
} = {}) {
  const parsedOrigin = new URL(publicOrigin);
  if (parsedOrigin.origin !== publicOrigin || (parsedOrigin.protocol !== 'https:' && !(dev && ['localhost', '127.0.0.1'].includes(parsedOrigin.hostname)))) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (localhost HTTP requires HOSTED_DEV=true).');
  const gate = new SharedGate(globalConcurrency);
  const globalRequests = new WindowRateLimit({ limit: 1200, windowMs: 60000, now });
  const ipRequests = new WindowRateLimit({ limit: 600, windowMs: 60000, now });
  const sessionRequests = new WindowRateLimit({ limit: 240, windowMs: 60000, now });
  const sessionCreates = new WindowRateLimit({ limit: 32, windowMs: 60000, now });
  const connects = new WindowRateLimit({ limit: 6, windowMs: 60000, now });
  const launches = new WindowRateLimit({ limit: 6, windowMs: 60000, now });
  let liveRuns = 0;
  const countedRuns = new Set();
  const sessions = new HostedSessions({ maxSessions, idleMs, absoluteMs, now, runtimeFactory(session) {
    const runtime = new SwarmRuntime({ memoryOnly: true, allowedModes: ['demo', 'api'], maxHistory: 5, adapterFactory(mode) {
      if (mode === 'demo') return new DemoAdapter();
      const credential = sessions.credential(session);
      if (!session.connection || !credential?.key) throw httpError(401, 'PROVIDER_NOT_CONNECTED', 'Connect your own provider key first.');
      const adapter = adapterFactory({ provider: session.connection.provider, model: session.connection.model, key: credential.key, workspaceId: credential.workspaceId, gate });
      return { async run(input) {
        try { return await adapter.run(input); }
        catch (error) {
          if ([401, 403].includes(error?.status) && sessions.credential(session) === credential) {
            sessions.clearCredential(session);
            broadcast(session, { id: 'connection', type: 'connection.changed', at: new Date(now()).toISOString(), data: { connected: false } });
          }
          throw providerError(error);
        }
      } };
    } });
    runtime.on('event', event => {
      if (event.type === 'run.created' && event.data.mode === 'api') { countedRuns.add(event.runId); liveRuns++; }
      if (['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted'].includes(event.type) && countedRuns.delete(event.runId)) liveRuns--;
      broadcast(session, event);
    });
    return runtime;
  } });
  function broadcast(session, event) {
    const message = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of session.clients) {
      if (client.destroyed || client.writableLength > 1024 * 1024) { client.destroy(); session.clients.delete(client); }
      else client.write(message);
    }
  }
  const config = session => ({
    token: session.token, hosted: true, version: '0.2.0', providers: PROVIDERS,
    adapters: { demo: { available: true, detail: 'Scripted simulation. No model calls.' }, api: { available: !!session.connection, detail: 'Your API provider. Text-only bounded missions.' }, codex: { available: false, detail: 'Codex CLI is available only in the local app.' } },
    connection: session.connection ? { provider: session.connection.provider, model: session.connection.model, models: session.connection.models, expiresAt: new Date(sessions.expiresAt(session)).toISOString() } : null,
  });
  const send = (res, status, value) => { if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const setCookie = (res, session) => res.setHeader('Set-Cookie', `${COOKIE}=${session.id}; Path=${BASE}/; HttpOnly; SameSite=Strict; Secure; Max-Age=${Math.floor((session.absoluteExpiresAt - now()) / 1000)}`);
  const active = session => session.runtime.listRuns().some(run => !TERMINAL.has(run.status));
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!req.url?.startsWith('/')) throw httpError(400, 'INVALID_PATH', 'Invalid request path.');
      const url = new URL(req.url, publicOrigin);
      if (req.method === 'GET' && url.pathname === `${BASE}/api/health`) return send(res, 200, { ok: true, version: '0.2.0' });
      if (ingressToken && !equal(req.headers['x-hog-ingress'], ingressToken)) throw httpError(403, 'INGRESS_DENIED', 'Use the ProjectForty2 flight deck.');
      const ip = ingressToken && req.headers['x-hog-client-ip'] ? String(req.headers['x-hog-client-ip']).slice(0, 100) : req.socket.remoteAddress;
      if (!globalRequests.take('all') || !ipRequests.take(ip)) throw httpError(429, 'REQUEST_LIMIT', 'Too many requests. Please wait a minute.');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== publicOrigin)) throw httpError(403, 'ORIGIN_DENIED', 'Requests must come from the ProjectForty2 flight deck.');
      if (['POST', 'DELETE', 'PUT', 'PATCH'].includes(req.method) && req.headers.origin !== publicOrigin) throw httpError(403, 'ORIGIN_REQUIRED', 'A matching request origin is required.');
      if (url.pathname === BASE) { res.writeHead(308, { Location: `${BASE}/` }); res.end(); return; }
      if (!url.pathname.startsWith(`${BASE}/`)) throw httpError(404, 'NOT_FOUND', 'Page not found.');
      if (url.pathname.startsWith(`${BASE}/api/`)) {
        let session = sessions.get(sessionId(req));
        if (req.method === 'GET' && url.pathname === `${BASE}/api/config`) {
          if (!session) {
            if (!sessionCreates.take(ip)) throw httpError(429, 'SESSION_RATE_LIMIT', 'Too many new sessions. Please wait a minute.');
            session = await sessions.create(); setCookie(res, session);
          }
          return send(res, 200, config(session));
        }
        if (!session) throw httpError(401, 'SESSION_EXPIRED', 'Your temporary session ended. Reconnect your provider to continue.');
        if (!sessionRequests.take(session.rateId)) throw httpError(429, 'SESSION_RATE_LIMIT', 'This session is sending too many requests.');
        if (req.method === 'POST' && !equal(req.headers['x-flight-token'], session.token)) throw httpError(403, 'CSRF_INVALID', 'The flight token changed. Refresh the connection and try again.');
        if (req.method === 'POST' && url.pathname === `${BASE}/api/connect`) {
          if (!connects.take(session.rateId)) throw httpError(429, 'CONNECT_RATE_LIMIT', 'Too many connection attempts. Please wait a minute.');
          const input = await body(req);
          if (session.busy || active(session)) throw httpError(409, 'SESSION_BUSY', 'Stop the current mission before changing providers.');
          if (!PROVIDERS.some(provider => provider.id === input.provider)) throw httpError(400, 'INVALID_PROVIDER', 'Choose a supported provider.');
          if (typeof input.key !== 'string' || input.key.trim().length < 8 || input.key.length > 4096 || /[\r\n]/.test(input.key)) throw httpError(400, 'INVALID_KEY', 'Enter a valid API key.');
          if (input.workspaceId !== undefined && (typeof input.workspaceId !== 'string' || input.workspaceId.length > 200 || /[\r\n]/.test(input.workspaceId))) throw httpError(400, 'INVALID_WORKSPACE', 'Invalid workspace identifier.');
          session.busy = true; sessions.clearCredential(session);
          const attempt = ++session.connectionAttempt;
          session.connectController = new AbortController();
          try {
            const key = input.key.trim();
            const models = await discover({ provider: input.provider, key, workspaceId: input.workspaceId, signal: AbortSignal.any([session.controller.signal, session.connectController.signal, AbortSignal.timeout(20000)]) });
            if (attempt !== session.connectionAttempt) throw httpError(409, 'CONNECTION_CANCELLED', 'The provider connection was cancelled.');
            if (!session.alive || !sessions.get(session.id, false)) throw httpError(401, 'SESSION_EXPIRED', 'The session expired during connection.');
            if (!Array.isArray(models) || !models.length || models.length > 200 || models.some(model => typeof model.id !== 'string' || !model.id || model.id.length > 160)) throw httpError(400, 'NO_MODELS', 'No supported text models were available for this key.');
            sessions.rotate(session);
            sessions.setCredential(session, { key, workspaceId: input.workspaceId }, { provider: input.provider, model: models[0].id, models: models.map(model => ({ id: model.id, label: String(model.label || model.id).slice(0, 160) })) });
            setCookie(res, session); return send(res, 200, config(session));
          } catch (error) { throw error.public ? error : providerError(error); }
          finally { session.busy = false; session.connectController = null; }
        }
        if (req.method === 'POST' && url.pathname === `${BASE}/api/model`) {
          const input = await body(req);
          if (session.busy || active(session)) throw httpError(409, 'SESSION_BUSY', 'Stop the current mission before changing models.');
          if (!session.connection) throw httpError(401, 'PROVIDER_NOT_CONNECTED', 'Connect a provider first.');
          if (!session.connection.models.some(model => model.id === input.model)) throw httpError(400, 'INVALID_MODEL', 'Choose a model returned by your provider.');
          session.connection.model = input.model; return send(res, 200, config(session));
        }
        if (req.method === 'POST' && url.pathname === `${BASE}/api/disconnect`) {
          await body(req);
          session.connectionAttempt++; session.connectController?.abort();
          sessions.clearCredential(session);
          await session.runtime.cancelAll();
          return send(res, 200, config(session));
        }
        if (req.method === 'GET' && url.pathname === `${BASE}/api/runs`) return send(res, 200, session.runtime.listRuns());
        if (req.method === 'POST' && url.pathname === `${BASE}/api/runs`) {
          const input = await body(req);
          if (session.busy || active(session)) throw httpError(409, 'SESSION_BUSY', 'One mission at a time. Finish or stop the current flight.');
          if (!launches.take(session.rateId)) throw httpError(429, 'RUN_RATE_LIMIT', 'Too many missions. Please wait a minute.');
          if (!['demo', 'api'].includes(input.mode)) throw httpError(400, 'INVALID_MODE', 'Hosted missions use demo or API mode.');
          if (input.mode === 'api' && (!session.connection || !sessions.credential(session)?.key)) throw httpError(401, 'PROVIDER_NOT_CONNECTED', 'Connect your own provider key first.');
          if (input.mode === 'api' && liveRuns >= maxLiveRuns) throw httpError(503, 'FLIGHT_CAPACITY', 'The ship has enough live missions for now. Please try again later.');
          if (typeof input.task !== 'string' || input.task.trim().length < 8 || input.task.length > 6000) throw httpError(400, 'INVALID_TASK', 'Describe a mission in 8–6,000 characters.');
          for (const [field, min, max] of [['maxAgents', 1, 7], ['maxDepth', 0, 2], ['concurrency', 1, 3]]) if (input[field] !== undefined && (!Number.isInteger(input[field]) || input[field] < min || input[field] > max)) throw httpError(400, 'INVALID_LIMIT', `${field} must be an integer from ${min} to ${max}.`);
          const secret = sessions.credential(session)?.key;
          if (secret && input.task.includes(secret)) throw httpError(400, 'SECRET_IN_TASK', 'Keep your API key out of mission text.');
          const run = session.runtime.createRun({ task: input.task.trim(), mode: input.mode, maxAgents: input.maxAgents, maxDepth: input.maxDepth, concurrency: input.concurrency, ...(input.mode === 'api' ? { provider: session.connection.provider, model: session.connection.model } : {}) });
          return send(res, 201, run);
        }
        const match = url.pathname.match(/^\/heartofgold\/api\/runs\/([a-f0-9-]{36})(\/cancel)?$/);
        if (match) {
          const run = session.runtime.getRun(match[1]);
          if (!run) throw httpError(404, 'RUN_NOT_FOUND', 'Flight not found.');
          if (req.method === 'GET' && !match[2]) return send(res, 200, run);
          if (req.method === 'POST' && match[2]) { await body(req); return send(res, 200, session.runtime.cancelRun(match[1])); }
        }
        if (req.method === 'GET' && url.pathname === `${BASE}/api/events`) {
          if (session.clients.size >= 2) throw httpError(429, 'OBSERVER_LIMIT', 'This session already has two observers.');
          res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(': heart-of-gold connected\n\n'); session.clients.add(res);
          const heartbeat = setInterval(() => { if (session.alive) res.write(': still here\n\n'); else res.end(); }, 20000);
          req.on('close', () => { clearInterval(heartbeat); session.clients.delete(res); });
          return;
        }
        throw httpError(404, 'NOT_FOUND', 'Unknown flight-control route.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      const relative = decodeURIComponent(url.pathname.slice(BASE.length));
      const filename = path.resolve(publicDir, '.' + (relative === '/' ? '/index.html' : relative));
      if (!filename.startsWith(path.resolve(publicDir) + path.sep)) throw httpError(404, 'NOT_FOUND', 'Page not found.');
      try {
        let content = await readFile(filename);
        if (path.basename(filename) === 'index.html') content = Buffer.from(content.toString().replace(/<html\b([^>]*)>/i, '<html$1 data-runtime="hosted">'));
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(filename)] || 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content);
      } catch { throw httpError(404, 'NOT_FOUND', 'Page not found.'); }
    } catch (error) {
      send(res, error.public ? error.status : 500, { error: error.public ? error.message : 'Flight control could not complete that request.', code: error.public ? error.code : 'INTERNAL_ERROR' });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  const sweepTimer = setInterval(() => { void sessions.sweep(); }, 10000); sweepTimer.unref();
  return {
    server, sessions, gate,
    async listen(port = 4242, host = '0.0.0.0') { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); return `http://${host}:${server.address().port}${BASE}/`; },
    async close() { clearInterval(sweepTimer); await sessions.close(); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4242);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const flight = await createHostedServer(); await flight.listen(port);
  console.log('Heart of Gold hosted service ready. Temporary sessions; user-owned provider access.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await flight.close(); process.exit(0); });
}
