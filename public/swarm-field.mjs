/**
 * An original, event-led cursor field for Heart of Gold.
 * Movement is presence choreography, never a claim that a tool is clicking,
 * drawing, browsing, or producing output. Runtime nodes are the only live crew.
 */
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
    // An expanding notice/dock should not cover a cursor while it eases upward.
    for (const record of records.values()) {
      if (record.y > bounds.bottom) { record.y = bounds.bottom; record.trail.length = 0; pose(record); }
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
      const root = data.find(node => !node.parentId || !records.has(node.parentId));
      const firstLevel = root ? data.filter(node => node.parentId === root.id) : [];
      const laneOf = node => {
        const visited = new Set(); let cursor = node;
        while (cursor && !visited.has(cursor.id)) {
          visited.add(cursor.id);
          const index = firstLevel.findIndex(parent => parent.id === cursor.id);
          if (index >= 0) return index % 2;
          cursor = records.get(cursor.parentId)?.data;
        }
        return 0;
      };
      const firstRows = new Map();
      const lastRow = Math.max(3, ...firstLevel.map(parent => 1 + data.filter(node => node.parentId === parent.id).length));
      ordered.forEach(record => {
        const node = record.data;
        const isRoot = !node.parentId || !records.has(node.parentId);
        let row = 0;
        if (!isRoot) {
          if (firstLevel.some(parent => parent.id === node.id)) row = 1;
          else {
            const lane = laneOf(node);
            const next = (firstRows.get(lane) || 1) + 1; firstRows.set(lane, next); row = next;
          }
        }
        record.tx = isRoot ? bounds.left + spanX * .48 : bounds.left + spanX * (laneOf(node) ? .94 : .08);
        if (row > 1 && !preview) record.tx += laneOf(node) ? -10 : 10;
        record.ty = bounds.top + spanY * Math.min(row / lastRow, 1);
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
    const record = { data: node, button, name, role, color: PALETTE[index % PALETTE.length], x: width / 2, y: height / 2, tx: 0, ty: 0, opacity: 0, fresh: true, trail: [], seed: seed(node.id) };
    button.style.setProperty('--agent-color', record.color);
    button.addEventListener('click', () => { if (!destroyed) onSelect(preview ? null : record.data.id); });
    button.addEventListener('focus', () => { record.focused = true; draw(); });
    button.addEventListener('blur', () => { record.focused = false; draw(); wake(); });
    button.addEventListener('pointerenter', () => { record.hovered = true; });
    button.addEventListener('pointerleave', () => { record.hovered = false; wake(); });
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
      if (!record) { record = makeRecord(node, index); records.set(node.id, record); }
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

  function microPosition(record) {
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
    if (record.data.status !== 'running') return [0, 0];
    // Real work gets only a small presence gesture. It does not trace tool use.
    const points = [[0, 0], [15, -7], [29, -7], [29, 9], [9, 9], [9, 0], [0, 0], [0, 0]];
    const period = 5200 + record.seed * 1600;
    const cycle = ((elapsed / period + record.seed) % 1) * (points.length - 1);
    const index = Math.floor(cycle), blend = smooth(cycle - index);
    const a = points[index], b = points[index + 1];
    return [(a[0] + (b[0] - a[0]) * blend) * .65, (a[1] + (b[1] - a[1]) * blend) * .65];
  }
  function pose(record) {
    record.button.style.transform = `translate3d(${record.x.toFixed(2)}px,${record.y.toFixed(2)}px,0)`;
    record.button.style.opacity = String(record.opacity);
  }
  function settle() {
    for (const record of records.values()) { record.x = record.tx; record.y = record.ty; record.opacity = 1; record.trail.length = 0; pose(record); }
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
      ctx.strokeStyle = record.data.status === 'completed' ? 'rgba(174,153,100,.30)' : preview ? 'rgba(178,171,147,.16)' : 'rgba(182,177,158,.27)';
      const startX = parent.x + 4, startY = parent.y + 20, endX = record.x + 4, endY = record.y - 8;
      const middle = startY + (endY - startY) * .52;
      ctx.moveTo(startX, startY); ctx.bezierCurveTo(startX, middle, endX, middle, endX, endY); ctx.stroke();
    }
    for (const record of records.values()) {
      const chosen = record.focused || (!preview && selectedNode === record.data.id);
      const working = !preview && record.data.status === 'running';
      if (chosen || working) {
        const boxX = (preview ? record.x : record.tx) - 11, boxY = (preview ? record.y : record.ty) - 12;
        const boxWidth = width <= 760 ? 147 : 180, boxHeight = 57;
        ctx.lineWidth = chosen ? 1 : .8;
        ctx.strokeStyle = chosen ? 'rgba(194,167,95,.60)' : 'rgba(183,169,129,.25)';
        ctx.setLineDash(chosen ? [] : [3, 5]); ctx.strokeRect(boxX, boxY, boxWidth, boxHeight); ctx.setLineDash([]);
        if (chosen) {
          ctx.strokeStyle = 'rgba(194,167,95,.19)';
          ctx.beginPath(); ctx.moveTo(Math.max(16, boxX - 38), boxY); ctx.lineTo(Math.min(width - 16, boxX + boxWidth + 38), boxY);
          ctx.moveTo(boxX, Math.max(54, boxY - 30)); ctx.lineTo(boxX, Math.min(bounds.bottom + 70, boxY + boxHeight + 24)); ctx.stroke();
          ctx.fillStyle = '#bca66a';
          for (const [x, y] of [[boxX, boxY], [boxX + boxWidth, boxY], [boxX, boxY + boxHeight], [boxX + boxWidth, boxY + boxHeight]]) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
      if (!staticMode() && record.trail.length > 2) {
        ctx.strokeStyle = record.color; ctx.lineWidth = 1; ctx.globalAlpha = .14;
        ctx.beginPath(); record.trail.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke(); ctx.globalAlpha = 1;
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
      const [dx, dy] = microPosition(record);
      const held = preview && (record.focused || record.hovered);
      const desiredX = held ? record.x : clamp(record.tx + dx, bounds.left, bounds.right);
      const desiredY = held ? record.y : clamp(record.ty + dy, bounds.top, bounds.bottom);
      const oldX = record.x, oldY = record.y;
      const damping = 1 - Math.exp(-delta / 155);
      record.x += (desiredX - record.x) * damping; record.y += (desiredY - record.y) * damping;
      record.opacity = Math.min(1, record.opacity + delta / 280);
      const travel = Math.hypot(record.x - oldX, record.y - oldY);
      if (travel > .13) {
        record.trail.push({ x: record.x + 4, y: record.y + 2 });
        if (record.trail.length > 9) record.trail.shift();
      } else if (record.trail.length) record.trail.shift();
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
