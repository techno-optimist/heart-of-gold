import { App } from '@modelcontextprotocol/ext-apps';
import { createSwarmField } from '../../../public/swarm-field.mjs';
import { flightFieldState } from './swarm-adapter.mjs';
import { normalizeProject, createProjectWorkspace } from './project-preview.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const copy = (value) => JSON.parse(JSON.stringify(value));
const states = new Set(['planned', 'working', 'waiting', 'complete', 'cancelled', 'failed']);
const executions = new Set(['not_started', 'guided_passes', 'native_agents']);
const clip = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const label = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const isPreview = window.parent === window;
const app = isPreview ? null : new App({ name: 'Heart of Gold flight deck', version: '0.6.0' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: true });
const state = { snapshot: null, selectedId: null, dirty: false, editing: false, missionEditing: false, pending: null, receivedAt: null, connected: false, canMessage: false, busy: false, sentRevision: null, revision: 0, hostContext: {}, lastMessage: '', flight: null, remoteSignature: '', sync: 'waiting', expired: false, polling: false, pollFailures: 0, unchangedReads: 0, awaitingUpdate: false, messageUnconfirmed: false, messageRevision: null, milestone: '', evidenceKey: '', questionsKey: '', tornDown: false, cached: false, authoritativeSnapshot: null, authoritativeReceivedAt: null };
state.liveReadBaseline = false; state.projectHydration = true;
const crewRows = new Map();
const shipLog = [];
let lastLoggedRevision = 0;
let motionPaused = false;
let appliedMotionPause = false;
const swarmField = createSwarmField({ stage: $('star-map'), canvas: $('swarm-canvas'), nodesLayer: $('map-nodes'), onSelect: id => {
  if (id) selectMember(id);
} });
const projectWorkspace = createProjectWorkspace({ root: $('project-workspace'), onInspectMember: selectMember,
  onToggleMotion: toggleMotion,
  onRequestEdits: edits => sendToChat('Apply my source edits to this project and update the same flight deck.', () => ({ flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, requestedAction: 'apply_project_edits', ...edits, progressInstructions: 'Reconcile these local edited files with the latest project revision, preserve unrelated files, and report the actual resulting complete file set through update_project on this same flight. Do not claim a test passed unless it was run. Do not create another flight deck.' }), 'project_edit'),
  openLink: url => { if (app && state.connected) app.openLink({ url }).catch(() => notify('The host could not open this project link.', 'error')); else window.open(url, '_blank', 'noopener,noreferrer'); },
});
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
  state.projectHydration = initial || !state.liveReadBaseline || state.cached;
  const snapshot = normalizeSnapshot(input);
  if (state.messageUnconfirmed && state.flight?.revision > state.messageRevision) {
    state.messageUnconfirmed = false; state.awaitingUpdate = false; notify('');
  }
  recordObservedRevision(state.authoritativeSnapshot, snapshot);
  state.authoritativeSnapshot = snapshot; state.authoritativeReceivedAt = new Date().toISOString();
  if (initial && !state.snapshot && state.flight) {
    try {
      const cached = window.openai?.widgetState?.privateContent?.heartOfGold;
      if (cached?.version === 1 && cached.flightId === state.flight.id && Number.isInteger(cached.revision) && cached.revision >= state.flight.revision) {
        state.selectedId = typeof cached.selectedId === 'string' ? cached.selectedId : null;
        $('deliverable-section').open = cached.resultOpen === true;
        if (cached.revision > state.flight.revision) {
          state.cached = true; acceptSnapshot(normalizeSnapshot(cached.snapshot), true, true);
          const received = new Date(cached.receivedAt); if (Number.isFinite(received.getTime())) state.receivedAt = received;
          $('full-mission').open = cached.missionOpen === true; render(); return;
        }
      }
    } catch { /* Ignore an invalid or incompatible display cache. */ }
  }
  state.cached = false; acceptSnapshot(snapshot, force, true); render(); persistView();
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
function safeSyncDiagnostic(error, phase) {
  const prefix = phase === 'request' ? 'request' : 'apply';
  if (Number.isInteger(error?.code) && Math.abs(error.code) <= 2147483647) return `${prefix}:${error.code}`;
  const fixedCodes = { REQUEST_TIMEOUT: 'timeout', FLIGHT_UNAVAILABLE: 'unavailable', FLIGHT_CONFLICT: 'conflict', FLIGHT_BUSY: 'busy' };
  if (Object.hasOwn(fixedCodes, error?.code)) return `${prefix}:${fixedCodes[error.code]}`;
  const names = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'DataCloneError', 'SecurityError', 'McpError']);
  return `${prefix}:${names.has(error?.name) ? error.name : 'Error'}`;
}
function recordReadFailure(error, phase) {
  state.syncDiagnostic = safeSyncDiagnostic(error, phase);
  $('deck').dataset.syncDiagnostic = state.syncDiagnostic;
  state.pollFailures += 1; state.sync = 'reconnecting';
}
function applyReadResult(result, requestedRevision) {
  const previousFlight = state.flight, previousSignature = state.remoteSignature;
  try {
    const remembered = rememberFlight(result);
    if (remembered === false) return false;
    if (remembered !== true || typeof result.structuredContent?.unchanged !== 'boolean') throw new TypeError('Incomplete flight read response.');
    if (result.structuredContent.unchanged && state.flight.revision !== requestedRevision) throw new TypeError('Unchanged response does not match the requested revision.');
    state.sync = 'watching';
    if (result.structuredContent.unchanged) { state.unchangedReads += 1; if (state.cached && state.authoritativeSnapshot) receiveSnapshot(state.authoritativeSnapshot, true); }
    else { state.unchangedReads = 0; if (state.flight.revision > requestedRevision) state.awaitingUpdate = false; receiveSnapshot(result.structuredContent); }
    refreshSyncLabel();
    state.pollFailures = 0; state.liveReadBaseline = true;
    return true;
  } catch (error) {
    // Keep requesting the unacknowledged revision after a display/apply failure.
    state.flight = previousFlight; state.remoteSignature = previousSignature;
    throw error;
  }
}
function describeMilestone(previous, next) {
  if (next.project && previous?.project?.revision !== next.project.revision) return `Project revision ${next.project.revision} received · ${next.project.files.length} real files.`;
  if (next.status === 'complete') return 'Crew complete. The report is ready.';
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
function syncFieldMotion() {
  const reportsUnavailable = !isPreview && (!state.connected || state.expired || state.cached || state.sync === 'reconnecting');
  const pause = motionPaused || reportsUnavailable || !!state.snapshot?.project;
  if (pause !== appliedMotionPause) { appliedMotionPause = pause; swarmField.setPaused(pause); }
  projectWorkspace.setMotionState({ paused: motionPaused || reportsUnavailable || document.hidden, userPaused: motionPaused, available: !reportsUnavailable });
}
function refreshSyncLabel() {
  syncFieldMotion();
  if (!state.snapshot) return;
  const received = state.cached ? state.receivedAt : state.authoritativeReceivedAt ? new Date(state.authoritativeReceivedAt) : state.receivedAt;
  const time = received?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '—';
  const seconds = received ? Math.max(0, Math.floor((Date.now() - received.getTime()) / 1000)) : null;
  const age = seconds == null ? 'not yet received' : seconds < 5 ? 'just now' : seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
  const receipt = state.expired || (!isPreview && !state.connected) ? 'Updates unavailable' : state.cached ? 'Saved report' : state.sync === 'reconnecting' ? 'Refresh interrupted' : `Last report · ${age}`;
  writeText('receipt-age', receipt);
  $('receipt-age').title = (received ? `Received ${received.toLocaleString()}. Cursor motion is illustrative; status comes from host reports.` : 'Waiting for a report from the chat host.') + (state.syncDiagnostic ? ` Last refresh diagnostic: ${state.syncDiagnostic}.` : '');
  let text = state.dirty ? 'Draft edited' : `Last report ${time}`;
  if (isPreview) text = 'Browser preview';
  else if (state.expired || !state.connected) text = 'Updates unavailable · last report retained';
  else if (state.cached) text = 'Saved report · checking latest state';
  else if (state.sync === 'reconnecting') text = 'Refresh interrupted · retrying';
  else if (document.hidden) text = 'Updates paused while hidden';
  else if (state.flight && !terminal()) text = state.dirty ? 'Draft edited · board watching' : `Watching · ${time}`;
  writeText('snapshot-label', text);
  $('deck').dataset.sync = document.hidden ? 'paused' : state.sync;
  $('deck').dataset.fresh = String(!document.hidden && state.connected && !state.expired && !state.cached && state.sync !== 'reconnecting' && Date.now() - (received?.getTime() || 0) < 30000);
  $('refresh-flight').hidden = !state.flight;
  $('refresh-flight').disabled = state.expired || !state.connected || state.polling || state.busy;
}
function stopPolling() { clearTimeout(pollTimer); pollTimer = undefined; }
function schedulePoll(delay) {
  stopPolling();
  if (isPreview || state.tornDown || !state.connected || !state.flight?.readToken || !app.getHostCapabilities()?.serverTools || state.expired || document.hidden) return;
  const wait = delay ?? (state.pollFailures ? Math.min(30000, 3000 * 2 ** state.pollFailures) : terminal() && !state.awaitingUpdate ? 15000 : 2000);
  pollTimer = setTimeout(() => { pollFlight(); }, wait);
}
async function pollFlight(manual = false) {
  if (!state.flight?.readToken || state.expired || !state.connected || state.polling || state.tornDown || document.hidden) return;
  if (Date.now() >= Date.parse(state.flight.expiresAt)) { state.expired = true; state.sync = 'unavailable'; stopPolling(); render(); return; }
  if (state.busy) { schedulePoll(3000); return; }
  state.polling = true;
  let phase = 'apply', failureRecorded = false;
  try {
    refreshSyncLabel(); phase = 'request';
    const revision = state.flight.revision;
    const result = await app.callServerTool({ name: 'read_flight', arguments: { flightId: state.flight.id, readToken: state.flight.readToken, afterRevision: revision } }, { timeout: 10000 });
    if (state.tornDown) return;
    if (result?.isError) throw resultError(result);
    phase = 'apply'; applyReadResult(result, revision);
  } catch (error) {
    recordReadFailure(error, phase);
    failureRecorded = true;
    if (error?.code === 'FLIGHT_UNAVAILABLE') { state.expired = true; state.sync = 'unavailable'; notify('This temporary flight has expired or is unavailable. The last report remains here; no completion has been inferred.', 'error'); }
    else if (manual) notify('The flight could not refresh. Your draft and last report are still here.', 'error');
  } finally {
    state.polling = false;
    try { if (state.expired) render(); else refreshSyncLabel(); }
    catch (error) { if (!failureRecorded) recordReadFailure(error, 'apply'); }
    finally { schedulePoll(); }
  }
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
  if (document.activeElement !== $('mission-text') && $('mission-text').value !== mission) $('mission-text').value = mission;
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
    project: normalizeProject(input.project, new Set(members.map(member => member.id))),
  };
}

function notify(message, kind = 'info') {
  $('notice').textContent = message; $('notice').dataset.kind = kind; $('notice').hidden = !message;
  for (const notice of document.querySelectorAll('[data-dialog-notice]')) notice.remove();
  const dialog = document.querySelector('dialog[open]');
  if (message && dialog) {
    const notice = el('p', 'notice', message); notice.dataset.dialogNotice = ''; notice.dataset.kind = kind;
    notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); dialog.append(notice);
  }
}
function selected() { return state.snapshot?.members.find((member) => member.id === state.selectedId); }
function isBuilder() { return state.snapshot?.view === 'builder'; }
function depthOf(member, members = state.snapshot.members) { let depth = 0; let current = member; while (current.parentId != null) { current = members.find((m) => m.id === current.parentId); if (!current) break; depth += 1; } return depth; }
function descendantIds(id, members = state.snapshot.members) { const ids = new Set([id]); let changed = true; while (changed) { changed = false; for (const member of members) if (ids.has(member.parentId) && !ids.has(member.id)) { ids.add(member.id); changed = true; } } return ids; }

function acceptSnapshot(input, force = false, propagateErrors = false) {
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
  } catch (error) { if (propagateErrors) throw error; notify(error.message, 'error'); }
}

function markDirty() { state.dirty = true; state.revision += 1; state.sentRevision = null; $('message-preview').hidden = true; notify(''); render(); }

function renderMap() {
  const members = state.snapshot?.members || [];
  $('crew-count').textContent = `${members.length} / 7 ${state.snapshot?.execution === 'native_agents' ? 'members' : 'roles'}`;
  swarmField.update(flightFieldState(state.snapshot, state.flight?.id, state.selectedId));
  syncFieldMotion();
}

function renderCrewList() {
  const members = state.snapshot?.members || [];
  $('crew-list').dataset.empty = String(!members.length);
  for (const member of members) {
    let button = crewRows.get(member.id);
    if (!button) {
      button = el('button', 'crew-list-item'); button.type = 'button';
      button.append(el('span', 'crew-list-name'), el('span', 'crew-list-role'), el('span', 'crew-list-status'));
      button.addEventListener('click', () => selectMember(member.id));
      crewRows.set(member.id, button); $('crew-list').append(button);
    }
    button.dataset.status = member.status; button.dataset.depth = String(depthOf(member));
    button.setAttribute('aria-pressed', String(member.id === state.selectedId));
    button.setAttribute('aria-label', `${member.name}, ${member.role}, ${label(member.status)}. Select role.`);
    button.querySelector('.crew-list-name').textContent = member.name;
    button.querySelector('.crew-list-role').textContent = member.role;
    button.querySelector('.crew-list-status').textContent = label(member.status);
  }
  for (const [id, button] of crewRows) if (!members.some(member => member.id === id)) { button.remove(); crewRows.delete(id); }
}

function recordObservedRevision(previous, next) {
  if (!state.flight || state.flight.revision <= lastLoggedRevision) return;
  lastLoggedRevision = state.flight.revision;
  const messages = [];
  if (!previous) messages.push(`${next.members.length} crew roles received · ${label(next.status)}.`);
  else {
    if (previous.status !== next.status) messages.push(`Flight reported ${next.status}.`);
    for (const member of next.members) {
      const before = previous.members.find(item => item.id === member.id);
      if (!before) messages.push(`${member.name} added to the crew plan.`);
      else if (before.status !== member.status) messages.push(`${member.name} reported ${member.status}.`);
      else if (before.task !== member.task || before.role !== member.role || before.output !== member.output) messages.push(`${member.name}’s assignment updated.`);
      else if (before.result !== member.result) messages.push(`${member.name}’s contribution updated.`);
    }
    if (previous.mission !== next.mission) messages.push('Mission updated.');
    if (previous.summary !== next.summary) messages.push('Lead synthesis updated.');
    if (next.project && previous.project?.revision !== next.project.revision) messages.push(`Project revision ${next.project.revision} received: ${next.project.files.length} files, ${next.project.changes.length} changed.`);
    if (!messages.length) messages.push('Board revision received.');
  }
  const receivedAt = new Date().toISOString();
  shipLog.push(...messages.map(message => ({ revision: state.flight.revision, receivedAt, message })));
  if (shipLog.length > 100) shipLog.splice(0, shipLog.length - 100);
  renderShipLog();
}

function renderShipLog() {
  $('ship-log').replaceChildren(...shipLog.slice().reverse().map(entry => {
    const row = el('li', 'log-entry');
    const meta = el('div', 'log-meta');
    const time = el('time', '', new Date(entry.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); time.dateTime = entry.receivedAt;
    meta.append(el('span', '', `Revision ${entry.revision}`), time);
    row.append(meta, el('p', '', entry.message)); return row;
  }));
  if (!shipLog.length) $('ship-log').append(el('li', 'empty-log', 'No flight revisions received yet.'));
  $('ship-log').dataset.empty = String(!shipLog.length);
}

function openDialog(id) {
  const dialog = $(id); if (!dialog || dialog.open) return;
  for (const other of document.querySelectorAll('dialog[open]')) if (other !== dialog) other.close();
  if (id === 'crew-dialog' && state.snapshot && !state.selectedId) { state.selectedId = state.snapshot.members[0].id; renderMap(); renderCrewList(); renderInspector(); }
  if (id === 'log-dialog') renderShipLog();
  if (id === 'report-dialog') $('deliverable-section').open = true;
  dialog.showModal();
}

function focusCrewControl() {
  (crewRows.get(state.selectedId) || $('crew-dialog').querySelector('[data-close-dialog]'))?.focus();
}

function selectMember(id) {
  if (state.editing && state.selectedId !== id) { notify('Save or cancel the role edits before selecting another cursor.'); return; }
  state.selectedId = id; renderMap(); renderCrewList(); renderInspector(); openDialog('crew-dialog');
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
  const snapshot = state.snapshot;
  $('deck').dataset.hasSnapshot = String(!!snapshot);
  $('deck').dataset.hasProject = String(!!snapshot?.project);
  $('pause-motion').hidden = !!snapshot?.project;
  syncFieldMotion();
  projectWorkspace.update(snapshot?.project || null, snapshot?.members || [], !state.busy && !state.messageUnconfirmed && !state.expired && !state.cached && state.connected && state.canMessage && !!state.flight?.writeToken, { baseline: state.projectHydration });
  $('deck').dataset.phase = snapshot?.status || 'idle';
  if (!snapshot) {
    renderMap(); renderCrewList(); renderInspector(); renderShipLog();
    writeText('execution-label', 'Visual rehearsal · no agents running');
    writeText('crew-count', 'Your crew starts with a mission');
    writeText('map-caption', 'Only received flight revisions appear here. Times show when this deck observed each report.');
    writeText('milestone', isPreview ? 'A small crew. A wide-open universe.' : 'Waiting for the chat to assemble your crew.');
    $('flight-status').hidden = true;
    $('mission-text').disabled = !isPreview;
    $('deploy').disabled = !isPreview || !$('mission-text').value.trim();
    $('open-report').hidden = true;
    $('edit-mission').disabled = true;
    return;
  }
  const executionLabels = { not_started: 'Chat-led crew · planned', guided_passes: 'Chat-led crew · role passes', native_agents: 'Native workers · host-reported' };
  $('execution-label').textContent = executionLabels[snapshot.execution];
  refreshSyncLabel();
  writeText('eyebrow', 'HEART OF GOLD / MISSION CONTROL');
  renderMission(snapshot.mission);
  writeText('mission-note', isBuilder() ? 'Select a cursor to shape its assignment.' : 'Select a cursor to inspect its contribution.');
  writeText('map-caption', 'Received flight revisions only. Times show when this deck observed each host report; they are not execution timestamps.');
  const working = snapshot.members.filter((member) => member.status === 'working').length;
  const completed = snapshot.members.filter((member) => member.status === 'complete').length;
  $('flight-status').hidden = false;
  writeText('work-counts', snapshot.execution === 'not_started' ? `${snapshot.members.length} roles · ready` : `${completed}/${snapshot.members.length} complete${working ? ` · ${working} working` : ''}`);
  writeText('milestone', state.milestone);
  renderMap(); renderCrewList(); renderInspector();
  $('mission-settings').hidden = !state.missionEditing;
  $('edit-mission').disabled = !isBuilder() || state.busy || state.editing || state.messageUnconfirmed || state.cached || state.expired;
  $('edit-mission').hidden = !isBuilder();
  $('mission-text').disabled = !isBuilder() || state.busy || state.messageUnconfirmed || state.cached || state.expired || state.missionEditing;
  const hasResult = !!snapshot.summary || snapshot.members.some(member => member.result);
  $('open-report').hidden = !hasResult;
  $('copy-report').disabled = !hasResult;
  $('deploy').hidden = false;
  $('deploy').disabled = isBuilder() ? ((!state.connected || !state.canMessage || !state.flight?.writeToken) && !isPreview) || !snapshot.mission.trim() || state.expired || state.cached || state.busy || state.messageUnconfirmed || state.editing || state.missionEditing || !!state.pending || state.sentRevision === state.revision : !terminal() || !hasResult;
  $('deploy').textContent = !isBuilder() ? terminal() ? 'Open report ↗' : 'In flight' : state.busy ? 'Sending to the chat…' : state.messageUnconfirmed ? 'Awaiting chat report…' : state.sentRevision === state.revision ? 'Sent to the chat ✓' : 'Engage drive ↗';
  writeText('composer-mode', isBuilder() ? 'Powered by your chat' : snapshot.status === 'working' ? 'Following your chat' : 'Mission reported');
  $('fork-plan').hidden = isBuilder() || !terminal(); $('fork-plan').disabled = state.busy || state.expired || state.cached;
  $('deliverable-section').hidden = isBuilder() || !hasResult;
  writeText('result-state', snapshot.status === 'complete' ? 'Complete' : snapshot.status === 'partial' ? 'Partial result' : 'In progress');
  writeText('report-summary', snapshot.deliverable ? `Requested deliverable: ${snapshot.deliverable}` : '');
  writeText('deliverable-content', snapshot.summary || 'The final synthesis has not been reported yet. Select a cursor to read its contribution.');
  $('questions-section').hidden = !snapshot.openQuestions.length;
  const questionsKey = JSON.stringify(snapshot.openQuestions);
  if (state.questionsKey !== questionsKey) $('open-questions').replaceChildren(...snapshot.openQuestions.map((question) => el('li', '', question)));
  state.questionsKey = questionsKey;
  let truth = 'An open-source experiment from ProjectForty2. Bring a towel. Check the work.';
  if (state.expired) truth = 'This temporary flight is unavailable. The last report is preserved; ask the chat to open a new flight when needed.';
  else if (state.cached) truth = 'Showing a saved display of this flight. Its state must be checked before sending another request.';
  else if (!isPreview && state.connected && !state.flight) truth = 'This older snapshot is static. Ask the chat to open a new persistent flight deck.';
  else if (state.connected && !state.canMessage) truth = 'This host cannot receive messages from the deck. Ask it to run or challenge the crew directly in the conversation.';
  writeText('truth-note', truth);
  $('limits-note').textContent = snapshot.project ? `${snapshot.project.files.length} reported files · project revision ${snapshot.project.revision}` : snapshot.execution !== 'not_started' ? 'Awaiting project files' : snapshot.constraints.length ? `${snapshot.members.length} roles · ${snapshot.constraints.length} constraints · 2 branch levels max` : '7 roles maximum · 2 branch levels';
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
$('close-inspector').addEventListener('click', () => { if (state.editing) return; const id = state.selectedId; state.selectedId = null; renderMap(); renderCrewList(); renderInspector(); persistView(); crewRows.get(id)?.focus(); });
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
$('remove-role').addEventListener('click', () => { const member = selected(); if (!isBuilder() || !member?.parentId) return; const ids = descendantIds(member.id); state.snapshot.members = state.snapshot.members.filter((item) => !ids.has(item.id)); state.selectedId = member.parentId; markDirty(); crewRows.get(state.selectedId)?.focus(); });
$('edit-mission').addEventListener('click', () => { if (!isBuilder()) return; state.missionEditing = true; $('mission-input').value = state.snapshot.mission; $('constraints-input').value = state.snapshot.constraints.join('\n'); render(); openDialog('crew-dialog'); $('mission-input').focus(); });
$('cancel-mission').addEventListener('click', () => { state.missionEditing = false; render(); focusCrewControl(); });
$('mission-form').addEventListener('submit', (event) => { event.preventDefault(); const mission = $('mission-input').value.trim(); const constraints = $('constraints-input').value.split('\n').map((line) => line.trim()).filter(Boolean); if (!mission) return; if (constraints.length > 8 || constraints.some((item) => item.length > 500)) { notify('Use up to eight constraints, with 500 characters or fewer per line.', 'error'); return; } state.snapshot.mission = mission; state.snapshot.constraints = constraints; state.missionEditing = false; markDirty(); focusCrewControl(); });
$('load-snapshot').addEventListener('click', () => { if (state.pending) acceptSnapshot(state.pending, true); });
$('fork-plan').addEventListener('click', () => { if (!state.snapshot) return; const next = copy(state.snapshot); next.view = 'builder'; next.status = 'planned'; next.execution = 'not_started'; next.summary = ''; next.openQuestions = []; next.members = next.members.map((member) => ({ ...member, status: 'planned', result: '', evidence: [], workerId: '' })); acceptSnapshot(next, true); markDirty(); notify('A new draft is ready. Previous results stay in the conversation.'); });

export function crewPlan(snapshot) {
  validateCrew(snapshot.members);
  const mission = snapshot.mission.trim();
  if (!mission || mission.length > 6000) throw new Error('Give the crew a mission of up to 6,000 characters.');
  return { schemaVersion: 1, mission, deliverable: snapshot.deliverable || snapshot.members.find((member) => member.parentId == null).output, constraints: snapshot.constraints, limits: { maxMembers: 7, maxDepth: 2 }, members: snapshot.members.map(({ id, parentId, name, role, task, output }) => ({ id, parentId, name, role, task, output })) };
}

for (const [button, dialog] of [['open-crew', 'crew-dialog'], ['open-log', 'log-dialog'], ['open-report', 'report-dialog'], ['open-guide', 'guide-dialog']]) $(button).addEventListener('click', () => openDialog(dialog));
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => $(button.dataset.closeDialog)?.close());
function toggleMotion() {
  motionPaused = !motionPaused; syncFieldMotion();
  $('pause-motion').setAttribute('aria-pressed', String(motionPaused));
  $('pause-motion').textContent = motionPaused ? 'Resume motion' : 'Pause motion';
}
$('pause-motion').addEventListener('click', toggleMotion);
$('pause-motion').title = 'Pause the visualization. Crew work in the chat is unaffected.';
$('mission-text').addEventListener('input', () => {
  if (!state.snapshot) { $('deploy').disabled = !isPreview || !$('mission-text').value.trim(); return; }
  if (!isBuilder() || state.busy || state.messageUnconfirmed) return;
  state.snapshot.mission = $('mission-text').value; markDirty();
});

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
    state.milestone = purpose === 'deploy' ? 'Deployed to the chat. Waiting for its first report.' : purpose === 'project_edit' ? 'Source edits sent. Waiting for the revised project.' : 'Challenge sent. Waiting for the revised report.';
    notify('');
    return true;
  } catch (error) {
    if (error.code === 'FLIGHT_UNAVAILABLE') { state.expired = true; state.sync = 'unavailable'; }
    if (error.code === 'FLIGHT_CONFLICT' || error.code === 'FLIGHT_BUSY') notify('The flight changed while this draft was open. Refresh the latest report before deploying; your edits are preserved.', 'error');
    else notify(`Could not send to the chat. ${clip(error?.message, 240) || 'Try again from the conversation.'}`, 'error');
    return false;
  } finally { state.busy = false; render(); schedulePoll(0); }
}

$('mission-composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.snapshot) { notify('Open Heart of Gold in a connected chat and ask it to assemble this crew. This browser preview cannot start work.'); return; }
  if (!isBuilder()) { if (terminal()) openDialog('report-dialog'); return; }
  if (!isBuilder() || state.editing || state.missionEditing) return;
  try {
    const plan = crewPlan(state.snapshot);
    const missionChangedSinceLastReport = plan.mission !== state.authoritativeSnapshot?.mission;
    const message = 'Engage the drive with this crew. Keep all progress in the existing flight deck.';
    if (await sendToChat(message, async () => {
      const saved = await app.callServerTool({ name: 'save_plan', arguments: { flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, plan: { mission: plan.mission, deliverable: plan.deliverable, constraints: plan.constraints, members: plan.members } } }, { timeout: 10000 });
      if (saved?.isError) throw resultError(saved);
      rememberFlight(saved); receiveSnapshot(saved.structuredContent, true);
      return { crewPlan: crewPlan(state.snapshot), flightId: state.flight.id, writeToken: state.flight.writeToken, expectedRevision: state.flight.revision, requestedAction: 'deploy', missionChangedSinceLastReport, progressInstructions: 'Before executing, check every existing role, task and output contract against the current mission. If the mission changed, re-specialize this same crew for the new mission, retaining stable member IDs, branch bounds and user constraints; report the revised plan through show_flight before starting work. Reuse this flight for all actual reported milestones; do not call build_crew again. Execute only with available host capabilities, using guided passes when native delegation is absent.' };
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
$('copy-report').addEventListener('click', async () => {
  const snapshot = state.snapshot; if (!snapshot) return;
  const parts = ['# Heart of Gold · ProjectForty2', snapshot.mission, `Status: ${snapshot.status}. Reported by the chat host; not independently verified.`];
  if (snapshot.summary) parts.push('## Lead synthesis', snapshot.summary);
  for (const member of snapshot.members.filter(item => item.result)) {
    parts.push(`## ${member.name} · ${member.role}`, member.result);
    if (member.evidence.length) parts.push(member.evidence.map(item => `${item.label}: ${item.url}`).join('\n'));
  }
  if (snapshot.openQuestions.length) parts.push('## Still worth asking', snapshot.openQuestions.map(question => `- ${question}`).join('\n'));
  try { await navigator.clipboard.writeText(parts.join('\n\n')); notify('Report copied. Keep a towel handy.'); }
  catch { notify('This host cannot copy to the clipboard. You can select the report text or ask the chat for an export.', 'error'); }
});
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
render();
if (isPreview) {
  $('preview-banner').hidden = false;
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
  app.onteardown = async () => { state.tornDown = true; stopPolling(); swarmField.destroy(); projectWorkspace.destroy(); return {}; };
  const connectingNotice = setTimeout(() => { if (!state.connected) notify('Still waiting for the chat bridge. This view cannot deploy until the host connects.'); }, 8000);
  app.onclose = () => { stopPolling(); state.connected = false; state.canMessage = false; render(); };
  app.connect(undefined, { timeout: 12000 }).then(() => { clearTimeout(connectingNotice); state.connected = true; state.canMessage = !!app.getHostCapabilities()?.message?.text; applyHostContext(app.getHostContext() || {}); render(); schedulePoll(0); }).catch(() => { clearTimeout(connectingNotice); state.connected = false; notify('The chat bridge could not connect. Reopen Heart of Gold from the conversation.', 'error'); render(); });
}
