/**
 * An original, event-led cursor field for Heart of Gold.
 * Movement is presence choreography, never a claim that a tool is clicking,
 * drawing, browsing, or producing output. Runtime nodes are the only live crew.
 */
import { createWorkRoute, sampleWorkRoute, motionAllowed, observedCompletion, mobileCrewSlots } from './swarm-motion.mjs';

const PALETTE = ['#e0a43a', '#a3c4ba', '#bbaed1', '#d6aa8c', '#b6c8d8', '#cebc88', '#c7a3ae'];
const REHEARSAL = [
  { id: 'preview-lead', parentId: null, name: 'Deep Thought', role: 'Lead', depth: 0 },
  { id: 'preview-ford', parentId: 'preview-lead', name: 'Ford', role: 'Explorer', depth: 1 },
  { id: 'preview-trillian', parentId: 'preview-lead', name: 'Trillian', role: 'Builder', depth: 1 },
  { id: 'preview-marvin', parentId: 'preview-ford', name: 'Marvin', role: 'Skeptic', depth: 2 },
  { id: 'preview-arthur', parentId: 'preview-ford', name: 'Arthur', role: 'Researcher', depth: 2 },
  { id: 'preview-zaphod', parentId: 'preview-trillian', name: 'Zaphod', role: 'Prototyper', depth: 2 },
  { id: 'preview-eddie', parentId: 'preview-trillian', name: 'Eddie', role: 'Verifier', depth: 2 },
];
const STATUS = { queued: 'Queued', running: 'Working', waiting: 'Waiting on crew', completed: 'Complete', cancelled: 'Stopped', failed: 'Needs attention', interrupted: 'Interrupted' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = value => value * value * (3 - 2 * value);
function seed(id) {
  let value = 2166136261;
  for (const char of String(id)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return (value >>> 0) / 4294967295;
}

export function createSwarmField({ stage, canvas, nodesLayer, onSelect = () => {} }) {
  if (!stage || !canvas || !nodesLayer) throw new Error('Swarm field requires a stage, canvas, and nodes layer.');
  const ctx = canvas.getContext('2d');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const records = new Map();
  const dock = stage.parentElement?.querySelector('.mission-dock');
  let width = 1, height = 1, dpr = 1, frame = 0, previousTime = 0, elapsed = 0;
  let paused = false, destroyed = false, preview = true, runId = null, status = 'standby', selectedNode = null;
  let data = [], bounds = { left: 30, right: 300, top: 100, bottom: 400 }, lastLayoutSignature = '';
  let rehearsalStations = [], dockTop = Infinity;

  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  nodesLayer.setAttribute('aria-label', 'Crew cursors. Select a crew member to inspect their assignment.');

  function staticMode() { return paused || media.matches || document.hidden; }
  function stop() { if (frame) cancelAnimationFrame(frame); frame = 0; previousTime = 0; }
  function measure() {
    if (destroyed) return;
    const rect = stage.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    const dockRect = dock?.getBoundingClientRect();
    const nextDockTop = dockRect?.height > 0 && dockRect.top < rect.bottom && dockRect.bottom > rect.top
      ? Math.max(0, Math.round(dockRect.top - rect.top)) : Infinity;
    const resized = nextWidth !== width || nextHeight !== height || nextDpr !== dpr;
    if (!resized && nextDockTop === dockTop) return;
    width = nextWidth; height = nextHeight; dpr = nextDpr; dockTop = nextDockTop;
    if (resized) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    layout();
    // Resizing or an expanding dock must not cover a cursor during its glide.
    for (const record of records.values()) {
      const x = clamp(record.x, bounds.left, bounds.right), y = clamp(record.y, bounds.top, bounds.bottom);
      if (record.x !== x || record.y !== y) { record.x = x; record.y = y; record.trail.length = 0; pose(record); }
    }
    if (staticMode()) settle();
    draw(); wake();
  }

  function layout() {
    const mobile = width <= 760;
    const padding = mobile ? 24 : 52;
    const labelWidth = width < 1000 ? Math.min(125, width * .31) : 160;
    const heroRight = width * .05 + 520;
    const rightEdge = Math.max(padding + 20, width - padding - labelWidth - 24);
    const idleLeft = Math.min(rightEdge, Math.max(width * .52, heroRight + 24));
    // These are cursor-tip bounds; the label's height is also clear of the dock.
    // Override these CSS custom properties on the stage for another embedding.
    const computed = getComputedStyle(stage);
    const readBound = (name, fallback) => {
      const value = Number.parseFloat(computed.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const requestedTop = readBound(preview ? '--swarm-idle-top' : '--swarm-run-top', preview ? mobile ? 260 : width < 1000 ? 70 : 120 : 145);
    const fallbackBottom = readBound('--swarm-field-bottom', mobile ? Math.min(440, height - 413) : height - 315);
    const bottom = clamp(Math.min(fallbackBottom, dockTop - (preview ? 48 : 70)), 0, height);
    // Do not force a minimum span below an expanded dock. Very tall notices
    // may compress this area, but never move the crew underneath the controls.
    const top = Math.min(requestedTop, Math.max(0, bottom - 24));
    bounds = {
      left: preview && !mobile ? idleLeft : padding,
      right: rightEdge,
      top,
      bottom,
    };
    const spanX = bounds.right - bounds.left, spanY = bounds.bottom - bounds.top;
    const ordered = data.map(node => records.get(node.id)).filter(Boolean);
    if (preview && !mobile) {
      // Working stations stay to the right of the idle headline. Narrow desktop
      // fields become a staggered column instead of colliding with the hero.
      const points = spanX < 230
        ? [[.12, .00], [.75, .16], [.08, .32], [.85, .48], [.12, .64], [.75, .80], [.08, .96]]
        : [[.12, .04], [.58, .13], [.98, .31], [.57, .48], [.04, .57], [.15, .91], [.78, .89]];
      ordered.forEach((record, index) => {
        const point = points[index % points.length];
        record.tx = bounds.left + spanX * point[0];
        record.ty = bounds.top + spanY * point[1];
      });
    } else if (mobile) {
      const { slots, rows } = mobileCrewSlots(data);
      ordered.forEach(record => {
        const { lane, row } = slots.get(record.data.id);
        record.tx = row === 0 ? bounds.left + spanX * .48 : bounds.left + spanX * (lane ? .94 : .08);
        if (record.data.depth > 1 && !preview) record.tx += lane ? -10 : 10;
        record.ty = bounds.top + spanY * row / rows;
      });
    } else {
      const roots = data.filter(node => !node.parentId || !records.has(node.parentId));
      const children = id => data.filter(node => node.parentId === id);
      const weight = (node, seen = new Set()) => {
        if (seen.has(node.id)) return 1;
        const next = new Set(seen); next.add(node.id);
        const descendants = children(node.id);
        return descendants.length ? descendants.reduce((sum, child) => sum + weight(child, next), 0) : 1;
      };
      const maxDepth = Math.max(1, ...data.map(node => Number(node.depth) || 0));
      const placed = new Set();
      function place(node, left, right, depth) {
        if (placed.has(node.id)) return;
        placed.add(node.id);
        const record = records.get(node.id);
        record.tx = bounds.left + spanX * (left + right) / 2;
        record.ty = bounds.top + spanY * (.12 + Math.min(depth / maxDepth, 1) * .82);
        const descendants = children(node.id);
        const total = descendants.reduce((sum, child) => sum + weight(child), 0);
        let edge = left;
        descendants.forEach(child => {
          const next = edge + (right - left) * weight(child) / total;
          place(child, edge, next, depth + 1); edge = next;
        });
      }
      roots.forEach((node, index) => place(node, index / roots.length, (index + 1) / roots.length, 0));
      // Defensive placement keeps malformed/custom adapter nodes inspectable.
      ordered.filter(record => !placed.has(record.data.id)).forEach((record, index) => {
        record.tx = bounds.left + spanX * (.2 + index * .17);
        record.ty = bounds.top + spanY * .65;
      });
    }
    ordered.forEach(record => {
      record.tx = clamp(record.tx, bounds.left, bounds.right);
      record.ty = clamp(record.ty, bounds.top, bounds.bottom);
      record.button.style.setProperty('--label-max', `${labelWidth}px`);
      record.role.style.display = preview && width < 1000 ? 'none' : ''; // The field's rehearsal disclosure remains visible.
      record.route = createWorkRoute({ bounds, home: { x: record.tx, y: record.ty }, seed: record.seed, index: record.index });
      if (record.rest) { record.rest.x = clamp(record.rest.x, bounds.left, bounds.right); record.rest.y = clamp(record.rest.y, bounds.top, bounds.bottom); }
    });
    rehearsalStations = preview ? ordered.map(record => ({ x: record.tx, y: record.ty })) : [];
    for (const record of [...ordered].sort((a, b) => (a.data.depth || 0) - (b.data.depth || 0))) {
      if (!record.fresh) continue;
      const parent = records.get(record.data.parentId);
      record.x = parent ? parent.x : record.tx - 22;
      record.y = parent ? parent.y : record.ty + 16;
      record.fresh = false;
    }
    lastLayoutSignature = `${width}:${height}:${dockTop}:${preview}:${data.map(node => `${node.id}/${node.parentId}/${node.depth}`).join('|')}`;
  }

  function makeRecord(node, index) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'agent-node';
    button.style.position = 'absolute'; button.style.left = '0'; button.style.top = '0';
    const pointer = document.createElement('span'); pointer.className = 'cursor-shape'; pointer.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'agent-label';
    const name = document.createElement('span'); name.className = 'agent-name';
    const role = document.createElement('span'); role.className = 'agent-role';
    label.append(name, role); button.append(pointer, label); nodesLayer.append(button);
    const record = { data: node, button, pointer, name, role, color: PALETTE[index % PALETTE.length], x: width / 2, y: height / 2, tx: 0, ty: 0, opacity: 0, fresh: true, trail: [], seed: seed(node.id), motionTime: 0, trailAt: 0, angle: 0 };
    pointer.style.transformOrigin = '50% 50%';
    button.style.setProperty('--agent-color', record.color);
    button.addEventListener('click', () => { if (!destroyed) onSelect(preview ? null : record.data.id); });
    button.addEventListener('focus', () => { record.focused = true; draw(); });
    button.addEventListener('blur', () => { record.focused = false; draw(); wake(); });
    button.addEventListener('pointerenter', event => { record.hovered = event.pointerType !== 'touch'; });
    button.addEventListener('pointerleave', () => { record.hovered = false; wake(); });
    button.addEventListener('pointerdown', event => { record.pressed = true; try { button.setPointerCapture(event.pointerId); } catch { /* Capture is optional. */ } });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => { record.pressed = false; wake(); });
    return record;
  }

  function update({ nodes = [], runId: nextRunId = null, status: nextStatus = 'standby', selectedNode: nextSelected = null } = {}) {
    if (destroyed) return;
    const geometryStateChanged = runId !== nextRunId || status !== nextStatus;
    const nextPreview = !nextRunId && (!Array.isArray(nodes) || nodes.length === 0);
    const nextData = nextPreview ? REHEARSAL.map(node => ({ ...node, status: 'preview' })) : (Array.isArray(nodes) ? nodes : []).filter(node => node && typeof node.id === 'string').slice(0, 64);
    if (runId !== nextRunId || preview !== nextPreview) {
      for (const record of records.values()) record.button.remove();
      records.clear();
    }
    runId = nextRunId; status = nextStatus; preview = nextPreview; selectedNode = nextSelected;
    data = [...new Map(nextData.map(node => [node.id, node])).values()];
    const ids = new Set(data.map(node => node.id));
    for (const [id, record] of records) if (!ids.has(id)) { record.button.remove(); records.delete(id); }
    data.forEach((node, index) => {
      let record = records.get(node.id);
      const previousStatus = record?.data.status;
      if (!record) { record = makeRecord(node, index); records.set(node.id, record); }
      if (previousStatus !== node.status) {
        if (node.status === 'running') { record.motionTime = -(index * 220 + record.seed * 400); record.rest = null; }
        else if (previousStatus === 'running' && node.status === 'waiting') record.rest = { x: record.x, y: record.y };
        else record.rest = null;
        record.workSample = null;
        if (!preview && !staticMode() && node.parentId && observedCompletion(previousStatus, node.status)) record.handoffAt = elapsed;
      }
      record.data = node; record.index = index;
      record.name.textContent = node.name || 'Crew member';
      record.role.textContent = preview ? node.role || 'Crew' : `${node.role || 'Crew'} · ${STATUS[node.status] || node.status || 'Queued'}`;
      record.button.dataset.state = node.status || 'queued';
      record.button.dataset.preview = String(preview);
      record.button.classList.toggle('selected', !preview && selectedNode === node.id);
      record.button.setAttribute('aria-pressed', String(!preview && selectedNode === node.id));
      record.button.setAttribute('aria-label', preview
        ? `${node.name}. Visual rehearsal cursor; no agent is running.`
        : `${node.name || 'Crew member'}, ${node.role || 'crew'}, ${STATUS[node.status] || node.status || 'queued'}. Inspect assignment and result.`);
    });
    stage.dataset.fieldMode = preview ? 'rehearsal' : 'run';
    stage.dataset.runState = status;
    if (geometryStateChanged) measure();
    const signature = `${width}:${height}:${dockTop}:${preview}:${data.map(node => `${node.id}/${node.parentId}/${node.depth}`).join('|')}`;
    const changedLayout = signature !== lastLayoutSignature;
    if (changedLayout) layout();
    if (staticMode() && (changedLayout || media.matches || document.hidden)) settle();
    draw(); wake();
  }

  function workPosition(record) {
    if (staticMode()) return [0, 0];
    if (preview && rehearsalStations.length) {
      // A collective drafting rehearsal: travel between distinct work stations,
      // hold briefly, then change formation. No live action is inferred here.
      const cycle = elapsed / 7600;
      const turn = Math.floor(cycle), phase = cycle - turn;
      const progress = smooth(clamp((phase - .12) / (width <= 760 ? .34 : .70), 0, 1));
      const a = rehearsalStations[(record.index + turn * 2) % rehearsalStations.length];
      const b = rehearsalStations[(record.index + (turn + 1) * 2) % rehearsalStations.length];
      return [a.x + (b.x - a.x) * progress - record.tx, a.y + (b.y - a.y) * progress - record.ty];
    }
    if (record.data.status === 'waiting' && record.rest) return [record.rest.x - record.tx, record.rest.y - record.ty];
    if (record.data.status !== 'running' || !record.route) return [0, 0];
    // These broad journeys visualize continuing reported work. They are not
    // reconstructed mouse coordinates, tool actions, or generated artifacts.
    record.workSample = sampleWorkRoute(record.route, Math.max(0, record.motionTime));
    return [record.workSample.x - record.tx, record.workSample.y - record.ty];
  }
  function pose(record) {
    record.button.style.transform = `translate3d(${record.x.toFixed(2)}px,${record.y.toFixed(2)}px,0)`;
    record.button.style.opacity = String(record.opacity);
    record.pointer.style.transform = `rotate(${record.angle.toFixed(1)}deg) scale(${record.pressed ? .9 : 1})`;
  }
  function settle() {
    for (const record of records.values()) { record.x = record.tx; record.y = record.ty; record.opacity = 1; record.angle = 0; record.trail.length = 0; record.workSample = null; pose(record); }
  }
  function draw() {
    if (!ctx || destroyed) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (preview) {
      // These lines are explicitly an illustrative drafting surface: never an
      // artifact, generated layout, live progress bar, or promised output.
      const spanX = bounds.right - bounds.left, spanY = bounds.bottom - bounds.top;
      const boxes = [
        { x: bounds.left + spanX * .05, y: bounds.top + spanY * .12, w: spanX * .76 + 48, h: spanY * .46 },
        { x: bounds.left + spanX * .42, y: bounds.top + spanY * .60, w: spanX * .55 + 42, h: spanY * .28 },
      ];
      boxes.forEach((box, index) => {
        ctx.strokeStyle = 'rgba(186,171,126,.10)'; ctx.lineWidth = .8;
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        const phase = staticMode() ? 1 : ((elapsed / 7600 + index * .37) % 1);
        const length = 2 * (box.w + box.h), distance = smooth(clamp(phase / .8, 0, 1)) * length;
        const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h], [box.x, box.y]];
        let remaining = distance;
        ctx.strokeStyle = 'rgba(193,173,116,.30)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...corners[0]);
        for (let edge = 0; edge < 4 && remaining > 0; edge++) {
          const a = corners[edge], b = corners[edge + 1];
          const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const amount = Math.min(1, remaining / segment);
          ctx.lineTo(a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount); remaining -= segment;
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(186,171,126,.16)'; ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.moveTo(box.x - 16, box.y + box.h); ctx.lineTo(box.x + box.w + 16, box.y + box.h); ctx.stroke(); ctx.setLineDash([]);
      });
    }
    for (const record of records.values()) {
      const parent = records.get(record.data.parentId);
      if (!parent) continue;
      ctx.beginPath(); ctx.lineWidth = 1;
      const emphasized = selectedNode === record.data.id || selectedNode === parent.data.id;
      ctx.strokeStyle = emphasized ? 'rgba(194,167,95,.36)' : preview ? 'rgba(178,171,147,.12)' : 'rgba(182,177,158,.13)';
      const startX = parent.x + 4, startY = parent.y + 20, endX = record.x + 4, endY = record.y - 8;
      const middle = startY + (endY - startY) * .52;
      ctx.moveTo(startX, startY); ctx.bezierCurveTo(startX, middle, endX, middle, endX, endY); ctx.stroke();
      if (record.handoffAt !== undefined && !staticMode()) {
        const progress = (elapsed - record.handoffAt) / 1800;
        if (progress < 1) {
          const t = 1 - smooth(clamp(progress, 0, 1)), s = 1 - t;
          const x = s * s * s * startX + 3 * s * s * t * startX + 3 * s * t * t * endX + t * t * t * endX;
          const y = s * s * s * startY + 3 * s * s * t * middle + 3 * s * t * t * middle + t * t * t * endY;
          ctx.fillStyle = record.color; ctx.globalAlpha = Math.sin(progress * Math.PI) * .8;
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    }
    for (const record of records.values()) {
      const chosen = record.focused || (!preview && selectedNode === record.data.id);
      const working = !preview && record.data.status === 'running';
      if (working && record.workSample && !staticMode()) {
        const sample = record.workSample;
        const zone = sample.zone == null ? null : record.route.zones[sample.zone];
        // A low-contrast drafting mark identifies this cursor's current visual
        // work area. It never contains fabricated text, output, or progress.
        if (zone && zone.width > 8 && zone.height > 8) {
          ctx.strokeStyle = record.color; ctx.globalAlpha = .23; ctx.lineWidth = .9;
          ctx.setLineDash([4, 5]); ctx.lineDashOffset = -(record.motionTime / 190) % 9;
          ctx.strokeRect(zone.x, zone.y, zone.width, zone.height); ctx.setLineDash([]); ctx.lineDashOffset = 0;
          ctx.globalAlpha = .13;
          ctx.beginPath(); ctx.moveTo(Math.max(bounds.left, zone.x - 26), zone.y); ctx.lineTo(Math.min(bounds.right, zone.x + zone.width + 26), zone.y);
          ctx.moveTo(zone.x, Math.max(bounds.top, zone.y - 22)); ctx.lineTo(zone.x, Math.min(bounds.bottom, zone.y + zone.height + 22)); ctx.stroke();
          ctx.globalAlpha = .36; ctx.fillStyle = record.color;
          for (const [x, y] of [[zone.x, zone.y], [zone.x + zone.width, zone.y], [zone.x, zone.y + zone.height], [zone.x + zone.width, zone.y + zone.height]]) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
          ctx.globalAlpha = 1;
        }
        if (sample.moving && !chosen && !record.hovered && !record.pressed) {
          ctx.globalAlpha = .12; ctx.strokeStyle = record.color; ctx.lineWidth = .8; ctx.setLineDash([2, 7]);
          ctx.beginPath(); ctx.moveTo(sample.leg.start.x, sample.leg.start.y); ctx.quadraticCurveTo(sample.leg.control.x, sample.leg.control.y, sample.target.x, sample.target.y); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
        }
      }
      if (chosen || working) {
        const boxX = record.x - 11, boxY = record.y - 12;
        const boxWidth = width <= 760 ? 147 : 180, boxHeight = 57;
        ctx.lineWidth = chosen ? 1 : .8;
        ctx.strokeStyle = chosen ? 'rgba(194,167,95,.60)' : 'rgba(183,169,129,.14)';
        if (chosen) ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
        if (chosen) {
          ctx.strokeStyle = 'rgba(194,167,95,.19)';
          ctx.beginPath(); ctx.moveTo(Math.max(16, boxX - 38), boxY); ctx.lineTo(Math.min(width - 16, boxX + boxWidth + 38), boxY);
          ctx.moveTo(boxX, Math.max(54, boxY - 30)); ctx.lineTo(boxX, Math.min(bounds.bottom + 70, boxY + boxHeight + 24)); ctx.stroke();
          ctx.fillStyle = '#bca66a';
          for (const [x, y] of [[boxX, boxY], [boxX + boxWidth, boxY], [boxX, boxY + boxHeight], [boxX + boxWidth, boxY + boxHeight]]) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
      if (!staticMode() && record.trail.length > 2) {
        ctx.strokeStyle = record.color; ctx.lineWidth = 1.2;
        for (let index = 1; index < record.trail.length; index++) {
          ctx.globalAlpha = .32 * index / record.trail.length;
          ctx.beginPath(); ctx.moveTo(record.trail[index - 1].x, record.trail[index - 1].y); ctx.lineTo(record.trail[index].x, record.trail[index].y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }
  function animate(time) {
    frame = 0;
    if (destroyed || staticMode()) { previousTime = 0; return; }
    const delta = previousTime ? Math.min(40, time - previousTime) : 16;
    previousTime = time; elapsed += delta;
    let unsettled = false;
    for (const record of records.values()) {
      const held = record.focused || record.hovered || record.pressed || (!preview && selectedNode === record.data.id);
      const travelling = motionAllowed({ preview, status: record.data.status, held });
      if (travelling) record.motionTime += delta;
      const [dx, dy] = workPosition(record);
      const desiredX = held ? record.x : clamp(record.tx + dx, bounds.left, bounds.right);
      const desiredY = held ? record.y : clamp(record.ty + dy, bounds.top, bounds.bottom);
      const oldX = record.x, oldY = record.y;
      const damping = 1 - Math.exp(-delta / 100);
      record.x += (desiredX - record.x) * damping; record.y += (desiredY - record.y) * damping;
      record.opacity = Math.min(1, record.opacity + delta / 280);
      const travel = Math.hypot(record.x - oldX, record.y - oldY);
      if (travel > .13 && elapsed - record.trailAt >= 30) {
        record.trail.push({ x: record.x + 4, y: record.y + 2, at: elapsed }); record.trailAt = elapsed;
        if (record.trail.length > 34) record.trail.shift();
      }
      while (record.trail.length && elapsed - record.trail[0].at > 1050) record.trail.shift();
      if (!held && travel > .2) {
        const heading = Math.atan2(record.y - oldY, record.x - oldX) * 180 / Math.PI + 135;
        const difference = ((heading - record.angle + 180) % 360 + 360) % 360 - 180;
        record.angle += difference * Math.min(1, delta / 170);
      } else if (!travelling && !held) record.angle *= Math.exp(-delta / 160);
      if (record.handoffAt !== undefined) { if (elapsed - record.handoffAt < 1800) unsettled = true; else record.handoffAt = undefined; }
      if (Math.hypot(desiredX - record.x, desiredY - record.y) > .2 || record.opacity < 1 || record.trail.length) unsettled = true;
      pose(record);
    }
    draw();
    if (preview || data.some(node => node.status === 'running') || unsettled) frame = requestAnimationFrame(animate);
    else previousTime = 0;
  }
  function wake() {
    if (destroyed || frame || staticMode() || !records.size) return;
    frame = requestAnimationFrame(animate);
  }
  function setPaused(value) {
    paused = Boolean(value); stage.dataset.motionPaused = String(paused);
    if (staticMode()) {
      stop();
      for (const record of records.values()) { record.trail.length = 0; record.opacity = 1; pose(record); }
      draw();
    } else wake();
  }
  function onMotionChange() { if (staticMode()) { stop(); if (media.matches) settle(); draw(); } else wake(); }
  function onVisibilityChange() {
    if (document.hidden) stop();
    else { measure(); onMotionChange(); }
  }
  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(stage);
  if (dock) resizeObserver.observe(dock);
  media.addEventListener('change', onMotionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', measure, { passive: true });
  measure(); update();

  return {
    update, setPaused,
    destroy() {
      if (destroyed) return;
      stop(); destroyed = true; resizeObserver.disconnect();
      media.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', measure);
      for (const record of records.values()) record.button.remove(); records.clear();
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    },
  };
}
