const $ = (id) => document.getElementById(id);
const API_BASE = new URL('./api/', import.meta.url);
const endpoint = (path) => new URL(path.replace(/^\/?api\/?/, ''), API_BASE);
const EXPECT_HOSTED = document.documentElement.dataset.runtime === 'hosted' || (['projectforty2.ai', 'www.projectforty2.ai'].includes(location.hostname) && API_BASE.pathname.startsWith('/heartofgold/'));
const idleInspector = $('inspector').firstElementChild.cloneNode(true);
const presets = {
  community: 'Design a welcoming first-contribution experience for an open-source agent community.',
  research: 'Explore the tradeoffs of small, bounded agent teams versus a single agent. Separate hypotheses from things we would need to test.',
  build: 'Plan a tiny, accessible community garden directory. Divide the product, data, and usability questions, then bring back one coherent proposal.',
};
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const colors = ['#d5f673', '#baa5df', '#eab68d', '#9ed2bf', '#e8d489', '#b9c8f0', '#d9a4b8'];
let config = null;
let browserOnly = false;
let runs = [];
let currentRun = null;
let selectedNode = null;
let localTimer = null;
let refreshTimer = null;
let events = null;
let launching = false;
let initializing = true;
let runtimeUnreachable = false;
let connectionBusy = false;
let expiryTimer = null;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function textValue(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function notify(message) { $('app-notice').textContent = message; }
async function api(path, options = {}) {
  const response = await fetch(endpoint(path), { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(config?.token ? { 'X-Flight-Token': config.token } : {}), ...options.headers } });
  const data = await response.json();
  if (!response.ok) {
    if (config?.hosted && ['SESSION_EXPIRED', 'CSRF_INVALID'].includes(data.code)) {
      runtimeUnreachable = true; events?.close(); events = null; updateControls();
      notify('Your temporary session has changed or expired. Refresh Previous flights to reconnect. No simulator fallback was started.');
    }
    throw Object.assign(new Error(textValue(data.error || data.message) || `Request failed (${response.status}).`), { code: data.code });
  }
  return data;
}
function persistLocal() {
  try { localStorage.setItem('heart-of-gold-flights-v1', JSON.stringify(runs.slice(0, 12))); } catch { /* Browser storage is optional. */ }
}
function remember(run) {
  runs = [run, ...runs.filter((item) => item.id !== run.id)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30);
  if (browserOnly) persistLocal();
}
function active(run = currentRun) { return run && !terminal.has(run.status); }
function liveMode() { return config?.hosted ? 'api' : 'codex'; }
function liveAvailable() { return !!config?.adapters?.[liveMode()]?.available; }
function providerName(id) { return config?.providers?.find((provider) => provider.id === id)?.name || ({ openai: 'OpenAI', anthropic: 'Claude', xai: 'Grok' }[id]) || id || 'Provider'; }
function updateProviderHelp() {
  const provider = config?.providers?.find((item) => item.id === $('provider-select').value);
  $('provider-detail').textContent = provider?.detail || '';
  const link = $('provider-key-link');
  try { const url = new URL(provider?.keyUrl); if (url.protocol !== 'https:') throw new Error(); link.href = url.href; link.hidden = false; } catch { link.removeAttribute('href'); link.hidden = true; }
  $('workspace-field').hidden = provider?.id !== 'anthropic';
  if (provider?.id !== 'anthropic') $('workspace-id').value = '';
}
function applyConfig(next) {
  config = next;
  const hosted = !!config.hosted;
  const connection = config.connection;
  $('codex-mode').value = liveMode();
  $('live-mode-detail').textContent = hosted ? connection ? providerName(connection.provider) : 'Your API account' : 'Local Codex';
  $('hosted-connection').hidden = !hosted;
  $('local-connection').hidden = hosted;
  $('power-drive').hidden = !hosted || !!connection;
  $('connection-label').textContent = hosted ? connection ? `${providerName(connection.provider)} connected` : 'Power the drive' : config.adapters.codex?.available ? 'Codex installed' : 'Simulator connected';
  $('connection-detail').textContent = hosted ? connection ? 'Your API account is connected for this temporary session. Choose a model on the flight deck, then set a course.' : 'Connect your own API account. Your crew uses that provider’s models, with usage billed to you.' : config.adapters.codex?.detail || 'Install Codex CLI and sign in to enable local agents. Model access is checked on launch.';
  $('connected-summary').hidden = !connection;
  $('connect-form').hidden = !!connection;
  $('connected-provider').textContent = connection ? `${providerName(connection.provider)} · connected` : '';
  const expiry = connection?.expiresAt ? new Date(connection.expiresAt) : null;
  $('connected-expiry').textContent = expiry && !Number.isNaN(expiry.getTime()) ? `Session ends ${expiry.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Save your results.` : 'Temporary session. Save your results before disconnecting.';
  const selectedProvider = $('provider-select').value;
  $('provider-select').replaceChildren(...(config.providers || []).map((provider) => {
    const option = el('option', '', provider.name); option.value = provider.id; return option;
  }));
  if ((config.providers || []).some((provider) => provider.id === selectedProvider)) $('provider-select').value = selectedProvider;
  updateProviderHelp();
  $('model-select').replaceChildren(...(connection?.models || []).map((model) => {
    const option = el('option', '', model.label || model.id); option.value = model.id; return option;
  }));
  if (connection?.model) $('model-select').value = connection.model;
  if (!liveAvailable() && $('codex-mode').checked) document.querySelector('input[name="mode"][value="demo"]').checked = true;
  clearTimeout(expiryTimer);
  if (expiry && !Number.isNaN(expiry.getTime())) {
    const remaining = expiry.getTime() - Date.now();
    expiryTimer = setTimeout(async () => {
      try {
        // Activity extends idle expiry; ask the server before declaring the session over.
        const refreshed = await api('/api/config');
        applyConfig(refreshed);
        if (refreshed.connection) return;
        runtimeUnreachable = true;
        $('provider-key').value = '';
        $('connection-label').textContent = 'Session ended';
        notify('Your temporary connection has ended. Refresh Previous flights to reconnect. If the session expired, server history is cleared; any result still displayed here can be downloaded.');
      } catch {
        runtimeUnreachable = true;
        notify('The session could not be checked. Refresh Previous flights to reconnect; no simulator fallback was started.');
      }
      updateControls();
    }, Math.max(0, Math.min(remaining, 2147483647)));
  }
  updateMode(); updateControls();
}
function updateMode() {
  const live = document.querySelector('input[name="mode"]:checked')?.value !== 'demo';
  $('mode-note').textContent = live ? config?.hosted ? 'Real API calls, billed by your provider. Text work; no browsing or file tools.' : 'Real Codex sessions. Your account usage applies. Read-only text work.' : browserOnly ? 'Browser-only simulation. Scripted crew, no AI calls, no charges.' : 'A scripted demo of delegation. No AI calls, no charges.';
  $('launch-note').textContent = live ? config?.hosted ? 'Your API account. Bounded crew. Real model usage.' : 'Local agents. Bounded crew. Real model usage.' : 'A small step for your to-do list.';
  $('model-control').hidden = !config?.hosted || !config.connection || !live;
}
function updateControls() {
  const busy = active() || launching || initializing || runtimeUnreachable || connectionBusy;
  $('launch-button').disabled = !!busy;
  $('cancel-button').hidden = !active();
  $('cancel-button').disabled = false;
  $('launch-button').firstElementChild.textContent = initializing ? 'Checking the flight deck…' : runtimeUnreachable ? 'Connection interrupted' : launching ? 'Preparing the ship…' : active() ? 'Crew out exploring…' : 'Engage improbability drive';
  $('task').disabled = !!busy;
  document.querySelectorAll('[data-preset], #max-agents, #max-depth, input[name="mode"]').forEach((input) => {
    input.disabled = !!busy || (input.id === 'codex-mode' && !liveAvailable());
  });
  $('model-select').disabled = !!busy;
  $('power-drive').disabled = initializing || runtimeUnreachable || connectionBusy;
  ['provider-select', 'provider-key', 'workspace-id', 'connect-submit'].forEach((id) => { $(id).disabled = connectionBusy || initializing || runtimeUnreachable || active(); });
  $('disconnect-button').disabled = connectionBusy || initializing || runtimeUnreachable;
  $('disconnect-button').textContent = active() ? 'Disconnect & stop crew' : 'Disconnect';
  $('connect-submit').firstElementChild.textContent = connectionBusy ? 'Checking your drive…' : 'Connect the drive';
}
function layoutNodes(nodes) {
  const positions = new Map();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter((node) => !node.parentId || !nodeIds.has(node.parentId));
  const children = (node) => nodes.filter((other) => other.parentId === node.id);
  const weight = (node, visited = new Set()) => {
    if (visited.has(node.id)) return 1;
    visited.add(node.id);
    const descendants = children(node);
    return descendants.length ? descendants.reduce((sum, child) => sum + weight(child, visited), 0) : 1;
  };
  function place(node, left, right, depth) {
    if (positions.has(node.id)) return;
    positions.set(node.id, { x: (left + right) / 2, y: 18 + Math.min(depth, 2) * 31 });
    const descendants = children(node);
    const total = descendants.reduce((sum, child) => sum + weight(child), 0);
    let cursor = left;
    descendants.forEach((child) => {
      const width = (right - left) * weight(child) / total;
      place(child, cursor, cursor + width, depth + 1);
      cursor += width;
    });
  }
  roots.forEach((node, index) => place(node, 5 + index * 90 / roots.length, 5 + (index + 1) * 90 / roots.length, 0));
  return positions;
}
function renderMap() {
  const nodes = currentRun?.nodes || [];
  const focusedAgent = document.activeElement?.dataset?.agentId;
  $('map-empty').hidden = nodes.length > 0;
  $('map-nodes').replaceChildren();
  $('map-lines').replaceChildren();
  const positions = layoutNodes(nodes);
  nodes.forEach((node, index) => {
    const pos = positions.get(node.id);
    if (!pos) return;
    if (node.parentId && positions.has(node.parentId)) {
      const from = positions.get(node.parentId);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const x1 = from.x * 6.2, y1 = from.y * 4.8 + 15, x2 = pos.x * 6.2, y2 = pos.y * 4.8 - 13;
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`);
      if (node.status === 'completed') path.setAttribute('class', 'complete');
      $('map-lines').append(path);
    }
    const button = el('button', `agent-node${selectedNode === node.id ? ' selected' : ''}`);
    button.type = 'button';
    button.style.left = `${pos.x}%`;
    button.style.top = `${pos.y}%`;
    button.style.setProperty('--agent-color', colors[index % colors.length]);
    button.dataset.state = node.status;
    button.dataset.agentId = node.id;
    button.setAttribute('aria-label', `${node.name || 'Agent'}: ${node.role || 'crew'}, ${node.status}. Inspect task.`);
    button.setAttribute('aria-pressed', selectedNode === node.id ? 'true' : 'false');
    const cursor = el('span', 'cursor-shape');
    cursor.setAttribute('aria-hidden', 'true');
    const label = el('span');
    label.append(el('span', 'agent-name', node.name || 'Agent'));
    const role = el('span', 'agent-role');
    role.append(el('i', 'node-status'), document.createTextNode(node.status === 'running' ? 'Working' : node.status === 'waiting' ? 'Waiting on crew' : node.status));
    label.append(role);
    button.append(cursor, label);
    button.addEventListener('click', () => { selectedNode = node.id; renderMap(); renderInspector(); });
    $('map-nodes').append(button);
    if (focusedAgent === node.id) button.focus({ preventScroll: true });
  });
  $('crew-count').textContent = `${nodes.length} crew aboard`;
  $('run-state').textContent = (currentRun?.status || 'standby').toUpperCase();
  $('run-state').dataset.state = currentRun?.status || 'standby';
  $('map-mode').textContent = currentRun ? currentRun.mode === 'api' ? `LIVE ${providerName(currentRun.provider).toUpperCase()} / REAL API CALLS` : currentRun.mode === 'codex' ? 'LIVE CODEX / REAL SESSIONS' : browserOnly ? 'BROWSER-ONLY / SCRIPTED DEMO' : 'FLIGHT SIMULATOR / SCRIPTED DEMO' : browserOnly ? 'BROWSER-ONLY SIMULATOR' : config?.hosted ? 'HOSTED FLIGHT DECK / READY' : 'SIMULATOR READY';
  $('map-title').textContent = !currentRun ? 'A little space to think.' : currentRun.status === 'completed' ? 'The crew is home.' : currentRun.status === 'cancelled' ? 'Safely out of hyperspace.' : currentRun.status === 'failed' ? 'A disturbance in the field.' : currentRun.status === 'interrupted' ? 'Flight interrupted.' : 'Good ideas travel together.';
}
function renderInspector() {
  const node = currentRun?.nodes.find((item) => item.id === selectedNode);
  if (!node) { $('inspector').replaceChildren(idleInspector.cloneNode(true)); return; }
  const wrap = el('div', 'agent-detail');
  const avatar = el('div', 'inspector-avatar');
  avatar.append(el('span', 'cursor-shape'));
  wrap.append(avatar, el('h2', '', node.name || 'Crew member'), el('p', 'detail-role', node.role || 'Agent'), el('span', 'detail-status', node.status));
  wrap.append(el('p', 'detail-label', 'Their mission'), el('p', 'detail-task', node.task));
  wrap.append(el('p', 'detail-label', node.status === 'completed' ? 'What they brought back' : 'Latest transmission'));
  wrap.append(el('p', 'detail-summary', textValue(node.summary || node.result || (node.status === 'waiting' ? 'Waiting for delegated work to return.' : node.status === 'queued' ? 'Waiting for a crew slot.' : 'No result yet. The ship’s log records progress.'))));
  if (node.result && node.result !== node.summary) {
    const contribution = el('details', 'contribution');
    contribution.append(el('summary', '', 'Read full contribution'), el('pre', '', textValue(node.result)));
    wrap.append(contribution);
  }
  const parent = currentRun.nodes.find((item) => item.id === node.parentId);
  wrap.append(el('p', 'detail-meta', `${parent ? `Delegated by ${parent.name}` : 'Mission lead'} · Depth ${node.depth || 0}`));
  $('inspector').replaceChildren(wrap);
}
function eventDescription(event) {
  const data = event.data || {};
  const node = currentRun?.nodes.find((item) => item.id === (data.nodeId || data.node?.id));
  const name = data.name || data.node?.name || node?.name || 'Crew member';
  const descriptions = {
    'run.created': 'Mission received. Packing the metaphorical towel.',
    'run.completed': 'Flight complete. Result ready for your review.',
    'run.failed': `Flight failed: ${textValue(data.error || data.message || 'See run details.')}`,
    'run.cancelled': 'Stop requested. The crew is heading home.',
    'run.interrupted': 'Previous flight interrupted. No agents were restarted.',
    'node.created': `${name} joined the crew.`,
    'node.started': `${name} started work.`,
    'node.waiting': `${name} is waiting on delegated work.`,
    'node.completed': `${name} returned a result.`,
    'node.failed': `${name} could not finish: ${textValue(data.error || data.message || 'see details')}`,
    'node.cancelled': `${name} stopped.`,
    'node.activity': `${name}: ${textValue(data.message || data.activity || data.text || data.type || 'working')}`,
  };
  return descriptions[event.type] || event.type.replaceAll('.', ' · ');
}
function renderLog() {
  const log = currentRun?.events || [];
  $('log-count').textContent = `${String(log.length).padStart(2, '0')} EVENTS`;
  if (!log.length) { const row = el('li', 'empty-log'); row.append(el('time', '', '—'), el('span', '', 'All systems pleasantly uneventful. Awaiting a mission.')); $('ship-log').replaceChildren(row); return; }
  const items = log.slice(-40).reverse().map((event) => {
    const row = el('li');
    const date = new Date(event.at || event.timestamp || currentRun.createdAt);
    row.append(el('time', '', Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour12: false })), el('span', '', eventDescription(event)));
    return row;
  });
  $('ship-log').replaceChildren(...items);
}
function renderHistory() {
  const list = runs.slice(0, 8).map((run) => {
    const button = el('button', `history-item${run.id === currentRun?.id ? ' active' : ''}`);
    button.append(el('strong', '', run.task), el('small', '', `${run.mode !== 'demo' ? 'Live' : 'Demo'} · ${run.status}`));
    button.addEventListener('click', async () => {
      if (active() && currentRun.id !== run.id) { notify('Let the current crew return, or stop the run, before opening another flight.'); return; }
      try {
        currentRun = browserOnly ? run : await api(`/api/runs/${encodeURIComponent(run.id)}`);
        selectedNode = currentRun.nodes?.[0]?.id;
        notify('');
        render();
      } catch (error) { notify(error.message); }
    });
    return button;
  });
  $('history-list').replaceChildren(...(list.length ? list : [el('p', 'muted', 'Your first departure awaits.')]));
}
function renderResult() {
  const done = currentRun && terminal.has(currentRun.status);
  $('result-section').hidden = !done;
  if (!done) return;
  const result = textValue(currentRun.result);
  $('result-title').textContent = currentRun.status === 'completed' ? 'The crew brought something back.' : currentRun.status === 'cancelled' ? 'This flight was stopped.' : currentRun.status === 'interrupted' ? 'This flight was interrupted.' : 'This flight needs attention.';
  $('result-provenance').textContent = currentRun.mode === 'api' ? `LIVE ${providerName(currentRun.provider).toUpperCase()} · ${currentRun.model || 'API model'} · Agent-generated text; claims are not web-verified.` : currentRun.mode === 'codex' ? 'LIVE CODEX · Agent-generated output. Review claims before using them.' : 'SCRIPTED SIMULATION · Illustrative output. No model performed this mission.';
  $('result-content').textContent = result || textValue(currentRun.error) || 'No final result was produced. Individual crew outputs and events are available in the flight receipt.';
  $('download-result').disabled = !result;
}
function render() { renderMap(); renderInspector(); renderLog(); renderHistory(); renderResult(); updateControls(); }
async function refreshRun() {
  if (!currentRun || browserOnly) return;
  const id = currentRun.id;
  try {
    const updated = await api(`/api/runs/${encodeURIComponent(id)}`);
    if (currentRun?.id !== id) return;
    currentRun = updated;
    remember(updated);
    if (!selectedNode) selectedNode = updated.nodes?.[0]?.id;
    render();
  } catch (error) { if (!['SESSION_EXPIRED', 'CSRF_INVALID'].includes(error.code)) notify(`The ship’s radio is quiet: ${error.message} The display may be stale; this does not stop the agents.`); }
}
function listen() {
  events?.close();
  events = new EventSource(endpoint('/api/events'));
  events.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === 'connection.changed') {
        api('/api/config').then((next) => {
          applyConfig(next);
          if (!next.connection) notify('Your provider connection is no longer available. Open Power the drive to reconnect. The current mission may have failed; check its result.');
          refreshRun();
        }).catch((error) => { runtimeUnreachable = true; updateControls(); notify(`Could not refresh your provider connection: ${error.message}`); });
        return;
      }
      if (event.runId === currentRun?.id) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refreshRun, 80);
      }
    } catch { /* Ignore non-protocol heartbeat messages. */ }
  };
  events.onerror = () => {
    if (active()) notify('Reconnecting to the local flight deck. The display may be stale; agents may still be running.');
  };
  events.onopen = () => { notify(''); refreshRun(); };
}
function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = el('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function localEvent(run, type, data = {}) {
  const event = { id: `${run.id}-${run.events.length}`, runId: run.id, type, at: new Date().toISOString(), data };
  run.events.push(event);
  run.updatedAt = event.at;
}
function launchSimulation(task, limits) {
  const run = { id: `sim-${Date.now().toString(36)}`, task, mode: 'demo', status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), nodes: [], events: [], result: null, error: null, limits };
  let step = 0;
  const addNode = (id, parentId, name, role, nodeTask, depth) => {
    if (run.nodes.length >= limits.maxAgents || depth > limits.maxDepth) return;
    const node = { id, parentId, name, role, task: nodeTask, depth, status: 'queued', summary: '', result: '', children: [] };
    run.nodes.push(node);
    const parent = run.nodes.find((item) => item.id === parentId);
    if (parent) parent.children.push(id);
    localEvent(run, 'node.created', { nodeId: id, name });
  };
  const status = (id, state, summary) => {
    const node = run.nodes.find((item) => item.id === id);
    if (!node) return;
    node.status = state;
    if (summary) node.summary = summary;
    if (state === 'completed') node.result = summary;
    localEvent(run, `node.${state === 'running' ? 'started' : state}`, { nodeId: id, name: node.name });
  };
  const steps = [
    () => { localEvent(run, 'run.created'); addNode('lead', null, 'Arthur', 'Mission lead', task, 0); status('lead', 'running'); },
    () => { addNode('guide', 'lead', 'Ford', 'Explore the problem', 'Map the people, questions, and constraints involved in this mission.', 1); addNode('critic', 'lead', 'Marvin', 'Challenge assumptions', 'Find likely failure modes and propose a small, useful experiment.', 1); status('lead', 'waiting'); status('guide', 'running'); status('critic', 'running'); },
    () => { if (limits.maxDepth > 1 && run.nodes.length < limits.maxAgents) { addNode('reader', 'guide', 'Trillian', 'First-time perspective', 'Consider what a newcomer needs to understand before taking their first step.', 2); status('guide', 'waiting'); status('reader', 'running'); } else { localEvent(run, 'node.activity', { nodeId: 'guide', message: 'Keeping this flight within its crew limits.' }); } },
    () => { status('critic', 'completed', 'Simulator example: make the first action reversible, explain the expected result, and show failures plainly. Test with one newcomer before adding more features.'); },
    () => { status('reader', 'completed', 'Simulator example: show a worked example, keep the first task small, and make it clear where to ask for help.'); status('guide', 'running'); },
    () => { status('guide', 'completed', 'Simulator example: define one audience, one small deliverable, and one observable success measure. Add a clear guide and an accessible first step.'); status('lead', 'running'); },
    () => {
      const observations = [`${run.nodes.length} simulated crew member${run.nodes.length === 1 ? '' : 's'} took part.`];
      const leadBranches = run.nodes.filter((node) => node.parentId === 'lead').length;
      observations.push(leadBranches ? `Arthur delegated ${leadBranches} question${leadBranches === 1 ? '' : 's'} and waited for the results.` : 'Arthur kept the mission within the selected single-agent limits.');
      if (run.nodes.some((node) => node.id === 'guide')) observations.push(run.nodes.some((node) => node.id === 'reader') ? 'Ford delegated a narrower question to Trillian, then combined her result.' : 'Ford worked within the selected crew limit.');
      if (run.nodes.some((node) => node.id === 'critic')) observations.push('Marvin challenged assumptions independently.');
      run.result = `FLIGHT SIMULATOR — ILLUSTRATIVE OUTPUT\n\nYour mission\n${task}\n\nThis was a scripted demonstration of a bounded agent team. No AI model evaluated this mission.\n\nWhat the flight demonstrated\n${observations.map((line) => `• ${line}`).join('\n')}\n\nA useful next step\nRun the local app, connect Codex, and try this mission with real agents. Review their deliverables and compare a small team with a single-agent baseline.\n\nDon't panic. Keep the experiment small. Bring a towel.`;
      status('lead', 'completed', 'The crew’s example findings are assembled. This output is simulated; connect local Codex to tackle your actual mission.');
      run.status = 'completed'; localEvent(run, 'run.completed'); clearInterval(localTimer); localTimer = null;
    },
  ];
  steps[step++]();
  currentRun = run; selectedNode = 'lead'; remember(run); render();
  localTimer = setInterval(() => {
    if (run.status !== 'running') { clearInterval(localTimer); return; }
    steps[step++]?.(); remember(run); render();
  }, 1400);
  return run;
}
async function initialize() {
  let bridgeSeen = false;
  try {
    const response = await fetch(endpoint('/api/config'), { signal: AbortSignal.timeout(6000), credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Flight deck unavailable (${response.status}).`);
    config = await response.json();
    if (!config.adapters) throw new Error('No runtime protocol');
    bridgeSeen = true;
    if (EXPECT_HOSTED && !config.hosted) throw new Error('The hosted flight deck returned an unexpected configuration.');
    applyConfig(config);
    const history = await api('/api/runs');
    runs = Array.isArray(history) ? history : history.runs || [];
    currentRun = runs.find((run) => !terminal.has(run.status)) || null;
    if (currentRun) selectedNode = currentRun.nodes?.[0]?.id;
    listen();
  } catch (error) {
    if (bridgeSeen || EXPECT_HOSTED) {
      runtimeUnreachable = true;
      $('connection-label').textContent = 'Connection interrupted';
      $('connection-detail').textContent = 'The hosted flight deck could not be reached. Close this panel and use the refresh button beside Previous flights to retry. No API key can be entered until a session is established.';
      if (EXPECT_HOSTED && !config) config = { hosted: true, adapters: { api: { available: false }, demo: { available: true } }, providers: [], connection: null };
      $('hosted-connection').hidden = true; $('local-connection').hidden = true;
      notify(`The flight deck is unavailable: ${error.message} Use the refresh button beside Previous flights to reconnect. No simulator fallback was started.`);
      initializing = false;
      updateMode(); render();
      return;
    }
    browserOnly = true;
    config = { adapters: { codex: { available: false }, demo: { available: true } } };
    $('connection-label').textContent = 'Browser-only simulator';
    $('connection-detail').textContent = 'You’re aboard the public flight simulator. Visit the hosted flight deck to connect your API account, or run the open-source app locally with Codex. This preview makes no model calls.';
    try {
      const stored = JSON.parse(localStorage.getItem('heart-of-gold-flights-v1') || '[]');
      runs = Array.isArray(stored) ? stored.filter((run) => run && run.mode === 'demo' && Array.isArray(run.nodes) && Array.isArray(run.events)).slice(0, 12) : [];
      runs.forEach((run) => { if (!terminal.has(run.status)) { run.status = 'interrupted'; run.error = 'This browser simulation ended when the page closed.'; run.nodes.forEach((node) => { if (!terminal.has(node.status)) node.status = 'interrupted'; }); } });
      persistLocal();
    } catch { runs = []; }
  }
  initializing = false;
  updateMode(); render();
}
$('mission-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (active() || launching || initializing || runtimeUnreachable) return;
  const task = $('task').value.trim();
  if (!task) { $('task').focus(); return; }
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const payload = { task, mode, maxAgents: Number($('max-agents').value), maxDepth: Number($('max-depth').value), concurrency: 3 };
  launching = true; notify(''); updateControls();
  try {
    if (browserOnly) {
      if (mode !== 'demo') throw new Error('Live agents require the local runtime.');
      launchSimulation(task, payload);
    } else {
      currentRun = await api('/api/runs', { method: 'POST', body: JSON.stringify(payload) });
      selectedNode = currentRun.nodes?.[0]?.id;
      remember(currentRun);
    }
    render();
    if (window.innerWidth < 590) $('map-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  } catch (error) { notify(`Unable to launch: ${error.message}`); }
  finally { launching = false; updateControls(); }
});
$('cancel-button').addEventListener('click', async () => {
  if (!active()) return;
  $('cancel-button').disabled = true;
  try {
    if (browserOnly) {
      clearInterval(localTimer); localTimer = null;
      currentRun.status = 'cancelled';
      currentRun.nodes.forEach((node) => { if (!terminal.has(node.status)) node.status = 'cancelled'; });
      localEvent(currentRun, 'run.cancelled');
    } else currentRun = await api(`/api/runs/${encodeURIComponent(currentRun.id)}/cancel`, { method: 'POST', body: '{}' });
    remember(currentRun); render();
  } catch (error) { notify(`The stop request failed: ${error.message} Agents may still be running.`); $('cancel-button').disabled = false; }
});
document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => { $('task').value = presets[button.dataset.preset]; $('task').focus(); }));
document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', updateMode));
['guide-open', 'about-open', 'footer-guide'].forEach((id) => $(id).addEventListener('click', () => $('guide-dialog').showModal()));
$('connect-open').addEventListener('click', () => $('connect-dialog').showModal());
$('power-drive').addEventListener('click', () => $('connect-dialog').showModal());
$('provider-select').addEventListener('change', () => { $('provider-key').value = ''; $('connect-error').textContent = ''; updateProviderHelp(); });
$('connect-dialog').addEventListener('close', () => { $('provider-key').value = ''; $('workspace-id').value = ''; });
$('connect-dialog').addEventListener('cancel', () => { $('provider-key').value = ''; $('workspace-id').value = ''; });
$('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!config?.hosted || connectionBusy || initializing || runtimeUnreachable || active()) return;
  const provider = $('provider-select').value;
  const key = $('provider-key').value.trim();
  if (!key || !provider) return;
  const payload = { provider, key };
  if (provider === 'anthropic' && $('workspace-id').value.trim()) payload.workspaceId = $('workspace-id').value.trim();
  $('provider-key').value = '';
  $('workspace-id').value = '';
  connectionBusy = true; $('connect-error').textContent = 'Checking your API account and available models…'; updateControls();
  try {
    const next = await api('/api/connect', { method: 'POST', body: JSON.stringify(payload) });
    applyConfig(next);
    if (liveAvailable()) $('codex-mode').checked = true;
    $('connect-error').textContent = '';
    $('connect-dialog').close();
    notify('Your drive is connected. Choose a model and give the crew a mission. API usage is billed to your provider account.');
    updateMode(); render();
  } catch (error) { $('connect-error').textContent = `Could not connect: ${error.message} Your key field has been cleared.`; }
  finally { payload.key = ''; connectionBusy = false; updateControls(); }
});
$('disconnect-button').addEventListener('click', async () => {
  if (!config?.hosted || connectionBusy || runtimeUnreachable) return;
  connectionBusy = true; $('connect-error').textContent = 'Disconnecting the drive and stopping active work…'; updateControls();
  try {
    applyConfig(await api('/api/disconnect', { method: 'POST', body: '{}' }));
    document.querySelector('input[name="mode"][value="demo"]').checked = true;
    $('connect-error').textContent = '';
    $('provider-key').value = '';
    notify('Drive disconnected. The API key has been removed and active work stopped. Session history remains until expiry or server restart.');
    await refreshRun(); updateMode(); render();
  } catch (error) { $('connect-error').textContent = `Disconnect failed: ${error.message} The connection may still be active.`; }
  finally { connectionBusy = false; updateControls(); }
});
$('model-select').addEventListener('change', async () => {
  if (!config?.hosted || connectionBusy || active() || runtimeUnreachable) return;
  const model = $('model-select').value;
  const previousModel = config.connection?.model;
  connectionBusy = true; updateControls();
  try { applyConfig(await api('/api/model', { method: 'POST', body: JSON.stringify({ model }) })); notify('Engine selected. The next mission will use this model.'); }
  catch (error) { $('model-select').value = previousModel || ''; notify(`Could not change model: ${error.message}`); }
  finally { connectionBusy = false; updateControls(); }
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('download-result').addEventListener('click', () => { if (currentRun?.result) download(`heart-of-gold-${currentRun.id}.txt`, textValue(currentRun.result), 'text/plain'); });
$('download-receipt').addEventListener('click', () => { if (currentRun) download(`heart-of-gold-${currentRun.id}-receipt.json`, JSON.stringify(currentRun, null, 2), 'application/json'); });
$('refresh-history').addEventListener('click', async () => {
  if (browserOnly) { renderHistory(); notify('Browser simulator flights are saved only in this browser.'); return; }
  try {
    applyConfig(await api('/api/config'));
    const history = await api('/api/runs');
    runs = Array.isArray(history) ? history : history.runs || [];
    runtimeUnreachable = false;
    if (currentRun && !runs.some((run) => run.id === currentRun.id)) { currentRun = null; selectedNode = null; }
    if (!currentRun) { currentRun = runs.find((run) => !terminal.has(run.status)) || null; selectedNode = currentRun?.nodes?.[0]?.id; }
    if (!events) listen();
    notify(''); render(); await refreshRun();
  } catch (error) { notify(error.message); }
});
window.addEventListener('beforeunload', () => { $('provider-key').value = ''; if (browserOnly) persistLocal(); events?.close(); });
updateControls();
initialize();
