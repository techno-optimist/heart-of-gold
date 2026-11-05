import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrew, showFlight } from '../lib/crew-contract.mjs';
import { flightFieldState } from '../plugins/heart-of-gold/ui/swarm-adapter.mjs';

test('the shared field animates only reported working members and keeps one flight identity', () => {
  const planned = buildCrew({ mission: 'Synthetic presentation check only.', crewSize: 3 });
  const selected = planned.members[1].id;
  const first = flightFieldState(planned, 'same-flight', selected);
  assert(first.nodes.every(node => node.status === 'queued'));
  const { schemaVersion, view, capabilities, provenance, ...input } = planned;
  delete input.summary;
  const active = showFlight({ ...input, execution: 'guided_passes', status: 'working', members: input.members.map((member, index) => ({ ...member, status: index === 1 ? 'working' : 'planned' })) });
  const next = flightFieldState(active, 'same-flight', selected);
  assert.deepEqual(next.nodes.filter(node => node.status === 'running').map(node => node.id), [selected]);
  assert.equal(next.runId, first.runId); assert.equal(next.selectedNode, selected);
  assert.deepEqual(next.nodes.map(node => node.id), first.nodes.map(node => node.id));
  assert.equal(next.nodes[1].depth, 1);
  const complete = showFlight({ ...input, execution: 'guided_passes', status: 'complete', summary: 'Synthetic display fixture, not worker execution.', members: input.members.map(member => ({ ...member, status: 'complete', result: 'Synthetic contribution for field testing.' })) });
  const last = flightFieldState(complete, 'same-flight', selected);
  assert(last.nodes.every(node => node.status === 'completed'));
  assert.equal(last.runId, first.runId);
  assert.deepEqual(flightFieldState(null), { nodes: [], runId: null, status: 'standby', selectedNode: null });
});
