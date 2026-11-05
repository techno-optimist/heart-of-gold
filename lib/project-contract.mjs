import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_PROJECT_FILES = 24;
export const MAX_PROJECT_FILE_BYTES = 64 * 1024;
export const MAX_PROJECT_BYTES = 256 * 1024;
const text = max => z.string().trim().min(1).max(max);
const memberId = text(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, 'Use a valid crew member identifier.');
const languages = { html: 'html', htm: 'html', css: 'css', js: 'javascript', mjs: 'javascript', md: 'markdown', markdown: 'markdown', json: 'json', txt: 'text' };
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(value, 'utf8');
const extension = path => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const pathSchema = text(160).refine(path => {
  const parts = path.split('/');
  return parts.length <= 8 && parts.every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)) && Object.hasOwn(languages, extension(path));
}, 'Use a relative text-file path with regular non-hidden segments and a supported extension.');
const httpsUrl = text(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}, 'Project links must be HTTPS URLs without credentials.');
const attribution = { memberId, workerId: text(160).optional() };

export const projectFileSchema = z.object({
  path: pathSchema,
  // Content is never trimmed, rewritten, executed, or interpreted on the server.
  content: z.string().max(MAX_PROJECT_FILE_BYTES).refine(content => bytes(content) <= MAX_PROJECT_FILE_BYTES && !content.includes('\0'), 'Each text file must be at most 64 KiB and contain no null bytes.'),
  ...attribution,
  summary: text(500).optional(),
}).strict();
export const projectCheckSchema = z.object({
  name: text(120), status: z.enum(['passed', 'failed', 'not_run']), details: text(2000),
  ...attribution, command: text(500).optional(),
}).strict();
export const projectInputSchema = z.object({
  title: text(160), entrypoint: pathSchema.optional(), sourceRevision: text(160).optional(),
  links: z.object({ repository: httpsUrl.optional(), preview: httpsUrl.optional() }).strict().default({}),
  files: z.array(projectFileSchema).min(1).max(MAX_PROJECT_FILES),
  checks: z.array(projectCheckSchema).max(24),
}).strict();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const projectSnapshotSchema = projectInputSchema.extend({
  schemaVersion: z.literal(1),
  files: z.array(projectFileSchema.extend({ language: z.enum(['html', 'css', 'javascript', 'markdown', 'json', 'text']), bytes: z.number().int().min(0).max(MAX_PROJECT_FILE_BYTES), sha256: digestSchema })).min(1).max(MAX_PROJECT_FILES),
  checks: z.array(projectCheckSchema.extend({ projectRevision: z.number().int().positive(), sourceDigest: digestSchema })).max(24),
  changes: z.array(z.object({ path: pathSchema, operation: z.enum(['added', 'modified', 'deleted']), memberId: memberId.optional(), workerId: text(160).optional(), summary: text(500).optional() }).strict()).max(MAX_PROJECT_FILES * 2),
  revision: z.number().int().positive(), basedOnFlightRevision: z.number().int().positive(), updatedAt: z.string().datetime(), sourceDigest: digestSchema,
  provenance: z.object({ source: z.literal('host-supplied'), verified: z.literal(false), label: text(240) }).strict(),
}).strict();

export class ProjectError extends Error {
  constructor(code, message) { super(message); this.name = 'ProjectError'; this.code = code; }
}
const invalid = message => new ProjectError('INVALID_PROJECT', message);
function checkAttribution(item, snapshot) {
  const member = snapshot.members.find(candidate => candidate.id === item.memberId);
  if (!member || member.status === 'planned') throw invalid('Project attribution must reference a crew member with reported work. Publish the working flight before its artifacts.');
  if (snapshot.execution === 'native_agents') {
    if (member.parentId !== null && (!member.workerId || item.workerId !== member.workerId)) throw invalid('Native child attribution must match its actual reported worker ID.');
    if (item.workerId && item.workerId !== member.workerId) throw invalid('Worker attribution must match the selected crew member.');
  } else if (item.workerId) throw invalid('Guided role passes cannot claim independent worker IDs.');
}

// Defense in depth, not an exhaustive secret detector. Hosts must never submit
// credentials or confidential files; errors deliberately never echo content.
const obviousCredential = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/;

export function createProject(input, snapshot, { flightRevision, now = Date.now() } = {}) {
  let parsed;
  try { parsed = projectInputSchema.parse(input); }
  catch { throw invalid('The project does not meet the documented field, path, type, or size limits.'); }
  if (!Array.isArray(snapshot?.members) || snapshot.execution === 'not_started') throw invalid('Publish actual working flight status before submitting project files.');
  const seen = new Set();
  const priorFiles = new Map((snapshot.project?.files || []).map(file => [file.path, file]));
  for (const file of parsed.files) {
    const canonical = file.path.toLowerCase();
    if (seen.has(canonical)) throw invalid('Project file paths must be unique, including case-insensitive comparisons.');
    seen.add(canonical);
    const prior = priorFiles.get(file.path);
    const retained = prior && prior.content === file.content && prior.memberId === file.memberId && prior.workerId === file.workerId;
    // Exact retained files keep their original authorship after crew edits.
    // Changed/new content always requires a current, started crew member.
    if (!retained) checkAttribution(file, snapshot);
  }
  for (const check of parsed.checks) checkAttribution(check, snapshot);
  if (parsed.entrypoint && !parsed.files.some(file => file.path === parsed.entrypoint && languages[extension(file.path)] === 'html')) throw invalid('The entrypoint must name an included HTML file.');
  if (obviousCredential.test(JSON.stringify(parsed))) throw invalid('Remove credentials and private keys before submitting project content.');
  const revision = (snapshot.project?.revision || 0) + 1;
  const files = parsed.files.map(file => ({ ...file, language: languages[extension(file.path)], bytes: bytes(file.content), sha256: hash(file.content) }));
  const sourceDigest = hash(JSON.stringify(files.map(file => [file.path, file.sha256]).sort(([a], [b]) => a.localeCompare(b, 'en'))));
  const previous = new Map((snapshot.project?.files || []).map(file => [file.path, file]));
  const changes = [];
  for (const file of files) {
    const before = previous.get(file.path);
    if (!before || before.sha256 !== file.sha256) changes.push({ path: file.path, operation: before ? 'modified' : 'added', memberId: file.memberId, ...(file.workerId ? { workerId: file.workerId } : {}), ...(file.summary ? { summary: file.summary } : {}) });
    previous.delete(file.path);
  }
  // A deletion is visible, but no author is invented for an absent file.
  for (const path of previous.keys()) changes.push({ path, operation: 'deleted' });
  const project = { ...parsed, schemaVersion: 1, files, checks: parsed.checks.map(check => ({ ...check, projectRevision: revision, sourceDigest })),
    changes, revision, basedOnFlightRevision: flightRevision, updatedAt: new Date(now).toISOString(), sourceDigest,
    provenance: { source: 'host-supplied', verified: false, label: 'Files and check outcomes supplied by the chat host. Content hashes are computed here; execution and check outcomes are not independently verified.' } };
  if (bytes(JSON.stringify(project)) > MAX_PROJECT_BYTES) throw new ProjectError('PROJECT_TOO_LARGE', 'The complete project exceeds 256 KiB. Submit a smaller self-contained project.');
  return projectSnapshotSchema.parse(project);
}
