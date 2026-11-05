import { App } from '@modelcontextprotocol/ext-apps';

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const svgEl = (tag, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); return node; };
const copy = (value) => JSON.parse(JSON.stringify(value));
const states = new Set(['planned', 'working', 'waiting', 'complete', 'cancelled', 'failed']);
const executions = new Set(['not_started', 'guided_passes', 'native_agents']);
const clip = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const label = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const isPreview = window.parent === window;
const app = isPreview ? null : new App({ name: 'Heart of Gold flight deck', version: '0.2.1' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });
const state = { snapshot: null, selectedId: null, dirty: false, editing: false, missionEditing: false, pending: null, receivedAt: null, connected: false, canMessage: false, busy: false, sentRevision: null, revision: 0, hostContext: {}, lastMessage: '', flight: null, remoteSignature: '', sync: 'waiting', expired: false, polling: false, pollFailures: 0, unchangedReads: 0, awaitingUpdate: false, messageUnconfirmed: false, messageRevision: null, milestone: '', evidenceKey: '', questionsKey: '', tornDown: false, cached: false, authoritativeSnapshot: null, authoritativeReceivedAt: null };
const cursorNodes = new Map();
let displayedMission = '';
let pollTimer;

function writeText(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
function terminal(snapshot = state.snapshot) { return ['complete', 'partial'].includes(snapshot?.status); }
function persistView() {
  const host = window.openai;
  if (!host?.setWidgetState || !state.flight || !state.authoritativeSnapshot || state.cached) return;
  try {
    const prior = host.widgetState && typeof host.widgetState === 'object' ? host.widgetState : {};
    const privateContent = prior.privateContent && typeof prior.privateContent === 'object' ? prior.privateContent : {};
    // Preserve modelContent, imageIds, and unrelated state. Capabilities never
    // enter this optional display cache or any browser storage.
    host.setWidgetState({ ...prior, privateContent: { ...privateContent, heartOfGold: { version: 1, flightId: state.flight.id, revision: state.flight.revision, snapshot: state.authoritativeSnapshot, receivedAt: state.authoritativeReceivedAt, selectedId: state.selectedId, resultOpen: $('deliverable-section').open, missionOpen: $('full-mission').open } } });
  } catch { /* Optional host persistence must not interrupt the flight. */ }
}
function receiveSnapshot(input, force = false, initial = false) {
  const snapshot = normalizeSnapshot(input);
  if (state.messageUnconfirmed && state.flight?.revision > state.messageRevision) {
    state.messageUnconfirmed = false; state.awaitingUpdate = false; notify('');
  }
  state.authoritativeSnapshot = snapshot; state.authoritativeReceivedAt = new Date().toISOString();
  if (initial && !state.snapshot && state.flight) {
    try {
      const cached = window.openai?.widgetState?.privateContent?.heartOfGold;
      if (cached?.version === 1 && cached.flightId === state.flight.id && Number.isInteger(cached.revision) && cached.revision >= state.flight.revision) {
        state.selectedId = typeof cached.selectedId === 'string' ? cached.selectedId : null;
        $('deliverable-section').open = cached.resultOpen === true;
        if (cached.revision > state.flight.revision) {
          state.cached = true; acceptSnapshot(normalizeSnapshot(cached.snapshot), true);
          const received = new Date(cached.receivedAt); if (Number.isFinite(received.getTime())) state.receivedAt = received;
          $('full-mission').open = cached.missionOpen === true; render(); return;
        }
      }
    } catch { /* Ignore an invalid or incompatible display cache. */ }
  }
  state.cached = false; acceptSnapshot(snapshot, force); render(); persistView();
}
function resultError(result) {
  const detail = result?._meta?.flightError;
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  const error = new Error(clip(detail?.message || text || 'The flight service could not complete that request.', 300));
  error.code = detail?.code || 'FLIGHT_REQUEST_FAILED'; return error;
}
function rememberFlight(result) {
  const flight = result?.structuredContent?.flight;
  if (!flight) return;
  if (state.flight?.id && state.flight.id !== flight.id) throw new Error('This update belongs to a different flight.');
  if (typeof flight.id !== 'string' || !Number.isInteger(flight.revision) || !Number.isFinite(Date.parse(flight.expiresAt))) throw new Error('The service returned incomplete flight metadata.');
  if (state.flight && flight.revision < state.flight.revision) return false;
  const readToken = result?._meta?.flight?.readToken;
  state.flight = { ...state.flight, id: flight.id, revision: flight.revision, expiresAt: flight.expiresAt, ...(typeof flight.writeToken === 'string' ? { writeToken: flight.writeToken } : {}), ...(typeof readToken === 'string' ? { readToken } : {}) };
  return true;
}
function describeMilestone(previous, next) {
  if (next.status === 'complete') return 'Crew complete. The result is ready below.';
  if (next.status === 'partial') return 'Partial result reported. Open the result for the remaining gaps.';
  const changed = next.members.filter((member) => previous?.members.find((old) => old.id === member.id)?.status !== member.status);
  const complete = changed.filter((member) => member.status === 'complete');
  if (complete.length) return complete.length === 1 ? `${complete[0].name} returned a contribution.` : `${complete.length} contributions returned.`;
  const active = changed.filter((member) => member.status === 'working');
  if (active.length) return active.length === 1 ? `${active[0].name} is working · host reported.` : `${active.length} roles working · host reported.`;
  const failed = changed.find((member) => ['failed', 'cancelled'].includes(member.status));
  if (failed) return `${failed.name} · ${failed.status}.`;
  return next.execution === 'not_started' ? 'Crew assembled. Ready for departure.' : state.milestone || 'Waiting for the next reported milestone.';
}
function refreshSyncLabel() {
  if (!state.snapshot) return;
  const time = state.receivedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '—';
  let text = state.dirty ? 'Draft edited' : `Last report ${time}`;
  if (isPreview) text = 'Browser preview';
  else if (state.expired) text = 'Flight unavailable · last report retained';
  else if (state.cached) text = 'Saved report · checking latest state';
  else if (state.sync === 'reconnecting') text = 'Refresh interrupted · retrying';
  else if (document.hidden) text = 'Updates paused while hidden';
  else if (state.flight && !terminal()) text = state.dirty ? 'Draft edited · board watching' : `Watching · ${time}`;
  writeText('snapshot-label', text);
  $('deck').dataset.sync = document.hidden ? 'paused' : state.sync;
  $('deck').dataset.fresh = String(!document.hidden && !state.expired && Date.now() - (state.receivedAt?.getTime() || 0) < 30000);
  $('refresh-flight').hidden = !state.flight;
  $('refresh-flight').disabled = state.expired || !state.connected || state.polling || state.busy;
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = undefined; }
function schedulePoll(delay) {
  stopPolling();
  if (isPreview || state.tornDown || !state.connected || !state.flight?.readToken || !app.getHostCapabilities()?.serverTools || state.expired || document.hidden) return;
  const wait = delay ?? (state.pollFailures ? Math.min(30000, 3000 * 2 ** state.pollFailures) : terminal() && !state.awaitingUpdate ? 15000 : Math.min(15000, 3000 * (1 + Math.floor(state.unchangedReads / 4))));
  pollTimer = setTimeout(() => { pollFlight(); }, wait);
}
async function pollFlight(manual = false) {
  if (!state.flight?.readToken || state.expired || !state.connected || state.polling || state.tornDown || document.hidden) return;
  if (Date.now() >= Date.parse(state.flight.expiresAt)) { state.expired = true; state.sync = 'unavailable'; stopPolling(); render(); return; }
  if (state.busy) { schedulePoll(3000); return; }
  state.polling = true; refreshSyncLabel();
  try {
    const revision = state.flight.revision;
    const result = await app.callServerTool({ name: 'read_flight', arguments: { flightId: state.flight.id, readToken: state.flight.readToken, afterRevision: revision } }, { timeout: 10000 });
    if (state.tornDown) return;
    if (result?.isError) throw resultError(result);
    if (rememberFlight(result) === false) return;
    state.pollFailures = 0; state.sync = 'watching';
    if (result.structuredContent?.unchanged) { state.unchangedReads += 1; if (state.cached && state.authoritativeSnapshot) receiveSnapshot(state.authoritativeSnapshot, true); }
    else { state.unchangedReads = 0; if (state.flight.revision > revision) state.awaitingUpdate = false; receiveSnapshot(result.structuredContent); }
  } catch (error) {
    if (error.code === 'FLIGHT_UNAVAILABLE') { state.expired = true; state.sync = 'unavailable'; notify('This temporary flight has expired or is unavailable. The last report remains here; no completion has been inferred.', 'error'); }
    else { state.pollFailures += 1; state.sync = 'reconnecting'; if (manual) notify('The flight could not refresh. Your draft and last report are still here.', 'error'); }
  } finally { state.polling = false; if (state.expired) render(); else refreshSyncLabel(); schedulePoll(); }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) stopPolling(); else schedulePoll(0); refreshSyncLabel(); });
$('refresh-flight').addEventListener('click', () => { stopPolling(); pollFlight(true); });

function renderMission(mission) {
  const characters = Array.from(mission);
  const isLong = characters.length > 120;
  const disclosure = $('full-mission');
  if (mission !== displayedMission) disclosure.open = false;
  displayedMission = mission;
  const sentence = mission.match(/^.*?[.!?](?=\s|$)/u)?.[0] || mission;
  const short = Array.from(sentence).slice(0, 117).join('').trimEnd();
  $('mission-title').textContent = isLong ? `${short}…` : mission;
  $('full-mission-text').textContent = mission;
  disclosure.hidden = !isLong;
}

export function validateCrew(members) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 7) throw new Error('Keep the crew between 1 and 7 roles.');
  const ids = new Set();
  for (const member of members) {
    if (typeof member.id !== 'string' || !member.id || ids.has(member.id)) throw new Error('Each role needs a unique ID.');
    ids.add(member.id);
    for (const key of ['name', 'role', 'task', 'output']) if (typeof member[key] !== 'string' || !member[key].trim()) throw new Error('Every role needs a name, assignment, and output contract.');
  }
  if (members.filter((member) => member.parentId == null).length !== 1) throw new Error('The crew needs exactly one lead role.');
  const byId = new Map(members.map((member) => [member.id, member]));
  for (const member of members) {
    let cursor = member;
    const visited = new Set();
    let depth = 0;
    while (cursor.parentId != null) {
      if (visited.has(cursor.id)) throw new Error('A role cannot report to its own branch.');
      visited.add(cursor.id);
      cursor = byId.get(cursor.parentId);
      if (!cursor) throw new Error('Every branch must have an existing parent.');
      depth += 1;
      if (depth > 2) throw new Error('Keep the crew within two branch levels.');
    }
  }
  return true;
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.members)) throw new Error('The host did not return a crew snapshot.');
  const members = input.members.map((member) => ({
    id: clip(member.id, 80), parentId: member.parentId == null ? null : clip(member.parentId, 80),
    name: clip(member.name, 80), role: clip(member.role, 120), task: clip(member.task, 2000), output: clip(member.output, 1000),
    status: states.has(member.status) ? member.status : 'planned', result: clip(member.result, 6000), workerId: clip(member.workerId, 160),
    evidence: (Array.isArray(member.evidence) ? member.evidence : []).slice(0, 6).flatMap((item) => {
      try { const url = new URL(item.url); return url.protocol === 'https:' && !url.username && !url.password ? [{ label: clip(item.label, 160) || url.hostname, url: url.href }] : []; } catch { return []; }
    }),
  }));
  validateCrew(members);
  const execution = executions.has(input.execution) ? input.execution : 'not_started';
  const view = input.view === 'report' ? 'report' : 'builder';
  if (execution === 'native_agents' && members.some((member) => member.parentId != null && member.status !== 'planned' && !member.workerId)) throw new Error('Active native-worker branches need reported worker identifiers.');
  return { schemaVersion: 1, view, mission: clip(input.mission, 6000) || 'An improbable mission', execution,
    status: clip(input.status, 30) || 'planned', members: view === 'builder' ? members.map((m) => ({ ...m, status: 'planned' })) : members,
    deliverable: clip(input.deliverable, 1000), constraints: (Array.isArray(input.constraints) ? input.constraints : []).slice(0, 8).map((v) => clip(v, 500)).filter(Boolean),
    summary: clip(input.summary, 6000), openQuestions: (Array.isArray(input.openQuestions) ? input.openQuestions : []).slice(0, 8).map((v) => clip(v, 500)).filter(Boolean),
    provenance: { source: 'host-reported', verified: false, label: 'Reported by the chat host. Not independently verified.' },
  };
}

function previewSnapshot() {
  return { schemaVersion: 1, view: 'builder', mission: 'Plan a welcoming first contribution experience for an open-source project.', execution: 'not_started', status: 'planned',
    members: [
      { id: 'lead', parentId: null, name: 'Arthur', role: 'Mission lead', task: 'Shape a practical first-contribution journey. Combine the crew’s findings into one coherent plan.', output: 'A clear onboarding plan with a first issue, review process, and next steps.', status: 'planned' },
      { id: 'maker', parentId: 'lead', name: 'Trillian', role: 'Experience designer', task: 'Design a friendly path from curious visitor to first merged contribution.', output: 'A five-step contributor journey and a draft welcome message.', status: 'planned' },
      { id: 'critic', parentId: 'lead', name: 'Marvin', role: 'Constructive skeptic', task: 'Identify where a newcomer could get confused, excluded, or stuck.', output: 'Three likely failure points, each with a concrete improvement.', status: 'planned' },
      { id: 'guide', parentId: 'maker', name: 'Ford', role: 'Field guide', task: 'Make the first contribution small, comprehensible, and easy to review.', output: 'A starter-issue template with acceptance criteria.', status: 'planned' },
    ], constraints: ['Keep the first contribution achievable in one sitting.', 'Distinguish proposed ideas from verified project facts.'], summary: '', deliverable: '', openQuestions: [],
  };
}

function notify(message, kind = 'info') { $('notice').textContent = message; $('notice').dataset.kind = kind; $('notice').hidden = !message; }
function selected() { return state.snapshot?.members.find((member) => member.id === state.selectedId); }
function isBuilder() { return state.snapshot?.view === 'builder'; }
function depthOf(member, members = state.snapshot.members) { let depth = 0; let current = member; while (current.parentId != null) { current = members.find((m) => m.id === current.parentId); if (!current) break; depth += 1; } return depth; }
function descendantIds(id, members = state.snapshot.members) { const ids = new Set([id]); let changed = true; while (changed) { changed = false; for (const member of members) if (ids.has(member.parentId) && !ids.has(member.id)) { ids.add(member.id); changed = true; } } return ids; }

function acceptSnapshot(input, force = false) {
  try {
    const snapshot = normalizeSnapshot(input);
    const signature = JSON.stringify(snapshot);
    if (!force && signature === state.remoteSignature) { refreshSyncLabel(); return; }
    state.remoteSignature = signature;
    if ((state.dirty || state.editing || state.missionEditing) && !force) { state.pending = snapshot; $('pending-snapshot').hidden = false; refreshSyncLabel(); return; }
    state.milestone = describeMilestone(state.snapshot, snapshot);
    state.snapshot = snapshot; state.receivedAt = new Date(); state.dirty = false; state.editing = false; state.missionEditing = false; state.pending = null; state.revision += 1; state.sentRevision = null;
    if (!snapshot.members.some((member) => member.id === state.selectedId)) state.selectedId = null;
    $('pending-snapshot').hidden = true; $('message-preview').hidden = true; render(); schedulePoll();
  } catch (error) { notify(error.message, 'error'); }
}

function markDirty() { state.dirty = true; state.revision += 1; state.sentRevision = null; $('message-preview').hidden = true; notify(''); render(); }

function positions() {
  const members = state.snapshot?.members || [];
  const width = $('constellation').clientWidth || 600;
  const root = members.find((member) => member.parentId == null);
  const leaves = members.filter((member) => !members.some((child) => child.parentId === member.id));
  const fullscreen = $('deck').dataset.display === 'fullscreen';
  const height = Math.max(fullscreen && width > 600 ? 380 : 284, leaves.length * 62 + 62);
  $('constellation').style.height = `${height}px`;
  const maxDepth = members.length ? Math.max(...members.map((member) => depthOf(member))) : 0;
  const margin = width <= 400 ? 52 : 65;
  const map = new Map(); let leafIndex = 0;
  function place(member) {
    const children = members.filter((child) => child.parentId === member.id);
    const y = children.length ? children.map(place).reduce((a, b) => a + b, 0) / children.length : 42 + ((leafIndex++ + .5) / Math.max(leaves.length, 1)) * (height - 72);
    const x = maxDepth ? margin + depthOf(member) / maxDepth * (width - margin * 2) : width / 2;
    map.set(member.id, { x, y }); return y;
  }
  if (root) place(root);
  return { map, width, height };
}

function renderMap() {
  const members = state.snapshot?.members || [];
  $('empty-map').hidden = !!members.length;
  $('crew-count').textContent = `${members.length} / 7 ${state.snapshot?.execution === 'native_agents' ? 'members' : 'roles'}`;
  const { map, width, height } = positions();
  $('connections').setAttribute('viewBox', `0 0 ${width} ${height}`);
  const paths = [];
  for (const member of members) {
    const point = map.get(member.id);
    if (member.parentId) {
      const parent = map.get(member.parentId);
      const mid = (parent.x + point.x) / 2;
      const path = svgEl('path', { d: `M ${parent.x} ${parent.y} C ${mid} ${parent.y}, ${mid} ${point.y}, ${point.x} ${point.y}`, class: `route ${member.status} ${member.id === state.selectedId || member.parentId === state.selectedId ? 'selected' : ''}` });
      paths.push(path);
    }
    let button = cursorNodes.get(member.id);
    if (!button) {
      button = el('button', 'crew-cursor'); button.type = 'button';
      const icon = svgEl('svg', { viewBox: '0 0 20 27', class: 'cursor-icon', 'aria-hidden': 'true', focusable: 'false' });
      icon.append(svgEl('path', { d: 'M2 1 L18 14 L10.8 14.8 L8.2 24 Z' }));
      const text = el('span', 'cursor-text'); text.append(el('span', 'cursor-name'), el('span', 'cursor-role'), el('span', 'cursor-state'));
      button.append(icon, text); button.addEventListener('click', () => selectMember(member.id));
      cursorNodes.set(member.id, button); $('cursor-layer').append(button);
    }
    button.style.left = `${point.x}px`; button.style.top = `${point.y}px`;
    button.dataset.status = member.status; button.setAttribute('aria-pressed', String(member.id === state.selectedId));
    button.setAttribute('aria-label', `${member.name}, ${member.role}, ${label(member.status)}. Select role.`);
    button.querySelector('.cursor-name').textContent = member.name; button.querySelector('.cursor-role').textContent = member.role; button.querySelector('.cursor-state').textContent = label(member.status);
  }
  for (const [id, button] of cursorNodes) if (!members.some((member) => member.id === id)) { button.remove(); cursorNodes.delete(id); }
  $('connections').replaceChildren(...paths);
}

function selectMember(id) {
  if (state.editing && state.selectedId !== id) { notify('Save or cancel the role edits before selecting another cursor.'); return; }
  state.selectedId = id; renderMap(); renderInspector();
  persistView();
  // Selection is presentation state. Deployment and challenges send their own
  // complete context so a later click cannot overwrite a pending command.
}

function renderInspector() {
  const member = selected(); $('inspector').hidden = !member; if (!member) return;
  $('selected-position').textContent = member.parentId == null ? 'CAPTAIN’S CHAIR' : `BRANCH ${depthOf(member)} / ${isBuilder() ? 'OUTPUT CONTRACT' : 'HOST-REPORTED WORK'}`;
  $('selected-status').textContent = label(member.status);
  writeText('inspector-title', member.name); writeText('selected-role', member.role);
  writeText('selected-task', member.task); writeText('selected-output', member.output);
  $('close-inspector').disabled = state.editing;
  $('read-contract').hidden = state.editing; $('role-form').hidden = !state.editing; $('role-actions').hidden = !isBuilder() || state.editing;
  $('edit-role').disabled = state.busy;
  $('branch-role').disabled = state.busy || state.snapshot.members.length >= 7 || depthOf(member) >= 2;
  $('branch-role').title = state.snapshot.members.length >= 7 ? 'The crew is at its seven-role limit.' : depthOf(member) >= 2 ? 'This role is at the second branch level.' : 'Add a specialist reporting to this role';
  const descendants = descendantIds(member.id);
  $('remove-role').disabled = state.busy || member.parentId == null;
  $('remove-role').textContent = descendants.size > 1 ? `Remove branch (${descendants.size})` : 'Remove';
  $('remove-role').title = member.parentId == null ? 'Every crew needs its lead role.' : 'Remove this role and its descendants from the draft';
  $('contribution').hidden = isBuilder();
  writeText('selected-result', member.result || 'No contribution has been reported yet.');
  writeText('worker-id', member.workerId ? `Host-reported worker: ${member.workerId}` : state.snapshot.execution === 'guided_passes' ? 'A role pass by the chat host; not an independent worker.' : '');
  const evidenceKey = JSON.stringify([member.id, member.evidence]);
  if (state.evidenceKey !== evidenceKey) $('evidence-list').replaceChildren(...member.evidence.map((item) => {
    const li = el('li'); const link = el('a', '', item.label); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.addEventListener('click', (event) => { if (!state.connected) return; event.preventDefault(); app.openLink({ url: item.url }).catch(() => notify('The host could not open this evidence link.', 'error')); }); li.append(link); return li;
  }));
  state.evidenceKey = evidenceKey;
  $('challenge-branch').disabled = state.busy || state.messageUnconfirmed || state.expired || state.cached || (!isPreview && (!state.connected || !state.canMessage || !state.flight?.writeToken));
}

function render() {
  const snapshot = state.snapshot; if (!snapshot) { renderMap(); return; }
  const executionLabels = { not_started: 'Chat-led crew · planned', guided_passes: 'Chat-led crew · role passes', native_agents: 'Native workers · host-reported' };
  $('execution-label').textContent = executionLabels[snapshot.execution];
  refreshSyncLabel();
  $('deck').dataset.phase = snapshot.status;
  writeText('eyebrow', 'ONE CREW. ONE FLIGHT DECK.');
  renderMission(snapshot.mission);
  writeText('mission-note', isBuilder() ? 'Select a cursor to shape its assignment.' : 'Select a cursor to inspect its contribution.');
  writeText('map-caption', isBuilder() ? 'Planned responsibilities. No work has started.' : 'Activity follows host-reported milestones, not independent telemetry.');
  const working = snapshot.members.filter((member) => member.status === 'working').length;
  const completed = snapshot.members.filter((member) => member.status === 'complete').length;
  $('flight-status').hidden = false;
  writeText('work-counts', snapshot.execution === 'not_started' ? `${snapshot.members.length} roles · ready` : `${completed}/${snapshot.members.length} complete${working ? ` · ${working} working` : ''}`);
  writeText('milestone', state.milestone);
  renderMap(); renderInspector();
  $('mission-settings').hidden = !state.missionEditing;
  $('edit-mission').disabled = !isBuilder() || state.busy || state.editing;
  $('edit-mission').hidden = !isBuilder();
  $('deploy').hidden = !isBuilder();
  $('deploy').disabled = ((!state.connected || !state.canMessage || !state.flight?.writeToken) && !isPreview) || state.expired || state.cached || state.busy || state.messageUnconfirmed || state.editing || state.missionEditing || !!state.pending || state.sentRevision === state.revision;
  $('deploy').textContent = state.busy ? 'Sending to the chat…' : state.messageUnconfirmed ? 'Awaiting chat report…' : state.sentRevision === state.revision ? 'Sent to the chat ✓' : 'Deploy the drive ↗';
  $('fork-plan').hidden = isBuilder() || !terminal(); $('fork-plan').disabled = state.busy || state.expired || state.cached;
  $('deliverable-section').hidden = isBuilder() || (!snapshot.summary && !snapshot.members.some((member) => member.result));
  writeText('result-state', snapshot.status === 'complete' ? 'Complete' : snapshot.status === 'partial' ? 'Partial result' : 'In progress');
  writeText('report-summary', snapshot.deliverable ? `Requested deliverable: ${snapshot.deliverable}` : '');
  writeText('deliverable-content', snapshot.summary || 'The final synthesis has not been reported yet. Select a cursor to read its contribution.');
  $('questions-section').hidden = !snapshot.openQuestions.length;
  const questionsKey = JSON.stringify(snapshot.openQuestions);
  if (state.questionsKey !== questionsKey) $('open-questions').replaceChildren(...snapshot.openQuestions.map((question) => el('li', '', question)));
  state.questionsKey = questionsKey;
  let truth = 'The chat does the work. This deck follows reported milestones; it does not create agents or call models.';
  if (state.expired) truth = 'This temporary flight is unavailable. The last report is preserved; ask the chat to open a new flight when needed.';
  else if (state.cached) truth = 'Showing a saved display of this flight. Its state must be checked before sending another request.';
  else if (!isPreview && state.connected && !state.flight) truth = 'This older snapshot is static. Ask the chat to open a new persistent flight deck.';
  else if (state.connected && !state.canMessage) truth = 'This host cannot receive messages from the deck. Ask it to run or challenge the crew directly in the conversation.';
  writeText('truth-note', truth);
  $('limits-note').textContent = snapshot.constraints.length ? `${snapshot.members.length} roles · ${snapshot.constraints.length} constraints · 2 branch levels max` : '7 roles maximum · 2 branch levels';
}

function startRoleEdit() {
  const member = selected(); if (!isBuilder() || !member) return;
  state.editing = true;
  for (const [id, key] of [['role-name', 'name'], ['role-role', 'role'], ['role-task', 'task'], ['role-output', 'output']]) $(id).value = member[key];
  $('parent-label').hidden = member.parentId == null;
  const candidates = state.snapshot.members.filter((candidate) => candidate.id !== member.id).filter((candidate) => {
    try { validateCrew(state.snapshot.members.map((item) => item.id === member.id ? { ...item, parentId: candidate.id } : item)); return true; } catch { return false; }
  });
  $('role-parent').replaceChildren(...candidates.map((candidate) => { const option = el('option', '', `${candidate.name} · ${candidate.role}`); option.value = candidate.id; return option; }));
  if (member.parentId != null) $('role-parent').value = member.parentId;
  render(); $('role-name').focus();
}

$('role-form').addEventListener('submit', (event) => {
  event.preventDefault(); const member = selected(); if (!member || !isBuilder()) return;
  const next = { ...member, name: $('role-name').value.trim(), role: $('role-role').value.trim(), task: $('role-task').value.trim(), output: $('role-output').value.trim(), parentId: member.parentId == null ? null : $('role-parent').value };
  const members = state.snapshot.members.map((item) => item.id === member.id ? next : item);
  try { validateCrew(members); state.snapshot.members = members; state.editing = false; markDirty(); $('edit-role').focus(); } catch (error) { notify(error.message, 'error'); }
});
$('edit-role').addEventListener('click', startRoleEdit);
$('cancel-edit').addEventListener('click', () => { state.editing = false; render(); $('edit-role').focus(); });
$('close-inspector').addEventListener('click', () => { if (state.editing) return; const id = state.selectedId; state.selectedId = null; renderMap(); renderInspector(); persistView(); cursorNodes.get(id)?.focus(); });
$('deliverable-section').addEventListener('toggle', persistView);
$('full-mission').addEventListener('toggle', persistView);
$('branch-role').addEventListener('click', () => {
  const member = selected(); if (!isBuilder() || !member || state.snapshot.members.length >= 7 || depthOf(member) >= 2) return;
  const usedNames = new Set(state.snapshot.members.map((item) => item.name));
  const name = ['Ford', 'Trillian', 'Marvin', 'Zaphod', 'Fenchurch', 'Eddie', 'Guide'].find((candidate) => !usedNames.has(candidate)) || 'Specialist';
  const id = `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  state.snapshot.members.push({ id, parentId: member.id, name, role: 'Specialist', task: `Investigate one focused part of ${member.name}’s assignment. Edit this task before deploying.`, output: 'A concise contribution with assumptions and actionable next steps.', status: 'planned', result: '', workerId: '', evidence: [] });
  state.selectedId = id; markDirty(); startRoleEdit();
});
$('remove-role').addEventListener('click', () => { const member = selected(); if (!isBuilder() || !member?.parentId) return; const ids = descendantIds(member.id); state.snapshot.members = state.snapshot.members.filter((item) => !ids.has(item.id)); state.selectedId = member.parentId; markDirty(); cursorNodes.get(state.selectedId)?.focus(); });
$('edit-mission').addEventListener('click', () => { if (!isBuilder()) return; state.missionEditing = true; $('mission-input').value = state.snapshot.mission; $('constraints-input').value = state.snapshot.constraints.join('\n'); render(); $('mission-input').focus(); });
$('cancel-mission').addEventListener('click', () => { state.missionEditing = false; render(); $('edit-mission').focus(); });
$('mission-form').addEventListener('submit', (event) => { event.preventDefault(); const mission = $('mission-input').value.trim(); const constraints = $('constraints-input').value.split('\n').map((line) => line.trim()).filter(Boolean); if (!mission) return; if (constraints.length > 8 || constraints.some((item) => item.length > 500)) { notify('Use up to eight constraints, with 500 characters or fewer per line.', 'error'); return; } state.snapshot.mission = mission; state.snapshot.constraints = constraints; state.missionEditing = false; markDirty(); $('edit-mission').focus(); });
$('load-snapshot').addEventListener('click', () => { if (state.pending) acceptSnapshot(state.pending, true); });
$('fork-plan').addEventListener('click', () => { if (!state.snapshot) return; const next = copy(state.snapshot); next.view = 'builder'; next.status = 'planned'; next.execution = 'not_started'; next.summary = ''; next.openQuestions = []; next.members = next.members.map((member) => ({ ...member, status: 'planned', result: '', evidence: [], workerId: '' })); acceptSnapshot(next, true); markDirty(); notify('A new draft is ready. Previous results stay in the conversation.'); });

export function crewPlan(snapshot) {
  validateCrew(snapshot.members);
  return { schemaVersion: 1, mission: snapshot.mission, deliverable: snapshot.deliverable || snapshot.members.find((member) => member.parentId == null).output, constraints: snapshot.constraints, limits: { maxMembers: 7, maxDepth: 2 }, members: snapshot.members.map(({ id, parentId, name, role, task, output }) => ({ id, parentId, name, role, task, output })) };
}

async function sendToChat(message, context, purpose) {
  if (state.busy || state.messageUnconfirmed) return false;
  state.lastMessage = message;
  if (isPreview) {
    $('message-preview-content').textContent = message; $('message-preview').hidden = false;
    notify('Preview only: the short chat message is shown below. The crew context is attached privately by a connected host. Nothing was sent.');
    return false;
  }
  if (!state.connected || !state.canMessage || !state.flight?.writeToken || state.expired) { notify('This flight cannot send a new request. Use the current conversation to continue the work.', 'error'); return false; }
  if (!app.getHostCapabilities()?.updateModelContext) { notify('This host cannot attach the crew context. Nothing was sent; continue in the conversation.', 'error'); return false; }
  state.busy = true; stopPolling(); render(); notify('');
  try {
    const attached = typeof context === 'function' ? await context() : context;
    // Context is mandatory: never send an incomplete command or spill the
    // serialized crew and capabilities into visible chat as a fallback.
    try {
      const updated = await app.updateModelContext({ structuredContent: attached }, { timeout: 6000 });
      if (updated?.isError) throw new Error('Context rejected.');
    } catch { throw new Error('The crew context could not reach the chat. Nothing was sent; your plan is preserved.'); }
    state.messageRevision = state.flight.revision;
    let result;
    try {
      result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] }, { timeout: 15000 });
    } catch (error) {
      // SDK v2 uses REQUEST_TIMEOUT; v1 used -32001. A lost receipt does
      // not mean the visible user message was not delivered. Never retry it.
      if (error?.code === 'REQUEST_TIMEOUT' || error?.code === -32001 || /timed?\s*out|timeout/i.test(error?.message || '')) {
        state.messageUnconfirmed = true; state.awaitingUpdate = true; state.unchangedReads = 0;
        state.milestone = 'Request submitted. Waiting for the chat’s report.';
        notify('Request submitted; waiting for the chat’s report. The host has not confirmed receipt. No automatic retry.');
        return true;
      }
      throw error;
    }
    if (result?.isError) throw new Error('The host declined the message. Your draft is still here.');
    state.awaitingUpdate = true; state.unchangedReads = 0;
    state.milestone = purpose === 'deploy' ? 'Deployed to the chat. Waiting for its first report.' : 'Challenge sent. Waiting for the revised report.';
    notify('');
    return true;
  } catch (error) {
    if (error.code === 'FLIGHT_UNAVAILABLE') { state.expired = true; state.sync = 'unavailable'; }
    if (error.code === 'FLIGHT_CONFLICT' || error.code === 'FLIGHT_BUSY') notify('The flight changed while this draft was open. Refresh the latest report before deploying; your edits are preserved.', 'error');
    else notify(`Could not send to the chat. ${clip(error?.message, 240) || 'Try again from the conversation.'}`, 'error');
    return false;
  } finally { state.busy = false; render(); schedulePoll(0); }
}

$('deploy').addEventListener('click', async () => {
  if (!isBuilder() || state.editing || state.missionEditing) return;
  try {
    const plan = crewPlan(state.snapshot);
    const message = 'Deploy the drive with this crew. Keep all progress in the existing flight deck.';
    if (await sendToChat(message, async () => {
      const saved = await app.callServerTool({ name: 'save_plan', arguments: { flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, plan: { mission: plan.mission, deliverable: plan.deliverable, constraints: plan.constraints, members: plan.members } } }, { timeout: 10000 });
      if (saved?.isError) throw resultError(saved);
      rememberFlight(saved); receiveSnapshot(saved.structuredContent, true);
      return { crewPlan: crewPlan(state.snapshot), flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, requestedAction: 'deploy', progressInstructions: 'Reuse this flight. Use show_flight for actual reported milestones; do not call build_crew again. Execute only with available host capabilities, using guided passes when native delegation is absent.' };
    }, 'deploy')) {
      state.sentRevision = state.revision; state.dirty = false; render();
    }
  } catch (error) { notify(error.message, 'error'); }
});
$('challenge-branch').addEventListener('click', async () => {
  const member = selected(); if (!member) return;
  await sendToChat(`Challenge ${member.name}’s contribution and update this flight deck.`, () => ({ flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, requestedAction: 'challenge', selectedMemberId: member.id, flightSnapshot: state.snapshot, progressInstructions: 'Inspect the selected contribution, revise as warranted, and update the same flight through show_flight. Do not create another board or invent work.' }), 'challenge');
});
$('copy-message').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.lastMessage); notify('Short message copied. Sending the full crew context requires a connected flight deck.'); } catch { notify('Copy is unavailable in this browser. You can select the short message below.'); } });
$('expand').addEventListener('click', async () => {
  if (!state.connected) return;
  const requested = state.hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  if (!state.hostContext.availableDisplayModes?.includes(requested)) { notify('This host keeps the flight deck inline. All crew controls remain available here.'); return; }
  try { const result = await app.requestDisplayMode({ mode: requested }, { timeout: 8000 }); applyHostContext({ displayMode: result.mode }); } catch { notify('The host could not change the display mode. All crew controls remain available here.'); }
});

function applyHostContext(context = {}) {
  state.hostContext = { ...state.hostContext, ...context };
  if (context.theme === 'dark' || context.theme === 'light') document.documentElement.dataset.theme = context.theme;
  const variables = context.styles?.variables;
  if (variables && typeof variables === 'object') for (const [key, value] of Object.entries(variables)) if (key.startsWith('--') && typeof value === 'string') document.documentElement.style.setProperty(key, value);
  if (context.safeAreaInsets) for (const edge of ['top', 'bottom', 'left', 'right']) { const value = context.safeAreaInsets[edge]; if (typeof value === 'number' && value >= 0) document.documentElement.style.setProperty(`--safe-${edge}`, `${value}px`); }
  $('deck').dataset.display = state.hostContext.displayMode || 'inline';
  const mode = state.hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  $('expand').hidden = !state.connected || !state.hostContext.availableDisplayModes?.includes(mode);
  $('expand').textContent = mode === 'inline' ? 'Back to chat ↙' : 'Open flight deck ⤢';
  renderMap();
}

const media = window.matchMedia('(prefers-color-scheme: dark)');
if (isPreview) document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
media.addEventListener?.('change', (event) => { if (isPreview) document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'; });
let resizeFrame;
const layoutObserver = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderMap); });
layoutObserver.observe($('constellation-wrap') || $('constellation').parentElement);

if (isPreview) {
  $('preview-banner').hidden = false;
  acceptSnapshot(previewSnapshot(), true);
} else {
  app.ontoolinput = ({ arguments: input }) => { if (!state.snapshot && typeof input?.mission === 'string') renderMission(clip(input.mission, 6000)); };
  app.ontoolinputpartial = ({ arguments: input }) => { if (!state.snapshot && typeof input?.mission === 'string') renderMission(clip(input.mission, 6000)); };
  app.ontoolresult = (result) => {
    if (result?.isError) { notify('The host could not prepare this crew. Ask it to try again in the conversation.', 'error'); return; }
    try {
      if (rememberFlight(result) === false) return;
      state.sync = state.flight ? 'watching' : 'static';
      if (state.flight && Date.now() >= Date.parse(state.flight.expiresAt)) { state.expired = true; state.sync = 'unavailable'; }
      if (Array.isArray(result?.structuredContent?.members)) receiveSnapshot(result.structuredContent, false, true);
      schedulePoll(0);
    } catch (error) { notify(error.message, 'error'); }
  };
  app.ontoolcancelled = () => notify('The host cancelled this request. No new work has been reported.');
  app.onhostcontextchanged = applyHostContext;
  app.onteardown = async () => { state.tornDown = true; stopPolling(); layoutObserver.disconnect(); cancelAnimationFrame(resizeFrame); return {}; };
  const connectingNotice = setTimeout(() => { if (!state.connected) notify('Still waiting for the chat bridge. This view cannot deploy until the host connects.'); }, 8000);
  app.onclose = () => { stopPolling(); state.connected = false; state.canMessage = false; render(); };
  app.connect(undefined, { timeout: 12000 }).then(() => { clearTimeout(connectingNotice); state.connected = true; state.canMessage = !!app.getHostCapabilities()?.message?.text; applyHostContext(app.getHostContext() || {}); render(); schedulePoll(0); }).catch(() => { clearTimeout(connectingNotice); state.connected = false; notify('The chat bridge could not connect. Reopen Heart of Gold from the conversation.', 'error'); render(); });
}
