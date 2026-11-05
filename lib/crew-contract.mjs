import { z } from 'zod';
import { projectSnapshotSchema } from './project-contract.mjs';

export const MAX_CREW = 7;
export const MAX_DEPTH = 2;
export const MAX_PLUGIN_BODY_BYTES = 384 * 1024;
export const PRESETS = ['balanced', 'debate', 'build', 'research'];
export const MEMBER_STATUSES = ['planned', 'working', 'waiting', 'complete', 'cancelled', 'failed'];

const text = (max, min = 1) => z.string().trim().min(min).max(max);
const optionalText = max => text(max).optional();
const identifier = text(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, 'Use a short identifier without spaces.');
const httpsUrl = text(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}, 'Evidence links must be HTTPS URLs without credentials.');

export const buildCrewSchema = z.object({
  mission: text(6000),
  preset: z.enum(PRESETS).default('balanced'),
  crewSize: z.number().int().min(3).max(MAX_CREW).default(4),
  deliverable: optionalText(1000),
  constraints: z.array(text(500)).max(8).default([]),
}).strict();

export const memberSchema = z.object({
  id: identifier,
  parentId: identifier.nullable(),
  name: text(80),
  role: text(120),
  task: text(2000),
  output: text(1000),
  status: z.enum(MEMBER_STATUSES),
  result: optionalText(6000),
  workerId: optionalText(160),
  evidence: z.array(z.object({ label: text(160), url: httpsUrl }).strict()).max(6).default([]),
}).strict();

export const showFlightShape = {
  mission: text(6000),
  execution: z.enum(['not_started', 'guided_passes', 'native_agents']),
  status: z.enum(['planned', 'working', 'complete', 'partial']),
  members: z.array(memberSchema).min(1).max(MAX_CREW),
  deliverable: optionalText(1000),
  constraints: z.array(text(500)).max(8).default([]),
  summary: optionalText(6000),
  openQuestions: z.array(text(500)).max(8).default([]),
};

function validateFlight(value, ctx) {
  const fail = (message, path = ['members']) => ctx.addIssue({ code: 'custom', message, path });
  const byId = new Map();
  value.members.forEach((member, index) => {
    if (byId.has(member.id)) fail('Crew member IDs must be unique.', ['members', index, 'id']);
    byId.set(member.id, member);
  });
  const roots = value.members.filter(member => member.parentId === null);
  if (roots.length !== 1) fail('The crew must have exactly one lead with parentId null.');
  value.members.forEach((member, index) => {
    let current = member, depth = 0;
    const seen = new Set([member.id]);
    while (current.parentId !== null) {
      const parent = byId.get(current.parentId);
      if (!parent) { fail('Every parent must exist in this crew.', ['members', index, 'parentId']); break; }
      if (seen.has(parent.id)) { fail('Crew delegation cannot contain cycles.', ['members', index, 'parentId']); break; }
      seen.add(parent.id); current = parent; depth++;
      if (depth > MAX_DEPTH) { fail('Crew delegation is limited to two levels below the lead.', ['members', index, 'parentId']); break; }
    }
    if (member.status === 'complete' && !member.result) fail('A completed member needs a concrete result.', ['members', index, 'result']);
    if (value.execution === 'native_agents' && member.parentId !== null && member.status !== 'planned' && !member.workerId) {
      fail('Native delegated activity requires the actual host-reported worker ID.', ['members', index, 'workerId']);
    }
    if (value.execution !== 'native_agents' && member.workerId) fail('Worker IDs are only valid for native agent execution.', ['members', index, 'workerId']);
    if (value.execution === 'not_started' && (member.status !== 'planned' || member.result)) fail('An unstarted plan cannot contain performed work.', ['members', index, 'status']);
  });
  if (value.execution === 'not_started' && value.status !== 'planned') fail('Unstarted flights must be planned.', ['status']);
  if (value.status === 'planned' && value.members.some(member => member.status !== 'planned')) fail('Planned flights cannot contain active or completed work.', ['status']);
  if (value.status === 'planned' && value.members.some(member => member.result || member.workerId)) fail('A planned flight cannot contain results or worker IDs. Report performed work with its actual execution status.', ['status']);
  if (value.status === 'complete' && (value.execution === 'not_started' || value.members.some(member => member.status !== 'complete') || !value.summary)) {
    fail('A complete flight needs all member results and a final summary.', ['status']);
  }
  if (value.status === 'partial' && value.members.some(member => ['working', 'waiting'].includes(member.status))) fail('A partial receipt must not claim agents are still working; use working instead.', ['status']);
}

export const showFlightSchema = z.object(showFlightShape).strict().superRefine(validateFlight);

export const CAPABILITIES = Object.freeze({ executesAgents: false, callsModels: false, persistsHistory: false });
export const PROVENANCE = Object.freeze({ source: 'host-reported', verified: false, label: 'Reported by the chat host. Not independently verified.' });

export const flightSnapshotSchema = z.object({
  ...showFlightShape,
  schemaVersion: z.literal(1),
  view: z.enum(['builder', 'report']),
  deliverable: text(1000),
  summary: text(6000, 0),
  capabilities: z.object({ executesAgents: z.literal(false), callsModels: z.literal(false), persistsHistory: z.literal(false) }).strict(),
  provenance: z.object({ source: z.literal('host-reported'), verified: z.literal(false), label: text(200) }).strict(),
  project: projectSnapshotSchema.optional(),
}).strict();

export function showFlight(input) {
  const parsed = showFlightSchema.parse(input);
  // Hosts sometimes preselect a future execution mode while describing a plan.
  // A valid planned snapshot has no work or worker evidence; normalize that
  // intent without claiming execution or turning its editable blueprint into a receipt.
  if (parsed.status === 'planned') return snapshot({ ...parsed, execution: 'not_started' }, 'builder');
  return snapshot(parsed, 'report');
}

function snapshot(value, view) {
  return {
    schemaVersion: 1, view, ...value,
    deliverable: value.deliverable || 'A useful final deliverable with supporting evidence and unresolved questions.',
    summary: value.summary || '', openQuestions: value.openQuestions || [],
    capabilities: { ...CAPABILITIES }, provenance: { ...PROVENANCE },
  };
}

const recipes = {
  balanced: [
    ['Ford', 'Explorer', 'Establish the relevant facts and missing context.', 'A concise evidence brief with source references.'],
    ['Trillian', 'Builder', 'Develop a practical solution using the available evidence.', 'A concrete proposed deliverable.'],
    ['Marvin', 'Skeptic', 'Challenge the assumptions, risks, and failure modes.', 'Specific objections and suggested fixes.'],
    ['Arthur', 'User advocate', 'Check whether the proposed result meets the user’s actual needs.', 'Usability and acceptance findings.'],
    ['Zaphod', 'Alternative thinker', 'Propose one materially different way to meet the goal.', 'An alternative with explicit tradeoffs.'],
    ['Eddie', 'Verifier', 'Check the final claims against available evidence and constraints.', 'A verification checklist with honest gaps.'],
  ],
  debate: [
    ['Ford', 'Advocate', 'Make the strongest evidence-based case for the proposed approach.', 'Arguments, evidence, and assumptions.'],
    ['Marvin', 'Challenger', 'Make the strongest evidence-based critique of the proposed approach.', 'Counterarguments, risks, and tests.'],
    ['Trillian', 'Fact checker', 'Check the evidence cited by both sides and identify uncertainty.', 'Verified points and contested claims.'],
    ['Arthur', 'User advocate', 'Evaluate the competing approaches against the user’s practical needs.', 'A needs-based assessment.'],
    ['Zaphod', 'Alternative thinker', 'Find a third option that resolves the strongest disagreement.', 'An alternative with explicit tradeoffs.'],
    ['Eddie', 'Decision reviewer', 'Check the eventual recommendation for unsupported leaps.', 'Decision criteria and remaining questions.'],
  ],
  build: [
    ['Trillian', 'Architect', 'Define the smallest useful design and clear boundaries.', 'An implementation plan and acceptance criteria.'],
    ['Ford', 'Builder', 'Implement or draft the requested deliverable using available authorized tools.', 'The concrete deliverable and relevant artifact references.'],
    ['Marvin', 'Reviewer', 'Inspect the deliverable for correctness, safety, and maintenance risks.', 'Actionable findings ranked by impact.'],
    ['Arthur', 'User advocate', 'Check the result from the intended user’s perspective.', 'Usability and accessibility findings.'],
    ['Zaphod', 'Simplifier', 'Look for unnecessary complexity and propose a smaller reliable design.', 'Simplification recommendations.'],
    ['Eddie', 'Verifier', 'Run appropriate available checks and report their actual outcomes.', 'Observed verification results and untested areas.'],
  ],
  research: [
    ['Ford', 'Source scout', 'Find relevant primary sources using available search tools.', 'A source list with relevance and limitations.'],
    ['Trillian', 'Analyst', 'Compare the available evidence and develop a reasoned answer.', 'A synthesis that distinguishes evidence from inference.'],
    ['Marvin', 'Challenger', 'Search for contradictory evidence and weak assumptions.', 'Counterevidence and unresolved questions.'],
    ['Arthur', 'Context reviewer', 'Check the scope, definitions, and relevance to the user’s question.', 'Scope and interpretation notes.'],
    ['Zaphod', 'Alternative researcher', 'Investigate an alternative explanation or approach.', 'A competing explanation with evidence.'],
    ['Eddie', 'Citation checker', 'Check that the final references support the associated claims.', 'Citation checks and remaining evidence gaps.'],
  ],
};

export function buildCrew(input) {
  const { mission, preset, crewSize, deliverable, constraints } = buildCrewSchema.parse(input);
  const members = [{ id: 'lead', parentId: null, name: 'Deep Thought', role: 'Lead and synthesizer',
    task: 'Coordinate the mission, assign bounded independent work, reconcile findings, and produce the final deliverable.',
    output: deliverable || 'A coherent final answer with evidence, limitations, and next steps.', status: 'planned', evidence: [] }];
  for (const [index, [name, role, task, output]] of recipes[preset].slice(0, crewSize - 1).entries()) {
    members.push({ id: `crew-${index + 1}`, parentId: 'lead', name, role, task, output, status: 'planned', evidence: [] });
  }
  return snapshot({ mission, execution: 'not_started', status: 'planned', members, deliverable, constraints }, 'builder');
}

// Error messages describe constraints, never echo supplied tasks, results, or identifiers.
export function safeContractError(error) {
  if (error instanceof z.ZodError) return 'The crew snapshot does not meet the contract. ' + error.issues.slice(0, 4).map(issue => issue.code === 'custom' ? issue.message : 'Check the documented field types, required values, and size limits.').join(' ');
  return 'The crew snapshot could not be processed.';
}
