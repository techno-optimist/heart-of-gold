const NODE_STATUS = { planned: 'queued', working: 'running', waiting: 'waiting', complete: 'completed', cancelled: 'cancelled', failed: 'failed' };
const FLIGHT_STATUS = { planned: 'queued', working: 'running', complete: 'completed', partial: 'partial' };

/** Presentation mapping only. The supplied snapshot remains the source of truth. */
export function flightFieldState(snapshot, flightId, selectedId) {
  if (!snapshot) return { nodes: [], runId: null, status: 'standby', selectedNode: null };
  const byId = new Map(snapshot.members.map(member => [member.id, member]));
  const nodes = snapshot.members.map(member => {
    let depth = 0, cursor = member;
    const seen = new Set([member.id]);
    while (cursor.parentId != null && byId.has(cursor.parentId) && !seen.has(cursor.parentId)) {
      seen.add(cursor.parentId); cursor = byId.get(cursor.parentId); depth++;
    }
    return { ...member, depth, status: NODE_STATUS[member.status] || 'queued',
      children: snapshot.members.filter(child => child.parentId === member.id).map(child => child.id) };
  });
  return { nodes, runId: flightId || 'legacy-flight-snapshot', status: FLIGHT_STATUS[snapshot.status] || 'queued', selectedNode: selectedId || null };
}
