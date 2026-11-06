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

/** Presentation intent only: source-backed construction starts when a project arrives. */
export function awaitingProjectSource(snapshot) {
  if (!snapshot || snapshot.status !== 'working' || snapshot.project) return false;
  const mission = typeof snapshot.mission === 'string' ? snapshot.mission : '';
  const deliverable = typeof snapshot.deliverable === 'string' ? snapshot.deliverable : '';
  const appBuild = /\b(?:build|create|implement|develop|code|make|ship)\b[^.!?\n]{0,160}\b(?:app(?:lication)?|web\s*app|website|web\s*page|landing\s*page|frontend|front-end|user interface|ui|dashboard|component|prototype)\b/i;
  const discussion = /^\s*(?:research|investigate|explain|compare|analy[sz]e|evaluate|assess|discuss|plan|review|explore|recommend|summari[sz]e|debate|outline)\b/i;
  const concreteApp = /\b(?:runnable|working|functional|interactive)\b[^.!?\n]{0,80}\b(?:app(?:lication)?|website|web\s*page|dashboard|prototype)\b/i;
  if ((!discussion.test(mission) && appBuild.test(mission)) || (!discussion.test(deliverable) && (appBuild.test(deliverable) || concreteApp.test(deliverable)))) return true;
  return (Array.isArray(snapshot.members) ? snapshot.members : []).some(member => {
    const assignment = `${member.task || ''} ${member.output || ''}`;
    return !discussion.test(assignment) && /\b(?:implement|write|create|build|modify)\b[^.!?\n]{0,160}(?:\b[\w/-]+\.(?:html|css|js|jsx|ts|tsx)\b|\b(?:html|css|javascript)\s+(?:files?|source|code)\b)/i.test(assignment);
  });
}
