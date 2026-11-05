import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildCrew, showFlight, buildCrewSchema, showFlightSchema, flightSnapshotSchema, safeContractError, MAX_PLUGIN_BODY_BYTES } from './crew-contract.mjs';

export const FLIGHT_RESOURCE_URI = 'ui://heart-of-gold/flight-deck-v1.html';
export const FLIGHT_RESOURCE_MIME = 'text/html;profile=mcp-app';
const DEFAULT_RESOURCE = new URL('../plugins/heart-of-gold/ui/dist/flight-deck.html', import.meta.url);
const ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const NO_AUTH = [{ type: 'noauth' }];
const DEFINITIONS = [
  { name: 'build_crew', title: 'Build a Heart of Gold crew', schema: buildCrewSchema, handler: buildCrew,
    description: 'Create an editable, bounded crew plan for a mission. Produces a deterministic recipe, not model work or running agents. Use the plan in this chat with available host capabilities; this tool does not execute work, call models, or save data.' },
  { name: 'show_flight', title: 'Show a Heart of Gold flight', schema: showFlightSchema, handler: showFlight,
    description: 'Render a supplied crew plan or actual host-reported task results. Report only work observed in this chat; native delegated activity needs actual worker IDs, and completed tasks need concrete results. Guided passes are one assistant working through roles. This is a snapshot, not independent telemetry. No model calls or storage.' },
];

function toolMeta() {
  return { ui: { resourceUri: FLIGHT_RESOURCE_URI, visibility: ['model', 'app'] }, securitySchemes: NO_AUTH };
}

function makeServer(resourceHtml) {
  const server = new McpServer({ name: 'heart-of-gold', version: '0.1.0' }, {
    instructions: 'Build bounded crew plans and display honest host-reported snapshots. These tools never execute agents or call models. Use only host capabilities actually available; otherwise describe one assistant making guided role passes. Never invent worker IDs or results. No private history is retained by this server.',
  });
  for (const definition of DEFINITIONS) {
    server.registerTool(definition.name, {
      title: definition.title, description: definition.description,
      inputSchema: definition.schema, outputSchema: flightSnapshotSchema,
      annotations: ANNOTATIONS, _meta: toolMeta(),
    }, async input => {
      try {
        const snapshot = definition.handler(input);
        return { structuredContent: snapshot, content: [{ type: 'text', text: snapshot.view === 'builder'
          ? `Prepared ${snapshot.members.length} roles. No agents have started. Use the crew plan in this chat; host capabilities and account limits apply.`
          : `${snapshot.members.length} crew roles; ${snapshot.status}; ${snapshot.execution}. ${snapshot.provenance.label}` }] };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: safeContractError(error) }] }; }
    });
  }
  // The SDK preserves standard tool metadata but does not copy the optional
  // ChatGPT securitySchemes field from registerTool config. Publish it explicitly.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DEFINITIONS.map(definition => ({
    name: definition.name, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    outputSchema: z.toJSONSchema(flightSnapshotSchema), annotations: ANNOTATIONS,
    securitySchemes: NO_AUTH, _meta: toolMeta(),
  })) }));
  server.registerResource('heart-of-gold-flight-deck', FLIGHT_RESOURCE_URI, {
    title: 'Heart of Gold flight deck', description: 'An editable crew plan and host-reported outcome viewer.', mimeType: FLIGHT_RESOURCE_MIME,
  }, async () => ({ contents: [{ uri: FLIGHT_RESOURCE_URI, mimeType: FLIGHT_RESOURCE_MIME, text: resourceHtml,
    _meta: { ui: { domain: 'https://projectforty2.ai', prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
      'openai/widgetDescription': 'A bounded crew plan or host-reported flight receipt. No model execution or saved private history.' },
  }] }));
  // Deliberately no logging capability and no payload/error logging.
  server.server.onerror = () => {};
  return server;
}

function jsonError(res, status, code, message) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

function readBody(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    let bytes = 0; const chunks = [];
    const finish = (error, value) => {
      clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onAbort);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const onAbort = () => finish({ status: 400, code: -32600, message: 'Request interrupted.' });
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > MAX_PLUGIN_BODY_BYTES) finish({ status: 413, code: -32600, message: 'Request body exceeds the plugin limit.' });
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        finish(null, body);
      } catch { finish({ status: 400, code: -32700, message: 'Invalid JSON-RPC request.' }); }
    };
    const timer = setTimeout(() => finish({ status: 408, code: -32600, message: 'Request body timed out.' }), timeoutMs);
    timer.unref?.();
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort); req.once('error', onAbort);
  });
}

/** Mount only on the configured MCP route; the caller owns Host/Origin/rate checks. */
export async function createPluginHandler({ resourcePath = DEFAULT_RESOURCE, bodyTimeoutMs = 10_000 } = {}) {
  const resourceHtml = await readFile(resourcePath, 'utf8');
  if (!resourceHtml.trim() || Buffer.byteLength(resourceHtml) > 2 * 1024 * 1024) throw new Error('Plugin UI bundle is missing or too large.');
  const active = new Set(); let closed = false;
  return {
    async handle(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      if (closed) return jsonError(res, 503, -32603, 'Plugin service unavailable.');
      // A stateless renderer has neither a persistent event stream nor sessions to delete.
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return jsonError(res, 405, -32000, 'This stateless endpoint accepts POST requests only.');
      }
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return jsonError(res, 415, -32600, 'Use application/json.');
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > MAX_PLUGIN_BODY_BYTES) { req.resume(); return jsonError(res, 413, -32600, 'Request body exceeds the plugin limit.'); }
      let server, transport, cleanup;
      try {
        const body = await readBody(req, bodyTimeoutMs);
        server = makeServer(resourceHtml);
        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        cleanup = async () => {
          if (!active.delete(cleanup)) return;
          res.off('close', cleanup);
          await server.close().catch(() => {});
        };
        active.add(cleanup); res.once('close', cleanup);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        jsonError(res, error?.status || 500, error?.code || -32603, error?.status ? error.message : 'The plugin request could not be processed.');
      } finally { if (cleanup) await cleanup(); }
    },
    async close() { closed = true; await Promise.all([...active].map(cleanup => cleanup())); },
  };
}
