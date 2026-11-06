/** Project files are host-supplied artifacts, never synthesized by the UI. */
import { COMPONENT_ID, installComponentProbe, createComponentCanvas, componentEventsSince, projectRenderKey, sanitizedComponentGeometry } from './component-canvas.mjs';
export const PREVIEW_URL = 'https://projectforty2.ai/heartofgold/project-preview.html';
const MAX_FILE_BYTES = 65536;
const MAX_PROJECT_BYTES = 262144;
const encoder = new TextEncoder();
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export function safeProjectLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function normalizeProject(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.files)) return null;
  if (!Number.isInteger(input.revision) || input.revision < 1 || input.files.length > 24) throw new Error('The project report has invalid revision or file limits.');
  const seen = new Set(); let total = 0;
  const files = input.files.map(file => {
    const path = clip(file.path, 240);
    if (!path || /[\\\u0000-\u001f:#?]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.') || seen.has(path)) throw new Error('The project contains an invalid or repeated file path.');
    seen.add(path);
    if (typeof file.content !== 'string') throw new Error('Project files must contain text.');
    const bytes = encoder.encode(file.content).byteLength; total += bytes;
    if (bytes > MAX_FILE_BYTES || total > MAX_PROJECT_BYTES) throw new Error('The project exceeds this flight deck’s preview limits.');
    const memberId = clip(file.memberId, 80);
    return { path, content: file.content, memberId, workerId: clip(file.workerId, 160), summary: clip(file.summary, 500), language: clip(file.language, 40), bytes, sha256: clip(file.sha256, 64) };
  });
  const changes = (Array.isArray(input.changes) ? input.changes : []).slice(0, 48).map(change => ({ path: clip(change.path, 240), operation: ['added', 'modified', 'deleted'].includes(change.operation) ? change.operation : 'modified', memberId: clip(change.memberId, 80), summary: clip(change.summary, 500) }));
  const checks = (Array.isArray(input.checks) ? input.checks : []).slice(0, 24).map(check => ({ name: clip(check.name, 160), status: ['passed', 'failed', 'not_run'].includes(check.status) ? check.status : 'not_run', details: clip(check.details, 2000), memberId: clip(check.memberId, 80), command: clip(check.command, 500), sourceDigest: clip(check.sourceDigest, 64), projectRevision: check.projectRevision }));
  const components = (Array.isArray(input.components) ? input.components : []).slice(0, 12).filter(component => COMPONENT_ID.test(component.id)).map(component => ({ id: component.id, label: clip(component.label, 120), memberId: clip(component.memberId, 80), workerId: clip(component.workerId, 160), filePaths: (Array.isArray(component.filePaths) ? component.filePaths : []).slice(0, 24).map(path => clip(path, 240)), sourceDigest: clip(component.sourceDigest, 64) }));
  const events = (Array.isArray(input.events) ? input.events : []).slice(-64).filter(event => event.kind === 'component.updated' && Number.isInteger(event.seq) && event.seq > 0 && COMPONENT_ID.test(event.componentId)).map(event => ({ id: clip(event.id, 160), seq: event.seq, kind: 'component.updated', projectRevision: event.projectRevision, flightRevision: event.flightRevision, at: clip(event.at, 80), componentId: event.componentId, memberId: clip(event.memberId, 80), workerId: clip(event.workerId, 160), changedPaths: (Array.isArray(event.changedPaths) ? event.changedPaths : []).slice(0, 24).map(path => clip(path, 240)), sourceDigest: clip(event.sourceDigest, 64) }));
  return { schemaVersion: 1, title: clip(input.title, 160) || 'The project', entrypoint: clip(input.entrypoint, 240), revision: input.revision, basedOnFlightRevision: input.basedOnFlightRevision, updatedAt: clip(input.updatedAt, 80), sourceRevision: clip(input.sourceRevision, 160), sourceDigest: clip(input.sourceDigest, 64), links: { repository: safeProjectLink(input.links?.repository), preview: safeProjectLink(input.links?.preview) }, files, changes, checks, components, events };
}
export function resolveProjectPath(reference, fromPath) {
  if (typeof reference !== 'string' || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return null;
  try { const url = new URL(reference, `https://project.invalid/${fromPath}`); return url.origin === 'https://project.invalid' ? decodeURIComponent(url.pathname.slice(1)) : null; } catch { return null; }
}
const attribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[1] ?? match[2] ?? match[3] : null;
};
const inertClose = (text, tag) => text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
export function buildPreviewDocument(project, nonce, drafts = new Map(), options = {}) {
  const files = new Map(project.files.map(file => [file.path, { ...file, content: drafts.has(file.path) ? drafts.get(file.path) : file.content }]));
  let totalBytes = 0;
  for (const file of files.values()) { const bytes = encoder.encode(file.content).byteLength; totalBytes += bytes; if (bytes > MAX_FILE_BYTES || totalBytes > MAX_PROJECT_BYTES) throw new Error('The local draft exceeds this project’s preview limits.'); }
  const entry = project.entrypoint || (files.has('index.html') ? 'index.html' : [...files.keys()].find(path => /\.html?$/i.test(path)));
  if (!entry || !files.has(entry) || !/\.html?$/i.test(entry)) throw new Error('This project has no HTML entrypoint. Read its files in Source or open its supplied preview link.');
  const warnings = new Set();
  function stylesheet(content, path, visited = new Set()) {
    if (visited.has(path)) { warnings.add(`Circular CSS import skipped: ${path}`); return ''; }
    const next = new Set(visited).add(path);
    return content.replace(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi, (match, reference) => {
      const resolved = resolveProjectPath(reference, path), file = files.get(resolved);
      if (file && /\.css$/i.test(resolved)) return stylesheet(file.content, resolved, next);
      warnings.add(`CSS import unavailable: ${reference}`); return '';
    });
  }
  let html = files.get(entry).content;
  const deferredScripts = [];
  // Files run only inside an opaque sandbox. These transformations resolve the
  // submitted relative assets; they are not an HTML security boundary.
  html = html.replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:refresh|content-security-policy)["']?[^>]*>/gi, '');
  html = html.replace(/<link\b([^>]*)>/gi, (match, attributes) => {
    if ((attribute(attributes, 'rel') || '').toLowerCase() !== 'stylesheet') return match;
    const reference = attribute(attributes, 'href'), path = resolveProjectPath(reference, entry), file = files.get(path);
    if (!file) { warnings.add(`Stylesheet unavailable: ${reference || '(missing href)'}`); return ''; }
    return `<style data-project-file="${escapeHTML(path)}">${inertClose(stylesheet(file.content, path), 'style')}</style>`;
  });
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (match, attributes, inline) => {
    const reference = attribute(attributes, 'src');
    const path = reference ? resolveProjectPath(reference, entry) : entry;
    const file = reference ? files.get(path) : null;
    if (reference && !file) { warnings.add(`Script unavailable: ${reference}`); return ''; }
    const code = reference ? file.content : inline;
    if (/\bimport\s*(?:[({*"']|[\w$]+\s+from)|\bexport\s+[^;]*\bfrom\s*["']/m.test(code)) warnings.add('Module imports require a build step; this preview runs self-contained HTML, CSS and JavaScript.');
    const type = attribute(attributes, 'type');
    const scriptType = type == null ? '' : ` type="${escapeHTML(type)}"`;
    const script = `<script${scriptType}${path ? ` data-project-file="${escapeHTML(path)}"` : ''}>${inertClose(code, 'script')}</script>`;
    // Classic external defer scripts must see the parsed document. Inlining a
    // script in the original head would silently discard that browser behavior.
    const classic = !type || /^(?:text|application)\/(?:java|ecma)script$/i.test(type);
    if (reference && classic && /(?:^|\s)defer(?:\s|=|$)/i.test(attributes)) { deferredScripts.push(script); return ''; }
    return script;
  });
  if (deferredScripts.length) {
    const deferred = deferredScripts.join('\n');
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, match => `${deferred}${match}`) : `${html}\n${deferred}`;
  }
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const probeConfig = { nonce, ids: (project.components || []).map(component => component.id), arrivalIds: options.arrivalIds || [], motionAllowed: options.motionAllowed !== false };
  const instrumentation = `<script>(${installComponentProbe.toString()})(${JSON.stringify(probeConfig).replace(/</g, '\\u003c')});<\/script>`;
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHTML(policy)}"><meta name="viewport" content="width=device-width, initial-scale=1">${instrumentation}`;
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, match => `${match}${head}`);
  else html = `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  return { html, warnings: [...warnings], entrypoint: entry };
}
export function changedProjectFiles(project, drafts) {
  return project.files.filter(file => drafts.has(file.path) && drafts.get(file.path) !== file.content).map(file => ({ path: file.path, content: drafts.get(file.path) }));
}

const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const PALETTE = ['#e0a43a', '#a3c4ba', '#bbaed1', '#d6aa8c', '#b6c8d8', '#cebc88', '#c7a3ae'];
export function createProjectWorkspace({ root, onInspectMember, onRequestEdits, openLink, onToggleMotion }) {
  let project = null, members = [], selectedPath = '', mode = 'preview', draftBaseRevision = null, activeFrame = null, pendingFrame = null, sending = false, runningDraft = false, canSend = false, lastSeq = 0, motionPaused = true, userPaused = false, motionAvailable = false;
  const drafts = new Map();
  const get = id => root.querySelector(`#${id}`);
  const fileList = get('project-files'), editor = get('project-editor'), changesList = get('project-changes-list');
  const frameSlot = get('project-preview-frame-slot'), retiredFrames = new Set();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = createComponentCanvas({ layer: get('component-overlay'), onInspectMember, onSource: selectFile });
  const canAnimate = () => !motionPaused && !reduced.matches && !document.hidden && mode === 'preview';
  function status(text, error = false) { get('project-preview-status').textContent = text; get('project-preview-status').dataset.error = String(error); }
  function selectedFile() { return project?.files.find(file => file.path === selectedPath); }
  function renderDraftControls() {
    const edits = project ? changedProjectFiles(project, drafts) : [];
    get('project-draft-status').textContent = edits.length ? `${edits.length} local ${edits.length === 1 ? 'edit' : 'edits'} · not in the reported project${draftBaseRevision !== project.revision ? ' · newer project received' : ''}` : 'Reported source · edit locally to try a change';
    get('project-run-draft').disabled = !edits.length;
    get('project-discard').hidden = !edits.length;
    get('project-send-edits').hidden = !edits.length;
    get('project-send-edits').disabled = sending || !canSend;
    get('project-send-edits').textContent = sending ? 'Sending…' : 'Ask crew to apply ↗';
  }
  function renderFiles() {
    const focusedPath = document.activeElement?.closest('[data-path]')?.dataset.path;
    fileList.replaceChildren(...project.files.map(file => {
      const row = make('div', 'project-file'); row.dataset.path = file.path;
      row.dataset.changed = String(project.changes.some(change => change.path === file.path));
      const button = make('button', 'project-file-name', file.path); button.type = 'button'; button.setAttribute('aria-pressed', String(file.path === selectedPath));
      button.addEventListener('click', () => selectFile(file.path));
      const memberIndex = members.findIndex(member => member.id === file.memberId), member = members[memberIndex];
      const owner = make(member ? 'button' : 'span', 'project-file-owner'); if (member) owner.type = 'button'; owner.style.setProperty('--agent-color', PALETTE[Math.max(0, memberIndex) % PALETTE.length]);
      const cursor = make('span', 'cursor-shape'); cursor.setAttribute('aria-hidden', 'true');
      if (member) owner.append(cursor);
      owner.append(make('span', '', member?.name || `Earlier crew member · ${file.memberId}`));
      owner.setAttribute('aria-label', member ? `Inspect ${member.name}, reported contributor to ${file.path}; ${member.status}` : `Earlier crew member ${file.memberId}, reported contributor to ${file.path}`);
      owner.title = `${member?.name || file.memberId} · reported file contributor${member ? ` · ${member.status}` : ' · no longer in this crew plan'}`;
      if (member) owner.addEventListener('click', () => onInspectMember(file.memberId));
      row.append(button, owner); return row;
    }));
    if (focusedPath) [...fileList.querySelectorAll('[data-path]')].find(row => row.dataset.path === focusedPath)?.querySelector('button')?.focus({ preventScroll: true });
  }
  function renderSource() {
    const file = selectedFile(); if (!file) return;
    get('project-file-label').textContent = file.path;
    const content = drafts.has(file.path) ? drafts.get(file.path) : file.content;
    if (editor.value !== content) editor.value = content;
    editor.setAttribute('aria-label', `Source for ${file.path}`);
    renderDraftControls();
  }
  function selectFile(path) { if (!project?.files.some(file => file.path === path)) return; selectedPath = path; renderFiles(); renderSource(); if (mode !== 'source') setMode('source'); }
  function setMode(next) {
    mode = next; root.dataset.projectMode = next;
    for (const button of root.querySelectorAll('[data-project-mode]')) { const active = button.dataset.projectMode === next; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; }
    for (const panel of root.querySelectorAll('[data-project-panel]')) panel.hidden = panel.dataset.projectPanel !== next;
    syncMotion();
    if (next === 'preview' && project && !activeFrame && !pendingFrame) runPreview(false);
  }
  function removeFrame(record) { if (!record) return; clearTimeout(record.timer); record.element.remove(); }
  function stopFrames() { removeFrame(activeFrame); removeFrame(pendingFrame); activeFrame = null; pendingFrame = null; for (const element of retiredFrames) element.remove(); retiredFrames.clear(); canvas.clear(); }
  function sendToFrame(record, type, detail = {}) { record?.element.contentWindow?.postMessage({ type, nonce: record.nonce, ...detail }, '*'); }
  function syncMotion() {
    const allowed = canAnimate(); canvas.setPaused(!allowed);
    root.dataset.motionPaused = String(!allowed);
    get('component-live').textContent = !motionAvailable ? 'Updates unavailable' : userPaused ? 'Motion paused' : reduced.matches ? 'Component updates' : 'Live component updates';
    get('component-pause').textContent = userPaused ? 'Resume motion' : 'Pause motion';
    get('component-pause').setAttribute('aria-pressed', String(userPaused));
    for (const record of [activeFrame, pendingFrame]) sendToFrame(record, 'hog:component-motion', { allowed });
  }
  function renderMissingComponents(missing) {
    get('component-missing').hidden = !missing.length;
    get('component-missing').textContent = `${missing.length} ${missing.length === 1 ? 'component' : 'components'} in Source ↗`;
    get('component-missing').dataset.path = missing[0]?.filePaths.find(path => project.files.some(file => file.path === path)) || '';
  }
  function useGeometry(record) {
    if (!record?.geometry || record !== activeFrame) return;
    renderMissingComponents(canvas.geometry(record.geometry, frameSlot.clientWidth, frameSlot.clientHeight));
  }
  function updateFrameRegistry(record) {
    if (!record || !project || record.renderKey !== projectRenderKey(project) || record.draft) return;
    record.project = project;
    sendToFrame(record, 'hog:component-registry', { ids: project.components.map(component => component.id) });
    if (record === activeFrame) { canvas.update(project.components, members); useGeometry(record); }
  }
  function promoteFrame(record) {
    if (record !== pendingFrame) return;
    clearTimeout(record.timer); record.ready = true;
    const previous = activeFrame;
    activeFrame = record; pendingFrame = null; runningDraft = record.draft;
    record.element.classList.remove('is-pending'); record.element.removeAttribute('aria-hidden'); record.element.removeAttribute('inert'); record.element.removeAttribute('tabindex');
    if (previous) { previous.element.style.pointerEvents = 'none'; retiredFrames.add(previous.element); setTimeout(() => { previous.element.remove(); retiredFrames.delete(previous.element); }, canAnimate() ? 180 : 0); }
    const missing = canvas.replaceFrame(record.draft ? [] : record.project.components, members, record.geometry, frameSlot.clientWidth, frameSlot.clientHeight, record.draft || !canAnimate() ? [] : record.events);
    renderMissingComponents(missing); syncMotion();
    if (record.error) status(`Preview error: ${record.error}`, true);
    else status(record.draft ? 'Local draft preview · not applied to the project' : `Rendered reported files · revision ${record.project.revision}`);
  }
  function runPreview(useDraft, events = []) {
    if (!project) return;
    const combinedEvents = useDraft ? [] : [...new Map([...(pendingFrame?.events || []), ...events].map(event => [event.seq, event])).values()];
    removeFrame(pendingFrame); pendingFrame = null;
    const nonce = globalThis.crypto?.randomUUID?.() || `preview-${Date.now()}-${Math.random()}`;
    let built;
    try { built = buildPreviewDocument(project, nonce, useDraft ? drafts : new Map(), { motionAllowed: canAnimate(), arrivalIds: useDraft || !canAnimate() ? [] : [...new Set(combinedEvents.map(event => event.componentId))] }); }
    catch (error) { status(error.message, true); return; }
    get('project-preview-warning').textContent = built.warnings.join(' ');
    status(useDraft ? 'Opening local draft…' : `Opening reported project · revision ${project.revision}…`);
    const frame = make('iframe', 'project-preview-frame is-pending'); frame.title = useDraft ? 'Local project draft preview' : `${project.title} · reported project preview`;
    frame.setAttribute('sandbox', 'allow-scripts allow-forms'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('inert', ''); frame.setAttribute('tabindex', '-1');
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    frame.src = local ? new URL('/heartofgold/project-preview.html', window.location.origin).href : PREVIEW_URL;
    const record = { element: frame, nonce, project, renderKey: projectRenderKey(project), draft: useDraft, events: combinedEvents, sent: false, html: built.html, geometry: null, error: null, timer: null };
    pendingFrame = record; frameSlot.insertBefore(frame, get('component-overlay'));
    record.timer = setTimeout(() => { if (pendingFrame !== record) return; removeFrame(record); pendingFrame = null; status(activeFrame ? `New preview unavailable. Showing revision ${activeFrame.project.revision}; latest Source is available.` : 'This host did not open the sandbox preview. Source and Changes remain available.', true); }, 12000);
  }
  function onMessage(event) {
    const record = [pendingFrame, activeFrame].find(frame => frame && event.source === frame.element.contentWindow);
    if (!record || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'hog:preview-ready') { if (!record.sent) { record.sent = true; sendToFrame(record, 'hog:render-project', { html: record.html }); record.html = ''; } return; }
    if (event.data.nonce !== record.nonce) return;
    if (event.data.type === 'hog:project-ready') promoteFrame(record);
    else if (event.data.type === 'hog:component-geometry') { record.geometry = sanitizedComponentGeometry(event.data, new Set(record.project.components.map(component => component.id)), frameSlot.clientWidth, frameSlot.clientHeight); if (record === activeFrame) useGeometry(record); }
    else if (event.data.type === 'hog:project-error') { record.error = clip(event.data.message, 300) || 'The submitted code reported an error.'; if (record === activeFrame) status(`Preview error: ${record.error}`, true); }
  }
  window.addEventListener('message', onMessage);
  reduced.addEventListener('change', syncMotion);
  get('component-pause').addEventListener('click', onToggleMotion);
  get('component-missing').addEventListener('click', () => { const path = get('component-missing').dataset.path; if (path) selectFile(path); else setMode('source'); });
  for (const button of root.querySelectorAll('[data-project-mode]')) {
    button.addEventListener('click', () => setMode(button.dataset.projectMode));
    button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const tabs = [...root.querySelectorAll('[data-project-mode]')], index = tabs.indexOf(button); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; setMode(tabs[next].dataset.projectMode); tabs[next].focus(); });
  }
  editor.addEventListener('input', () => { if (!selectedFile()) return; if (draftBaseRevision == null) draftBaseRevision = project.revision; drafts.set(selectedPath, editor.value); renderDraftControls(); });
  get('project-run-draft').addEventListener('click', () => { setMode('preview'); runPreview(true); });
  get('project-reload').addEventListener('click', () => runPreview(false));
  get('project-discard').addEventListener('click', () => { drafts.clear(); draftBaseRevision = null; renderSource(); if (runningDraft) runPreview(false); });
  get('project-send-edits').addEventListener('click', async () => {
    const changes = changedProjectFiles(project, drafts); if (!changes.length || sending || !canSend) return;
    sending = true; renderDraftControls();
    try { await onRequestEdits({ projectRevision: draftBaseRevision ?? project.revision, latestProjectRevision: project.revision, changes }); }
    finally { sending = false; renderDraftControls(); }
  });
  get('project-repository').addEventListener('click', () => { if (project?.links.repository) openLink(project.links.repository); });
  get('project-external-preview').addEventListener('click', () => { if (project?.links.preview) openLink(project.links.preview); });
  return {
    update(next, nextMembers = [], available = false, options = {}) {
      members = nextMembers; canSend = available;
      if (!next) { root.hidden = true; stopFrames(); project = null; return; }
      const changed = !project || projectRenderKey(project) !== projectRenderKey(next);
      const receipt = componentEventsSince(next.events, lastSeq, options.baseline === true); lastSeq = receipt.lastSeq;
      const arrivals = canAnimate() && !drafts.size ? receipt.events : [];
      project = next; root.hidden = false;
      if (!project.files.some(file => file.path === selectedPath)) selectedPath = project.entrypoint || project.files[0]?.path || '';
      for (const [path, content] of drafts) if (project.files.find(file => file.path === path)?.content === content) drafts.delete(path);
      if (!drafts.size) draftBaseRevision = null;
      get('project-title').textContent = project.title;
      get('project-revision').textContent = `Project revision ${project.revision} · ${project.files.length} files`;
      get('project-repository').hidden = !project.links.repository;
      get('project-external-preview').hidden = !project.links.preview;
      renderFiles(); if (document.activeElement !== editor || changed && !drafts.has(selectedPath)) renderSource(); else renderDraftControls();
      changesList.replaceChildren(...project.changes.map(change => { const row = make('li', 'project-change'); row.append(make('span', 'project-change-operation', change.operation), make('code', '', change.path)); if (change.summary) row.append(make('p', '', change.summary)); return row; }));
      if (!project.changes.length) changesList.append(make('li', 'muted', 'No changed files in this revision.'));
      get('project-checks').replaceChildren(...project.checks.map(check => { const row = make('li', 'project-check'); row.dataset.status = check.status; row.append(make('span', '', `${check.status.replace('_', ' ')} · ${check.name}`)); if (check.details) row.append(make('p', '', check.details)); if (check.command) row.append(make('code', '', check.command)); return row; }));
      get('project-checks-empty').hidden = !!project.checks.length;
      if (changed && !drafts.size) runPreview(false, arrivals);
      else if (changed && drafts.size) status('A newer reported project arrived. Your local edits are preserved; run your draft or reload the reported preview.');
      else { updateFrameRegistry(activeFrame); updateFrameRegistry(pendingFrame); }
      setMode(mode);
    },
    setMotionState(state) { motionPaused = !!state.paused; userPaused = !!state.userPaused; motionAvailable = !!state.available; syncMotion(); },
    destroy() { stopFrames(); canvas.destroy(); reduced.removeEventListener('change', syncMotion); window.removeEventListener('message', onMessage); },
  };
}
