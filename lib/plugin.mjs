import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildCrew, showFlight, buildCrewSchema, showFlightSchema, flightSnapshotSchema, memberSchema, safeContractError, MAX_PLUGIN_BODY_BYTES } from './crew-contract.mjs';
import { FlightStore, FlightError } from './flight-store.mjs';
import { projectInputSchema, ProjectError } from './project-contract.mjs';

export const FLIGHT_RESOURCE_URI = 'ui://heart-of-gold/flight-deck-v7.html';
const LEGACY_RESOURCE_URIS = ['ui://heart-of-gold/flight-deck-v1.html', 'ui://heart-of-gold/flight-deck-v2.html', 'ui://heart-of-gold/flight-deck-v3.html', 'ui://heart-of-gold/flight-deck-v4.html', 'ui://heart-of-gold/flight-deck-v5.html', 'ui://heart-of-gold/flight-deck-v6.html'];
export const FLIGHT_RESOURCE_MIME = 'text/html;profile=mcp-app';
const DEFAULT_RESOURCE = new URL('../plugins/heart-of-gold/ui/dist/flight-deck.html', import.meta.url);
const annotation = readOnly => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false });
const NO_AUTH = [{ type: 'noauth' }];
const flightId = z.string().regex(/^[a-f0-9]{32}$/, 'A valid flight ID is required.');
const capability = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'A valid flight capability is required.');
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const flightInfo = z.object({ id: flightId, revision, expiresAt: z.string().datetime(), writeToken: capability.optional() }).strict();
const writeFields = { flightId, writeToken: capability, expectedRevision: revision };
const updateSchema = showFlightSchema.safeExtend(writeFields);
const readSchema = z.object({ flightId, readToken: capability, afterRevision: revision.optional() }).strict();
const planSchema = z.object({
  mission: buildCrewSchema.shape.mission,
  deliverable: buildCrewSchema.shape.deliverable,
  constraints: buildCrewSchema.shape.constraints,
  members: z.array(memberSchema.pick({ id: true, parentId: true, name: true, role: true, task: true, output: true })).min(1).max(7),
}).strict();
const saveSchema = z.object({ ...writeFields, plan: planSchema }).strict();
const projectSchema = z.object({ ...writeFields, project: projectInputSchema }).strict();
const boardOutput = flightSnapshotSchema.extend({ flight: flightInfo });
const readOutput = flightSnapshotSchema.partial().extend({ flight: flightInfo, unchanged: z.boolean() });
const updateOutput = z.object({ flight: flightInfo, updated: z.literal(true), status: showFlightSchema.shape.status, execution: showFlightSchema.shape.execution }).strict();
const projectOutput = z.object({ flight: flightInfo, updated: z.literal(true), projectRevision: revision, sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), files: z.number().int().min(1).max(24) }).strict();
const DEFINITIONS = [
  { name: 'build_crew', title: 'Open a Heart of Gold flight deck', schema: buildCrewSchema, output: boardOutput, render: true, readOnly: false, visibility: ['model'],
    description: 'Create one temporary flight deck for a new mission. Call once per mission, then update this same board with show_flight. Returns an editable deterministic plan and private write capability. No agents start and no model calls occur. The latest snapshot stays in memory for up to two hours; no history is retained. Do not print or share flight capabilities.' },
  { name: 'show_flight', title: 'Update the existing flight deck', schema: updateSchema, output: updateOutput, readOnly: false, visibility: ['model'],
    description: 'Quietly update the existing flight deck using its flightId, writeToken and expectedRevision. Creates no new card. Supply the full snapshot of actual host-reported work; native children need real worker IDs and completed members need results. Keep capabilities private to the lead. On a revision conflict reconcile the current board rather than blindly overwriting or opening another deck.' },
  { name: 'update_project', title: 'Update project files in this flight', schema: projectSchema, output: projectOutput, readOnly: false, visibility: ['model'],
    description: 'Quietly replace the full current project file set on the existing flight. Submit exact text authored by the host or workers, real crew attribution, and actual check outcomes (not_run when untested). Publish working flight/member status first; native child worker IDs must match. Supply sourceRevision and HTTPS repository/preview links only when actually known. No secrets or credentials. Relative HTML/CSS/JS/Markdown/JSON/text files only, 24 files, 64 KiB each, 256 KiB project. Files/checks stay in temporary memory with the same fixed expiry. This tool does not execute code, write server files, install dependencies, fetch links, deploy, or create another card. Reconcile revision conflicts; never blindly overwrite user edits.' },
  { name: 'read_flight', title: 'Read flight deck updates', schema: readSchema, output: readOutput, readOnly: true, visibility: ['app'],
    description: 'Read one temporary board with its read capability. For the embedded app only. Returns unchanged when afterRevision matches. Polling does not extend the fixed expiry. This tool does not execute agents or call models.' },
  { name: 'save_plan', title: 'Save an edited crew plan', schema: saveSchema, output: boardOutput, readOnly: false, visibility: ['app'],
    description: 'Save a user-edited plan to the existing temporary board using its write capability and expected revision. For the embedded app only. Returns the normalized unstarted plan; rejects stale edits and edits while work is active. Does not execute the plan.' },
];

function toolMeta(definition) {
  return { ui: { ...(definition.render ? { resourceUri: FLIGHT_RESOURCE_URI } : {}), visibility: definition.visibility }, securitySchemes: NO_AUTH };
}

function makeServer(resourceHtml, store) {
  const server = new McpServer({ name: 'heart-of-gold', version: '0.5.0' }, {
    instructions: 'Open one flight deck with build_crew per mission. Reuse its flightId/writeToken and returned revision for quiet show_flight and update_project updates; never print capabilities or send them to workers. Publish actual project files and check outcomes with update_project, not invented activity. The board keeps only its latest snapshot and project in memory for two hours. The app reads it in place. Tools never execute agents, call models, run project code, fetch links or deploy. Use actual host capabilities and honest results.',
  });
  for (const definition of DEFINITIONS) {
    server.registerTool(definition.name, {
      title: definition.title, description: definition.description,
      inputSchema: definition.schema, outputSchema: definition.output,
      annotations: annotation(definition.readOnly), _meta: toolMeta(definition),
    }, async input => {
      try {
        if (definition.name === 'build_crew') {
          const created = store.create(buildCrew(input));
          return { structuredContent: { ...created.snapshot, flight: created.flight },
            _meta: { flight: { readToken: created.readToken } },
            content: [{ type: 'text', text: `Opened one temporary deck with ${created.snapshot.members.length} planned roles. No work has started. Reuse this flight for updates; keep its capabilities private.` }] };
        }
        if (definition.name === 'read_flight') {
          const read = store.read(input.flightId, input.readToken, input.afterRevision);
          return { structuredContent: { ...(read.snapshot || {}), flight: read.flight, unchanged: read.unchanged }, content: [] };
        }
        const { flightId: id, writeToken, expectedRevision, ...payload } = input;
        if (definition.name === 'update_project') {
          const updated = store.updateProject(id, writeToken, expectedRevision, payload.project);
          return { structuredContent: { flight: updated.flight, updated: true, projectRevision: updated.snapshot.project.revision, sourceDigest: updated.snapshot.project.sourceDigest, files: updated.snapshot.project.files.length },
            content: [{ type: 'text', text: 'Updated the actual project files in the existing flight deck. Supplied check outcomes remain host-reported; no server execution or deployment occurred.' }] };
        }
        if (definition.name === 'save_plan') {
          const snapshot = showFlight({ ...payload.plan, execution: 'not_started', status: 'planned', members: payload.plan.members.map(member => ({ ...member, status: 'planned', evidence: [] })) });
          const saved = store.update(id, writeToken, expectedRevision, snapshot, { editableOnly: true });
          return { structuredContent: { ...saved.snapshot, flight: saved.flight }, content: [{ type: 'text', text: 'Saved the edited plan. No work has started.' }] };
        }
        const updated = store.update(id, writeToken, expectedRevision, showFlight(payload));
        return { structuredContent: { flight: updated.flight, updated: true, status: updated.snapshot.status, execution: updated.snapshot.execution },
          content: [{ type: 'text', text: 'Updated the existing flight deck.' }] };
      } catch (error) {
        const metadata = error instanceof FlightError || error instanceof ProjectError
          ? { code: error.code, message: error.message, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) }
          : { code: 'INVALID_FLIGHT', message: safeContractError(error) };
        return { isError: true, ...(error instanceof FlightError && error.recovery ? { structuredContent: error.recovery } : {}),
          _meta: { flightError: metadata }, content: [{ type: 'text', text: metadata.message }] };
      }
    });
  }
  // The SDK preserves standard tool metadata but does not copy the optional
  // ChatGPT securitySchemes field from registerTool config. Publish it explicitly.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DEFINITIONS.map(definition => ({
    name: definition.name, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.schema, { io: 'input' }),
    outputSchema: z.toJSONSchema(definition.output), annotations: annotation(definition.readOnly),
    securitySchemes: NO_AUTH, _meta: toolMeta(definition),
  })) }));
  for (const [index, uri] of [FLIGHT_RESOURCE_URI, ...LEGACY_RESOURCE_URIS].entries()) server.registerResource(index === 0 ? 'heart-of-gold-flight-deck' : `heart-of-gold-legacy-flight-deck-${index}`, uri, {
    title: 'Heart of Gold flight deck', description: 'An editable crew plan and host-reported outcome viewer.', mimeType: FLIGHT_RESOURCE_MIME,
  }, async () => ({ contents: [{ uri, mimeType: FLIGHT_RESOURCE_MIME, text: resourceHtml,
    _meta: { ui: { domain: 'https://projectforty2.ai', prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], frameDomains: ['https://projectforty2.ai'] } },
      'openai/widgetCSP': { connect_domains: [], resource_domains: [], frame_domains: ['https://projectforty2.ai'] },
      'openai/widgetDescription': 'One persistent temporary flight deck with actual host-supplied project files. Work and check outcomes are host-reported, not independently verified. No server model or code execution; the board expires after two hours.' },
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
export async function createPluginHandler({ resourcePath = DEFAULT_RESOURCE, bodyTimeoutMs = 10_000, storeOptions = {} } = {}) {
  const resourceHtml = await readFile(resourcePath, 'utf8');
  if (!resourceHtml.trim() || Buffer.byteLength(resourceHtml) > 2 * 1024 * 1024) throw new Error('Plugin UI bundle is missing or too large.');
  // State belongs to this service instance, never to a request's MCP transport.
  const store = new FlightStore(storeOptions);
  const active = new Set(); let closed = false;
  return {
    async handle(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      if (closed) return jsonError(res, 503, -32603, 'Plugin service unavailable.');
      // The transport is sessionless; temporary board state uses explicit capabilities.
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return jsonError(res, 405, -32000, 'This endpoint accepts POST requests only.');
      }
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return jsonError(res, 415, -32600, 'Use application/json.');
      const length = Number(req.headers['content-length']);
      if (Number.isFinite(length) && length > MAX_PLUGIN_BODY_BYTES) { req.resume(); return jsonError(res, 413, -32600, 'Request body exceeds the plugin limit.'); }
      let server, transport, cleanup;
      try {
        const body = await readBody(req, bodyTimeoutMs);
        server = makeServer(resourceHtml, store);
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
    async close() { closed = true; store.close(); await Promise.all([...active].map(cleanup => cleanup())); },
  };
}
