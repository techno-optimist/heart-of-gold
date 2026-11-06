/** Geometry and effects describe accepted component receipts, never simulated edits. */
export const COMPONENT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export function componentEventsSince(events, lastSeq, baseline = false) {
  const valid = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object' && Number.isInteger(event.seq) && event.seq > 0 && event.kind === 'component.updated');
  return { events: baseline ? [] : valid.filter(event => event.seq > lastSeq), lastSeq: Math.max(lastSeq, 0, ...valid.map(event => event.seq)) };
}
export function projectRenderKey(project) {
  const entrypoint = project.entrypoint || (project.files.some(file => file.path === 'index.html') ? 'index.html' : project.files.find(file => /\.html?$/i.test(file.path))?.path || '');
  return JSON.stringify([project.sourceDigest || project.files.map(file => [file.path, file.sha256 || file.content]), entrypoint]);
}
export function boundedComponentRects(payload, allowedIds, width, height) {
  const result = new Map();
  if (!Array.isArray(payload?.rects) || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return result;
  for (const rect of payload.rects.slice(0, 12)) {
    if (!rect || typeof rect !== 'object') continue;
    if (!allowedIds.has(rect.id) || result.has(rect.id) || ![rect.x, rect.y, rect.width, rect.height].every(value => Number.isFinite(value) && Math.abs(value) <= 100000) || rect.width <= 0 || rect.height <= 0) continue;
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y), right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height);
    if (right <= x || bottom <= y) continue;
    result.set(rect.id, { x, y, width: right - x, height: bottom - y });
  }
  return result;
}
export function sanitizedComponentGeometry(payload, allowedIds, width, height) {
  const bounds = boundedComponentRects(payload, allowedIds, width, height);
  const missing = [...new Set((Array.isArray(payload?.missing) ? payload.missing : []).filter(id => typeof id === 'string' && allowedIds.has(id)).slice(0, 12))];
  return { rects: [...bounds].map(([id, rect]) => ({ id, ...rect })), missing };
}

/** This self-contained function is serialized into the opaque preview document. */
export function installComponentProbe(config) {
  const nonce = config.nonce;
  const validIds = values => (Array.isArray(values) ? values : []).filter(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)).slice(0, 12);
  let ids = validIds(config.ids), allowed = config.motionAllowed !== false, scheduled = 0, lastGeometry = '', ready = false, sizeObserver;
  const observed = new Set();
  const effects = new Set(), media = matchMedia('(prefers-reduced-motion: reduce)');
  const send = (type, detail = {}) => parent.postMessage({ type, nonce, ...detail }, '*');
  const targets = () => {
    const nodes = new Map(), duplicates = new Set();
    for (const element of document.querySelectorAll('[data-hog-component]')) {
      const id = element.getAttribute('data-hog-component');
      if (!ids.includes(id)) continue;
      if (nodes.has(id)) duplicates.add(id); else nodes.set(id, element);
    }
    for (const id of duplicates) nodes.delete(id);
    return nodes;
  };
  function measure() {
    scheduled = 0; if (!ready || document.hidden) return;
    const nodes = targets(), rects = [];
    const current = new Set(nodes.values());
    for (const element of observed) if (!current.has(element)) { sizeObserver?.unobserve(element); observed.delete(element); }
    for (const [id, element] of nodes) {
      if (!observed.has(element)) { sizeObserver?.observe(element); observed.add(element); }
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) rects.push({ id, x: Math.round(rect.x * 10) / 10, y: Math.round(rect.y * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 });
    }
    const geometry = JSON.stringify({ rects, missing: ids.filter(id => !nodes.has(id)), viewport: { width: innerWidth, height: innerHeight } });
    if (geometry !== lastGeometry) { lastGeometry = geometry; send('hog:component-geometry', JSON.parse(geometry)); }
  }
  function scheduleMeasure() { if (!scheduled) scheduled = requestAnimationFrame(measure); }
  function finishEffects() { for (const animation of effects) { try { animation.finish(); } catch { animation.cancel(); } } effects.clear(); }
  function arrive(componentIds) {
    if (!allowed || media.matches || document.hidden) return;
    const nodes = targets();
    for (const id of validIds(componentIds)) {
      const element = nodes.get(id);
      if (!element || element.contains(document.activeElement) || typeof element.animate !== 'function') continue;
      // The complete new element is immediately available. This short receipt
      // accent never manufactures missing sections, text, or construction steps.
      const animation = element.animate([{ opacity: .94, clipPath: 'inset(0 96% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 1100, easing: 'cubic-bezier(.2,.75,.25,1)' });
      effects.add(animation); animation.finished.catch(() => {}).finally(() => effects.delete(animation));
      const finish = () => { try { animation.finish(); } catch { animation.cancel(); } };
      element.addEventListener('pointerdown', finish, { once: true }); element.addEventListener('focusin', finish, { once: true });
    }
  }
  addEventListener('error', event => send('hog:project-error', { message: String(event.message || 'Preview script error').slice(0, 300) }));
  addEventListener('unhandledrejection', event => send('hog:project-error', { message: String(event.reason?.message || event.reason || 'Preview promise rejected').slice(0, 300) }));
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.nonce !== nonce) return;
    if (event.data.type === 'hog:component-registry') { ids = validIds(event.data.ids); lastGeometry = ''; scheduleMeasure(); }
    if (event.data.type === 'hog:component-motion') { allowed = event.data.allowed === true; if (!allowed) finishEffects(); }
    if (event.data.type === 'hog:component-arrivals') arrive(event.data.ids);
  });
  media.addEventListener('change', () => { if (media.matches) finishEffects(); });
  addEventListener('resize', scheduleMeasure, { passive: true });
  addEventListener('scroll', scheduleMeasure, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishEffects(); else scheduleMeasure(); });
  addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href]').forEach(link => link.addEventListener('click', event => { if (!link.getAttribute('href')?.startsWith('#')) event.preventDefault(); }));
    document.addEventListener('submit', event => event.preventDefault());
    new MutationObserver(scheduleMeasure).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    sizeObserver = new ResizeObserver(scheduleMeasure); sizeObserver.observe(document.documentElement);
    // Pending frames are deliberately transparent and inert. Browsers may
    // suspend their animation frames, so readiness must never wait for paint.
    ready = true; measure(); send('hog:project-ready');
    setTimeout(() => { measure(); arrive(config.arrivalIds); }, 0);
  }, { once: true });
}

const make = (tag, className, text) => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
const PALETTE = ['#e0a43a', '#a3c4ba', '#bbaed1', '#d6aa8c', '#b6c8d8', '#cebc88', '#c7a3ae'];
export function createComponentCanvas({ layer, onInspectMember, onSource }) {
  let components = [], members = [], rects = new Map(), paused = false, lastEvents = [], viewWidth = 1, viewHeight = 1;
  const cursors = new Map(), regions = new Map(), effectTimers = new Set(), pendingArrivals = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const colorFor = memberId => { const index = members.findIndex(member => member.id === memberId); return index < 0 ? '#a3aaa8' : PALETTE[index % PALETTE.length]; };
  function createRegion(component) {
    const box = make('div', 'component-region'); box.dataset.componentId = component.id; box.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('viewBox', '0 0 100 100');
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); stroke.setAttribute('x', '.5'); stroke.setAttribute('y', '.5'); stroke.setAttribute('width', '99'); stroke.setAttribute('height', '99'); stroke.setAttribute('rx', '1'); stroke.setAttribute('pathLength', '1'); stroke.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(stroke); box.append(svg, make('span', 'component-sweep')); layer.append(box); regions.set(component.id, box); return box;
  }
  function createCursor(memberId) {
    const button = make('button', 'component-cursor'); button.type = 'button'; button.dataset.memberId = memberId;
    const arrow = make('span', 'cursor-shape'); arrow.setAttribute('aria-hidden', 'true');
    const name = make('span', 'component-cursor-name'), label = make('span', 'component-cursor-label');
    const tag = make('span', 'component-cursor-tag'); tag.append(name, label); button.append(arrow, tag); layer.append(button);
    const record = { memberId, button, name, label, holds: { hover: false, focus: false, press: false }, component: null, animation: null };
    const hold = (reason, value) => {
      record.holds[reason] = value;
      const held = Object.values(record.holds).some(Boolean); button.classList.toggle('is-held', held);
      if (held && record.animation) { const transform = getComputedStyle(button).transform; record.animation.cancel(); record.animation = null; button.style.transform = transform; }
      if (!held) render();
    };
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') hold('hover', true); }); button.addEventListener('pointerleave', () => hold('hover', false));
    button.addEventListener('focus', () => hold('focus', true)); button.addEventListener('blur', () => hold('focus', false));
    button.addEventListener('pointerdown', () => hold('press', true)); button.addEventListener('pointerup', () => hold('press', false)); button.addEventListener('pointercancel', () => hold('press', false));
    button.addEventListener('click', () => { if (!record.component) return; const member = members.find(item => item.id === memberId); if (member) onInspectMember(memberId); else onSource(record.component.filePaths[0]); });
    cursors.set(memberId, record); return record;
  }
  function animateRegion(component, box) {
    if (paused || reduced.matches || document.hidden) return;
    box.classList.remove('is-arriving'); void box.offsetWidth; box.classList.add('is-arriving');
    const cursor = cursors.get(component.memberId); if (cursor) cursor.button.classList.add('is-arriving');
    const rect = rects.get(component.id);
    if (cursor && rect && cursor.component?.id === component.id && !Object.values(cursor.holds).some(Boolean) && typeof cursor.button.animate === 'function') {
      cursor.animation?.cancel();
      const pose = (x, y) => `translate3d(${Math.max(0, Math.min(viewWidth - 155, x))}px,${Math.max(0, Math.min(viewHeight - 44, y))}px,0)`;
      const animation = cursor.button.animate([
        { transform: getComputedStyle(cursor.button).transform, offset: 0 },
        { transform: pose(rect.x, rect.y), offset: .15 },
        { transform: pose(rect.x + rect.width - 4, rect.y), offset: .42 },
        { transform: pose(rect.x + rect.width - 4, rect.y + rect.height - 4), offset: .65 },
        { transform: pose(rect.x, rect.y + rect.height - 4), offset: .82 },
        { transform: cursor.button.style.transform, offset: 1 },
      ], { duration: 1600, easing: 'cubic-bezier(.25,.65,.35,1)' });
      cursor.animation = animation; animation.finished.catch(() => {}).finally(() => { if (cursor.animation === animation) cursor.animation = null; });
    }
    const timer = setTimeout(() => { box.classList.remove('is-arriving'); cursor?.button.classList.remove('is-arriving'); effectTimers.delete(timer); }, 1750);
    effectTimers.add(timer);
  }
  function render() {
    const known = new Set(components.map(component => component.id));
    for (const [id, box] of regions) if (!known.has(id)) { box.remove(); regions.delete(id); }
    for (const component of components) {
      const rect = rects.get(component.id); let box = regions.get(component.id);
      if (!box) box = createRegion(component);
      box.hidden = !rect; if (!rect) continue;
      box.style.setProperty('--component-color', colorFor(component.memberId));
      Object.assign(box.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
    const ownerIds = new Set(components.map(component => component.memberId));
    for (const [id, cursor] of cursors) if (!ownerIds.has(id)) { cursor.button.remove(); cursors.delete(id); }
    let placed = [];
    for (const memberId of ownerIds) {
      const available = components.filter(component => component.memberId === memberId && rects.has(component.id));
      let record = cursors.get(memberId); if (!record) record = createCursor(memberId);
      if (!available.length) { record.button.hidden = true; continue; }
      record.button.hidden = false;
      if (Object.values(record.holds).some(Boolean) && record.component && rects.has(record.component.id)) continue;
      const newest = [...lastEvents].reverse().find(event => available.some(component => component.id === event.componentId));
      const component = available.find(item => item.id === newest?.componentId) || available.find(item => item.id === record.component?.id) || available[0];
      record.component = component;
      const member = members.find(item => item.id === memberId), rect = rects.get(component.id);
      record.name.textContent = member?.name || 'Earlier crew'; record.label.textContent = component.label;
      record.button.style.setProperty('--agent-color', colorFor(memberId));
      record.button.setAttribute('aria-label', `${member?.name || 'Earlier crew member'} · ${component.label}. Inspect reported contribution.`);
      record.button.title = `${component.label} · ${member?.status || 'reported contributor'}`;
      const maxX = Math.max(0, viewWidth - 155), maxY = Math.max(0, viewHeight - 46);
      let x = Math.max(0, Math.min(maxX, rect.x + Math.max(0, rect.width - 150))), y = Math.max(0, Math.min(maxY, rect.y - 18));
      for (const other of placed) if (Math.abs(other.x - x) < 145 && Math.abs(other.y - y) < 44) y = Math.min(maxY, other.y + 46);
      placed.push({ x, y });
      record.button.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    for (const [id, receipt] of pendingArrivals) {
      if (performance.now() > receipt.expiresAt) { pendingArrivals.delete(id); continue; }
      const component = components.find(item => item.id === id), box = regions.get(id);
      if (!component || !box || !rects.has(id)) continue;
      pendingArrivals.delete(id); animateRegion(component, box);
    }
  }
  function stopEffects() {
    for (const timer of effectTimers) clearTimeout(timer); effectTimers.clear(); pendingArrivals.clear();
    for (const box of regions.values()) box.classList.remove('is-arriving');
    for (const cursor of cursors.values()) { cursor.button.classList.remove('is-arriving'); cursor.animation?.cancel(); cursor.animation = null; }
  }
  function onReduced() { if (reduced.matches) stopEffects(); layer.dataset.reduced = String(reduced.matches); }
  reduced.addEventListener('change', onReduced); onReduced();
  function acceptEvents(events) {
    if (!events.length) return;
    lastEvents = [...lastEvents, ...events].slice(-64);
    if (!paused && !reduced.matches && !document.hidden) for (const event of events) pendingArrivals.set(event.componentId, { event, expiresAt: performance.now() + 2200 });
  }
  function setGeometry(payload, width, height) {
    viewWidth = width; viewHeight = height;
    rects = boundedComponentRects(payload, new Set(components.map(component => component.id)), width, height);
    const missing = new Set(Array.isArray(payload?.missing) ? payload.missing : []);
    return components.filter(component => missing.has(component.id));
  }
  return {
    update(nextComponents, nextMembers, events = []) {
      components = nextComponents; members = nextMembers;
      acceptEvents(events);
      render();
    },
    replaceFrame(nextComponents, nextMembers, payload, width, height, events = []) {
      // A repeated component ID does not make geometry from another source
      // frame valid. Commit the new frame's bounds before accepting receipts.
      stopEffects(); components = nextComponents; members = nextMembers;
      const missing = setGeometry(payload, width, height);
      acceptEvents(events); render(); return missing;
    },
    geometry(payload, width, height) { const missing = setGeometry(payload, width, height); render(); return missing; },
    setPaused(value) { paused = !!value; layer.dataset.paused = String(paused); if (paused) stopEffects(); },
    clear() { components = []; rects.clear(); stopEffects(); render(); },
    destroy() { stopEffects(); reduced.removeEventListener('change', onReduced); for (const cursor of cursors.values()) cursor.button.remove(); for (const box of regions.values()) box.remove(); },
  };
}
