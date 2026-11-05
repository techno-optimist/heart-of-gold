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
const app = isPreview ? null : new App({ name: 'Heart of Gold flight deck', version: '0.1.0' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });
const state = { snapshot: null, selectedId: null, dirty: false, editing: false, missionEditing: false, pending: null, receivedAt: null, connected: false, canMessage: false, busy: false, sentRevision: null, revision: 0, hostContext: {}, lastMessage: '' };
const cursorNodes = new Map();
let displayedMission = '';

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
    if ((state.dirty || state.editing || state.missionEditing) && !force) { state.pending = snapshot; $('pending-snapshot').hidden = false; return; }
    state.snapshot = snapshot; state.receivedAt = new Date(); state.dirty = false; state.editing = false; state.missionEditing = false; state.pending = null; state.revision += 1; state.sentRevision = null;
    if (!snapshot.members.some((member) => member.id === state.selectedId)) state.selectedId = snapshot.view === 'builder' && state.hostContext.displayMode !== 'fullscreen' ? null : snapshot.members.find((member) => member.parentId == null).id;
    $('pending-snapshot').hidden = true; $('message-preview').hidden = true; notify(''); render();
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
  if (state.connected && app.getHostCapabilities()?.updateModelContext) app.updateModelContext({ structuredContent: { selectedMemberId: id, mission: state.snapshot.mission, role: selected()?.role, selectionOnly: true } }, { timeout: 3000 }).catch(() => {});
}

function renderInspector() {
  const member = selected(); $('inspector').hidden = !member; if (!member) return;
  $('selected-position').textContent = member.parentId == null ? 'CAPTAIN’S CHAIR' : `BRANCH ${depthOf(member)} / ${isBuilder() ? 'OUTPUT CONTRACT' : 'HOST-REPORTED WORK'}`;
  $('selected-status').textContent = label(member.status);
  $('inspector-title').textContent = member.name; $('selected-role').textContent = member.role;
  $('selected-task').textContent = member.task; $('selected-output').textContent = member.output;
  $('read-contract').hidden = state.editing; $('role-form').hidden = !state.editing; $('role-actions').hidden = !isBuilder() || state.editing;
  $('edit-role').disabled = state.busy;
  $('branch-role').disabled = state.busy || state.snapshot.members.length >= 7 || depthOf(member) >= 2;
  $('branch-role').title = state.snapshot.members.length >= 7 ? 'The crew is at its seven-role limit.' : depthOf(member) >= 2 ? 'This role is at the second branch level.' : 'Add a specialist reporting to this role';
  const descendants = descendantIds(member.id);
  $('remove-role').disabled = state.busy || member.parentId == null;
  $('remove-role').textContent = descendants.size > 1 ? `Remove branch (${descendants.size})` : 'Remove';
  $('remove-role').title = member.parentId == null ? 'Every crew needs its lead role.' : 'Remove this role and its descendants from the draft';
  $('contribution').hidden = isBuilder();
  $('selected-result').textContent = member.result || 'No contribution was included in this snapshot.';
  $('worker-id').textContent = member.workerId ? `Host-reported worker: ${member.workerId}` : state.snapshot.execution === 'guided_passes' ? 'A role pass by the chat host; not an independent worker.' : '';
  $('evidence-list').replaceChildren(...member.evidence.map((item) => {
    const li = el('li'); const link = el('a', '', item.label); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.addEventListener('click', (event) => { if (!state.connected) return; event.preventDefault(); app.openLink({ url: item.url }).catch(() => notify('The host could not open this evidence link.', 'error')); }); li.append(link); return li;
  }));
  $('challenge-branch').disabled = state.busy || (!isPreview && (!state.connected || !state.canMessage));
}

function render() {
  const snapshot = state.snapshot; if (!snapshot) { renderMap(); return; }
  const executionLabels = { not_started: 'Chat-led crew · planned', guided_passes: 'Chat-led crew · role passes', native_agents: 'Native workers · host-reported' };
  $('execution-label').textContent = executionLabels[snapshot.execution];
  $('snapshot-label').textContent = state.dirty ? 'Edited draft · not deployed' : `${isPreview ? 'Preview loaded' : 'Snapshot received'} ${state.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('eyebrow').textContent = isBuilder() ? 'DON’T PANIC. GIVE EVERY CURSOR A PURPOSE.' : 'FOLLOW THE WORK. QUESTION THE ANSWER.';
  renderMission(snapshot.mission);
  $('mission-note').textContent = isBuilder() ? 'Shape the crew. Give each role something useful to bring back.' : 'A snapshot of reported contributions. Select a cursor to inspect its work.';
  $('map-caption').textContent = isBuilder() ? 'Planned responsibilities. No work has started.' : 'Lines show task relationships. Status is reported by the chat host.';
  renderMap(); renderInspector();
  $('mission-settings').hidden = !state.missionEditing;
  $('edit-mission').disabled = !isBuilder() || state.busy || state.editing;
  $('edit-mission').hidden = !isBuilder();
  $('deploy').hidden = !isBuilder();
  $('deploy').disabled = ((!state.connected || !state.canMessage) && !isPreview) || state.busy || state.editing || state.missionEditing || state.sentRevision === state.revision;
  $('deploy').textContent = state.busy ? 'Sending to the chat…' : state.sentRevision === state.revision ? 'Sent to the chat ✓' : 'Deploy the drive ↗';
  $('fork-plan').hidden = isBuilder(); $('fork-plan').disabled = state.busy;
  $('deliverable-section').hidden = isBuilder();
  $('report-summary').textContent = snapshot.deliverable ? `Requested deliverable: ${snapshot.deliverable}` : '';
  $('deliverable-content').textContent = snapshot.summary || 'The host has not included a final synthesis in this snapshot. Inspect the reported contributions above.';
  $('questions-section').hidden = !snapshot.openQuestions.length;
  $('open-questions').replaceChildren(...snapshot.openQuestions.map((question) => el('li', '', question)));
  const truth = isBuilder() ? 'Deploy sends this plan into your chat. The host uses its available capabilities; this plugin does not run models or create independent agents.' : 'Reported by the chat host. Not independently verified. This view does not subscribe to background work or retain a flight history.';
  $('truth-note').textContent = state.connected && !state.canMessage ? `This host cannot receive messages from the flight deck. Ask it to run or challenge the crew directly in the conversation. ${truth}` : truth;
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
  if (state.busy) return false;
  state.lastMessage = message;
  if (isPreview) {
    $('message-preview-content').textContent = message; $('message-preview').hidden = false;
    notify('Browser preview: the departure message is shown below. Nothing was sent.');
    return false;
  }
  if (!state.connected || !state.canMessage) { notify('This host cannot accept a message from the flight deck. Ask it to execute the crew in the conversation.', 'error'); return false; }
  state.busy = true; render(); notify('');
  try {
    // The complete plan is also in the user message; context support is optional.
    try { if (app.getHostCapabilities()?.updateModelContext) await app.updateModelContext({ structuredContent: context }, { timeout: 3000 }); } catch { /* Message remains self-contained. */ }
    const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] }, { timeout: 15000 });
    if (result?.isError) throw new Error('The host declined the message. Your draft is still here.');
    notify(purpose === 'deploy' ? 'Plan sent. The chat host will decide how to execute it with the capabilities available in this conversation.' : 'The challenge was sent to the conversation.');
    return true;
  } catch (error) { notify(`Could not send to the chat. ${clip(error?.message, 220) || 'Try again from the conversation.'}`, 'error'); return false; }
  finally { state.busy = false; render(); }
}

$('deploy').addEventListener('click', async () => {
  if (!isBuilder() || state.editing || state.missionEditing) return;
  try {
    const plan = crewPlan(state.snapshot);
    const message = `Deploy the Heart of Gold crew below in this conversation. Complete the mission using the capabilities actually available here. Use native delegation only if this host provides it; otherwise perform clearly labelled sequential role passes. A role is not proof of an independent agent. Follow the task and output contracts, then synthesize a useful deliverable. Use show_flight to present actual observed contributions, results, evidence links where available, and unresolved questions. Report worker IDs only for workers actually created. Do not invent activity or claim background execution.\n\nCrew plan:\n${JSON.stringify(plan, null, 2)}`;
    const revision = state.revision;
    if (await sendToChat(message, { crewPlan: plan, requestedAction: 'deploy' }, 'deploy')) {
      state.sentRevision = revision;
      if (state.revision === revision) state.dirty = false;
      if (state.pending && !state.dirty) acceptSnapshot(state.pending, true); else render();
    }
  } catch (error) { notify(error.message, 'error'); }
});
$('challenge-branch').addEventListener('click', async () => {
  const member = selected(); if (!member) return;
  const focus = { mission: state.snapshot.mission, member: { id: member.id, name: member.name, role: member.role, task: member.task, output: member.output, result: member.result, evidence: member.evidence }, constraints: state.snapshot.constraints };
  await sendToChat(`Challenge this Heart of Gold contribution. Examine its assumptions, identify the strongest counterargument, and revise the deliverable where warranted. Verify claims with available tools when needed; distinguish reported evidence from facts you checked. Show an updated flight snapshot after the work.\n\nSelected branch:\n${JSON.stringify(focus, null, 2)}`, { challengedBranch: focus }, 'challenge');
});
$('copy-message').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.lastMessage); notify('Departure message copied. Paste it into a chat with Heart of Gold connected.'); } catch { notify('Copy is unavailable in this browser. You can select the departure message below.'); } });
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
new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderMap); }).observe($('constellation-wrap') || $('constellation').parentElement);

if (isPreview) {
  $('preview-banner').hidden = false;
  acceptSnapshot(previewSnapshot(), true);
} else {
  app.ontoolinput = ({ arguments: input }) => { if (!state.snapshot && typeof input?.mission === 'string') renderMission(clip(input.mission, 6000)); };
  app.ontoolinputpartial = ({ arguments: input }) => { if (!state.snapshot && typeof input?.mission === 'string') renderMission(clip(input.mission, 6000)); };
  app.ontoolresult = (result) => {
    if (result?.isError) { notify('The host could not prepare this crew. Ask it to try again in the conversation.', 'error'); return; }
    acceptSnapshot(result?.structuredContent);
  };
  app.ontoolcancelled = () => notify('The host cancelled this request. No new work has been reported.');
  app.onhostcontextchanged = applyHostContext;
  app.onteardown = async () => { cancelAnimationFrame(resizeFrame); return {}; };
  const connectingNotice = setTimeout(() => { if (!state.connected) notify('Still waiting for the chat bridge. This view cannot deploy until the host connects.'); }, 8000);
  app.onclose = () => { state.connected = false; state.canMessage = false; render(); };
  app.connect(undefined, { timeout: 12000 }).then(() => { clearTimeout(connectingNotice); state.connected = true; state.canMessage = !!app.getHostCapabilities()?.message?.text; applyHostContext(app.getHostContext() || {}); render(); if (!state.canMessage) notify('This host does not support messages from the flight deck. You can inspect the crew and ask the host to execute it in the conversation.'); }).catch(() => { clearTimeout(connectingNotice); state.connected = false; notify('The chat bridge could not connect. Reopen Heart of Gold from the conversation.', 'error'); render(); });
}
