/** Bounded presentation paths. These coordinates never describe tool actions. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => value * value * (3 - 2 * value);

export function motionAllowed({ preview = false, status, held = false, paused = false, hidden = false, reducedMotion = false }) {
  return !held && !paused && !hidden && !reducedMotion && (preview || status === 'running');
}

export function createWorkRoute({ bounds, home, seed = 0, index = 0 }) {
  const { left, right, top, bottom } = bounds;
  const spanX = Math.max(0, right - left), spanY = Math.max(0, bottom - top);
  const point = (x, y) => ({ x: clamp(x, left, right), y: clamp(y, top, bottom) });
  const origin = point(home.x, home.y);
  const fromLeft = origin.x < left + spanX * .5;
  const fromTop = origin.y < top + spanY * .5;
  // Opposite stations retain broad horizontal journeys while identity-based
  // vertical bands prevent the whole crew arriving at two shared destinations.
  const vertical = (seed * .31 + index * .61803398875) % 1;
  const horizontal = (seed * .73 + index * .38196601125) % 1;
  const lowX = .05 + horizontal * .2, highX = lowX + .7;
  const a = point(left + spanX * (fromLeft ? highX : lowX), top + spanY * (.08 + vertical * .84));
  const b = point(left + spanX * (fromLeft ? lowX : highX), top + spanY * (.08 + ((vertical + .47) % 1) * .84));
  const boxWidth = Math.min(132, spanX * .37), boxHeight = Math.min(66, spanY * .31);
  const zone = target => ({ x: clamp(target.x - boxWidth * .45, left, Math.max(left, right - boxWidth)), y: clamp(target.y - boxHeight * .45, top, Math.max(top, bottom - boxHeight)), width: boxWidth, height: boxHeight });
  const zones = [zone(a), zone(b)];
  const points = [origin, a, point(a.x + (fromLeft ? -1 : 1) * boxWidth * .67, a.y + (fromTop ? -1 : 1) * boxHeight * .62), b, point(b.x + (fromLeft ? 1 : -1) * boxWidth * .62, b.y + (fromTop ? 1 : -1) * boxHeight * .57), origin];
  const legs = points.slice(1).map((target, i) => {
    const start = points[i];
    const distance = Math.hypot(target.x - start.x, target.y - start.y);
    const bend = Math.min(80, spanY * .24, distance * .22) * (i % 2 ? -1 : 1);
    const control = point((start.x + target.x) / 2 - (target.y - start.y) / Math.max(1, distance) * bend, (start.y + target.y) / 2 + (target.x - start.x) / Math.max(1, distance) * bend);
    return { start, target, control, duration: clamp(distance / (.12 + seed * .045), 700, 2900), dwell: 260 + seed * 220, zone: i < 2 ? 0 : i < 4 ? 1 : null };
  });
  return { bounds: { left, right, top, bottom }, points, zones, legs, duration: legs.reduce((sum, leg) => sum + leg.duration + leg.dwell, 0) };
}

export function sampleWorkRoute(route, time) {
  let remaining = ((time % route.duration) + route.duration) % route.duration;
  for (let index = 0; index < route.legs.length; index++) {
    const leg = route.legs[index], span = leg.duration + leg.dwell;
    if (remaining <= span || index === route.legs.length - 1) {
      const amount = ease(clamp(remaining / leg.duration, 0, 1));
      const inverse = 1 - amount;
      return { x: clamp(inverse * inverse * leg.start.x + 2 * inverse * amount * leg.control.x + amount * amount * leg.target.x, route.bounds.left, route.bounds.right), y: clamp(inverse * inverse * leg.start.y + 2 * inverse * amount * leg.control.y + amount * amount * leg.target.y, route.bounds.top, route.bounds.bottom), target: leg.target, leg, zone: leg.zone, moving: remaining < leg.duration };
    }
    remaining -= span;
  }
}

export function observedCompletion(previousStatus, nextStatus) {
  return previousStatus !== undefined && previousStatus !== 'completed' && nextStatus === 'completed';
}

export function mobileCrewSlots(nodes) {
  const ids = new Set(nodes.map(node => node.id));
  const root = nodes.find(node => !node.parentId || !ids.has(node.parentId));
  const slots = new Map(), lanes = [[], []];
  if (root) slots.set(root.id, { lane: .5, row: 0 });
  function place(node, lane) {
    if (slots.has(node.id)) return;
    lanes[lane].push(node.id); slots.set(node.id, { lane, row: lanes[lane].length });
    for (const child of nodes.filter(candidate => candidate.parentId === node.id)) place(child, lane);
  }
  if (root) nodes.filter(node => node.parentId === root.id).forEach((node, index) => place(node, index % 2));
  for (const node of nodes) if (!slots.has(node.id)) place(node, lanes[0].length <= lanes[1].length ? 0 : 1);
  return { slots, rows: Math.max(3, lanes[0].length, lanes[1].length) };
}
