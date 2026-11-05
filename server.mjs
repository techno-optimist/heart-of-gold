import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SwarmRuntime } from './lib/runtime.mjs';
import { availability } from './lib/adapters.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png' };

export async function createFlightServer({ dataDir = path.join(ROOT, '.flight-data'), publicDir = path.join(ROOT, 'public'), runtime: suppliedRuntime } = {}) {
  const runtime = suppliedRuntime ?? new SwarmRuntime({ dataDir });
  await runtime.init();
  const token = randomBytes(32).toString('hex');
  const clients = new Set();
  let adapters;
  const send = (res, code, value) => {
    res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  const equal = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const body = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Send application/json.'), {status:415});
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16384) throw Object.assign(new Error('Mission is too large (16 KiB limit).'), {status:413});
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw Object.assign(new Error('Invalid JSON.'), {status:400}); }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const hosts = new Set([`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`]);
    const origin = req.headers.origin;
    if (!hosts.has(req.headers.host) || (origin && ![...hosts].some(h => origin === `http://${h}`)) || req.headers['sec-fetch-site'] === 'cross-site') {
      return send(res, 403, { error:'This flight deck accepts same-origin, loopback requests only.' });
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'POST' && !equal(req.headers['x-flight-token'])) return send(res,403,{error:'Missing or invalid flight token. Reload the flight deck.'});
      if (req.method === 'GET' && url.pathname === '/api/config') {
        adapters ??= await availability();
        return send(res,200,{token,adapters,version:'0.1.0'});
      }
      if (req.method === 'GET' && url.pathname === '/api/runs') return send(res,200,runtime.listRuns());
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'A mission object is required.'});
        if (runtime.listRuns().some(r => ['running','queued','waiting'].includes(r.status))) return send(res,409,{error:'One mission at a time. Finish or cancel the active flight first.'});
        if (!['demo','codex'].includes(input.mode)) return send(res,400,{error:'Choose demo or codex mode.'});
        if (typeof input.task !== 'string' || input.task.trim().length < 8 || input.task.length > 6000) return send(res,400,{error:'Describe a mission in 8–6,000 characters.'});
        for (const [key,min,max] of [['maxAgents',1,7],['maxDepth',0,2],['concurrency',1,3]]) {
          if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key] < min || input[key] > max)) return send(res,400,{error:`${key} must be an integer from ${min} to ${max}.`});
        }
        if (input.mode === 'codex') {
          adapters = await availability();
          if (!adapters.codex.available) return send(res,503,{error:adapters.codex.detail});
        }
        if (runtime.listRuns().some(r => ['running','queued','waiting'].includes(r.status))) return send(res,409,{error:'A flight launched while this request was being prepared. Finish or cancel it first.'});
        const run = await runtime.createRun({task:input.task.trim(),mode:input.mode,maxAgents:input.maxAgents ?? 7,maxDepth:input.maxDepth ?? 2,concurrency:input.concurrency ?? 3});
        return send(res,201,run);
      }
      const match = url.pathname.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)(\/cancel)?$/);
      if (match) {
        const run = runtime.getRun(match[1]);
        if (!run) return send(res,404,{error:'Flight not found.'});
        if (req.method === 'POST' && match[2]) return send(res,200,await runtime.cancelRun(match[1]));
        if (req.method === 'GET' && !match[2]) return send(res,200,run);
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 20) return send(res,429,{error:'Too many observers.'});
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(': heart-of-gold connected\n\n');
        clients.add(res);
        const heartbeat = setInterval(() => res.write(': still improbably here\n\n'),20000);
        req.on('close',() => { clearInterval(heartbeat); clients.delete(res); });
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(res,404,{error:'Unknown flight-control route.'});
      if (!['GET','HEAD'].includes(req.method)) return send(res,405,{error:'Method not allowed.'});
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const filename = path.resolve(publicDir, '.' + relative);
      if (!filename.startsWith(path.resolve(publicDir) + path.sep)) return send(res,403,{error:'Outside the flight deck.'});
      try {
        const content = await readFile(filename);
        res.writeHead(200,{'Content-Type':TYPES[path.extname(filename)] ?? 'application/octet-stream'});
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch { send(res,404,{error:'Page not found.'}); }
    } catch (error) {
      send(res,error.status ?? 400,{error:error.message ?? 'Flight control encountered a problem.'});
    }
  });
  const onEvent = event => {
    const message = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 1024 * 1024) { client.destroy(); clients.delete(client); }
      else client.write(message);
    }
  };
  runtime.on('event',onEvent);
  return {
    server,runtime,
    async listen(port=4242) {
      await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      for (const client of clients) client.end();
      runtime.off('event',onEvent);
      await runtime.close();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4242);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const flight = await createFlightServer();
  console.log(`\nDON'T PANIC. Heart of Gold is ready.\n${await flight.listen(port)}\nLocal agents. Visible work. Bring a towel.\n`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,async () => { await flight.close(); process.exit(0); });
}
