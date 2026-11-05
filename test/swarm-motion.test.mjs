import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkRoute, sampleWorkRoute, motionAllowed, observedCompletion, mobileCrewSlots } from '../public/swarm-motion.mjs';

test('working trajectories cover substantial desktop and phone distance within safe bounds', () => {
  for (const [bounds, minimumTravel] of [
    [{ left: 52, right: 1050, top: 145, bottom: 460 }, 550],
    [{ left: 24, right: 224, top: 190, bottom: 407 }, 110],
  ]) {
    for (let index = 0; index < 7; index++) {
      const route = createWorkRoute({ bounds, home: { x: bounds.left + (bounds.right - bounds.left) * index / 6, y: bounds.top + (bounds.bottom - bounds.top) * .5 }, seed: index / 7, index });
      const samples = Array.from({ length: 501 }, (_, step) => sampleWorkRoute(route, route.duration * step / 500));
      for (const sample of samples) {
        assert.ok(sample.x >= bounds.left - 1e-8 && sample.x <= bounds.right + 1e-8);
        assert.ok(sample.y >= bounds.top - 1e-8 && sample.y <= bounds.bottom + 1e-8);
      }
      const range = Math.max(...samples.map(point => point.x)) - Math.min(...samples.map(point => point.x));
      assert.ok(range > minimumTravel, `cursor ${index}: ${range}px must exceed ${minimumTravel}px`);
      assert.ok(samples.some(point => !point.moving), 'each route includes a work-area dwell');
      assert.ok(route.legs.some(leg => Math.abs(leg.control.y - (leg.start.y + leg.target.y) / 2) > 1), 'travel has a curved path');
      for (const zone of route.zones) {
        assert.ok(zone.x >= bounds.left && zone.y >= bounds.top);
        assert.ok(zone.x + zone.width <= bounds.right + 1e-8 && zone.y + zone.height <= bounds.bottom + 1e-8);
      }
    }
  }
});

test('compressed layouts stay finite and route loops remain continuous', () => {
  for (const bounds of [{ left: 24, right: 24, top: 80, bottom: 80 }, { left: 24, right: 64, top: 80, bottom: 81 }]) {
    const route = createWorkRoute({ bounds, home: { x: -500, y: 2000 }, seed: .42 });
    for (const time of [-1, 0, 10, route.duration - .001, route.duration, route.duration + .001]) {
      const sample = sampleWorkRoute(route, time);
      assert.ok(Number.isFinite(sample.x) && Number.isFinite(sample.y));
      assert.ok(sample.x >= bounds.left && sample.x <= bounds.right);
      assert.ok(sample.y >= bounds.top && sample.y <= bounds.bottom);
    }
    const before = sampleWorkRoute(route, route.duration - .001), after = sampleWorkRoute(route, .001);
    assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .01);
  }
});

test('only reported running work or explicit rehearsal travels, with accessible holds', () => {
  assert.equal(motionAllowed({ status: 'running' }), true);
  assert.equal(motionAllowed({ preview: true }), true);
  for (const status of ['queued', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted', undefined]) assert.equal(motionAllowed({ status }), false);
  for (const reason of ['held', 'paused', 'hidden', 'reducedMotion']) {
    assert.equal(motionAllowed({ status: 'running', [reason]: true }), false);
    assert.equal(motionAllowed({ preview: true, [reason]: true }), false);
  }
});

test('completion accents require an observed transition, not replayed snapshots', () => {
  assert.equal(observedCompletion(undefined, 'completed'), false);
  assert.equal(observedCompletion('completed', 'completed'), false);
  assert.equal(observedCompletion('running', 'running'), false);
  assert.equal(observedCompletion('running', 'completed'), true);
  assert.equal(observedCompletion('waiting', 'completed'), true);
});

test('flat seven-member crews receive distinct phone slots, with nested branches kept together', () => {
  const nodes = [{ id: 'lead', parentId: null }, ...Array.from({ length: 6 }, (_, index) => ({ id: `child-${index}`, parentId: 'lead' }))];
  const flat = mobileCrewSlots(nodes);
  assert.equal(flat.rows, 3);
  assert.equal(new Set([...flat.slots.values()].map(slot => `${slot.lane}:${slot.row}`)).size, 7);
  const nested = mobileCrewSlots([{ id: 'lead', parentId: null }, { id: 'branch', parentId: 'lead' }, { id: 'other', parentId: 'lead' }, { id: 'specialist', parentId: 'branch' }]);
  assert.equal(nested.slots.get('branch').lane, nested.slots.get('specialist').lane);
  assert.ok(nested.slots.get('specialist').row > nested.slots.get('branch').row);
});
