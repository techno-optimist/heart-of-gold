import { FlightError } from './flight-store.mjs';
import { ProjectError } from './project-contract.mjs';

export const MAX_ARTIFACT_BODY_BYTES = 384 * 1024;
export const MAX_STREAM_BUFFER_BYTES = 512 * 1024;
const BASE = '/heartofgold/artifacts';
const requestError = (status, code, message) => Object.assign(new Error(message), { status, code });

function readBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    let bytes = 0, done = false; const chunks = [];
    function finish(error, value) {
      if (done) return; done = true; clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('aborted', abort); req.off('error', abort);
      if (error) { req.resume(); reject(error); } else resolve(value);
    }
    const data = chunk => { bytes += chunk.length; if (bytes > limit) finish(requestError(413, 'ARTIFACT_TOO_LARGE', 'The artifact request exceeds its byte limit.')); else chunks.push(chunk); };
    const end = () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); finish(null, value); } catch { finish(requestError(400, 'INVALID_ARTIFACT', 'Use a valid JSON object.')); } };
    const abort = () => finish(requestError(400, 'REQUEST_INTERRUPTED', 'The artifact request was interrupted.'));
    const timer = setTimeout(() => finish(requestError(408, 'REQUEST_TIMEOUT', 'The artifact request timed out.')), timeoutMs); timer.unref?.();
    req.on('data', data); req.once('end', end); req.once('aborted', abort); req.once('error', abort);
  });
}

/** Capability-only routes, isolated from website cookies and provider sessions. */
export function createArtifactStreamHandler({ store, publicOrigin = 'https://projectforty2.ai', allowedOrigins,
  now = Date.now, heartbeatMs = 20_000, bodyTimeoutMs = 10_000, maxPendingRequests = 32,
  maxBufferBytes = MAX_STREAM_BUFFER_BYTES } = {}) {
  if (!store) throw new Error('An artifact flight store is required.');
  const origins = new Set(allowedOrigins || [publicOrigin, 'https://chatgpt.com', 'https://chat.openai.com', 'https://projectforty2-ai.web-sandbox.oaiusercontent.com']);
  const clients = new Set(); let closed = false, pending = 0, tokens = 120, rateAt = now();
  function json(res, status, value) { if (res.destroyed || res.headersSent) return; res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  function errorResponse(res, error) {
    const known = error instanceof FlightError || error instanceof ProjectError || error.status;
    const code = known ? error.code : 'ARTIFACT_ERROR';
    const status = error.status || ({ FLIGHT_UNAVAILABLE: 401, ARTIFACT_UNAVAILABLE: 401, PROJECT_CONFLICT: 409, BATCH_CONFLICT: 409,
      OBSERVER_LIMIT: 429, ARTIFACT_RATE_LIMIT: 429, ARTIFACT_SCOPE: 403, FLIGHT_TOO_LARGE: 413, PROJECT_TOO_LARGE: 413, FLIGHT_CAPACITY: 503 }[code] || (known ? 400 : 500));
    if (status === 429) res.setHeader('Retry-After', '1');
    json(res, status, { error: { code, message: known ? error.message : 'The artifact request could not be processed.',
      ...(error.currentProjectRevision !== undefined ? { currentProjectRevision: error.currentProjectRevision, scopedFiles: error.scopedFiles } : {}) } });
  }
  return {
    async handle(req, res) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      let counted = false;
      try {
        const url = new URL(req.url, publicOrigin);
        if (![`${BASE}/write`, `${BASE}/events`].includes(url.pathname) || url.search) throw requestError(404, 'NOT_FOUND', 'Unknown artifact route.');
        if (req.headers.origin && !origins.has(req.headers.origin)) throw requestError(403, 'ORIGIN_DENIED', 'This artifact origin is not allowed.');
        if (req.headers.origin) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin'); }
        if (req.method === 'OPTIONS') {
          const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
          if (req.headers['access-control-request-method'] !== 'POST' || requested.some(header => !['content-type', 'accept'].includes(header))) throw requestError(403, 'PREFLIGHT_DENIED', 'Only credentialless JSON POST requests are supported.');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
          res.writeHead(204); res.end(); return;
        }
        if (closed) throw requestError(503, 'ARTIFACT_UNAVAILABLE', 'The artifact service is unavailable.');
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); throw requestError(405, 'METHOD_NOT_ALLOWED', 'Use POST for artifact requests.'); }
        if (req.headers.cookie || req.headers.authorization) throw requestError(400, 'CREDENTIALS_NOT_ALLOWED', 'Use only the scoped capability in the request body.');
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw requestError(415, 'CONTENT_TYPE', 'Use application/json.');
        const limit = url.pathname.endsWith('/events') ? 2048 : MAX_ARTIFACT_BODY_BYTES;
        if (Number(req.headers['content-length']) > limit) { req.resume(); throw requestError(413, 'ARTIFACT_TOO_LARGE', 'The artifact request exceeds its byte limit.'); }
        const time = now(); tokens = Math.min(120, tokens + Math.max(0, time - rateAt) / 1000 * 20); rateAt = time;
        if (tokens < 1 || pending >= maxPendingRequests) throw requestError(429, 'ARTIFACT_RATE_LIMIT', 'The artifact service is busy. Retry after a short delay.');
        tokens--; pending++; counted = true;
        const input = await readBody(req, limit, bodyTimeoutMs);
        if (url.pathname.endsWith('/write')) { json(res, 200, store.writeArtifacts(input)); return; }
        if (Object.keys(input).some(key => !['flightId', 'readToken', 'afterRevision'].includes(key)) || !/^[a-f0-9]{32}$/.test(input.flightId || '') || !/^[A-Za-z0-9_-]{43}$/.test(input.readToken || '') ||
          (input.afterRevision !== undefined && (!Number.isSafeInteger(input.afterRevision) || input.afterRevision < 1))) throw requestError(400, 'INVALID_ARTIFACT', 'The stream request does not meet its field limits.');
        let unsubscribe, heartbeat, ended = false;
        const cleanup = () => { if (ended) return; ended = true; clearInterval(heartbeat); unsubscribe?.(); clients.delete(stop); res.off('close', cleanup); };
        const stop = () => { cleanup(); res.end(); };
        const emit = (type, value) => {
          if (ended || res.destroyed) { cleanup(); return; }
          const message = `${value.flight ? `id: ${value.flight.revision}\n` : ''}event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
          if (res.writableLength + Buffer.byteLength(message) > maxBufferBytes) { cleanup(); res.destroy(); return; }
          res.write(message); if (type === 'expired') stop();
        };
        const initial = store.subscribe(input.flightId, input.readToken, emit); unsubscribe = initial.unsubscribe;
        clients.add(stop); res.once('close', cleanup);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        emit('snapshot', { ...initial.snapshot, flight: initial.flight, resync: true });
        if (!ended) { heartbeat = setInterval(() => { store.sweep(); if (ended) return; if (res.writableLength > maxBufferBytes) { cleanup(); res.destroy(); } else res.write(': heartbeat\n\n'); }, heartbeatMs); heartbeat.unref?.(); }
      } catch (error) { errorResponse(res, error); }
      finally { if (counted) pending--; }
    },
    close() { closed = true; for (const stop of [...clients]) stop(); },
  };
}
