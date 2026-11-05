import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineFrameHeight } from '../plugins/heart-of-gold/ui/frame-size.mjs';

test('inline budget defaults to 420 independently of viewport-like fields', () => {
  for (const context of [undefined, null, {}, { containerDimensions: {} }, { containerDimensions: { width: 360 } }, { innerHeight: 1000, scrollHeight: 5000 }]) {
    assert.equal(inlineFrameHeight(context), 420);
  }
});

test('host maximum and fixed heights cap the total without an overflowing floor', () => {
  for (const field of ['maxHeight', 'height']) {
    for (const height of [0.5, 180, 320, 419.25, 420, 600, 1000]) {
      assert.equal(inlineFrameHeight({ containerDimensions: { [field]: height } }), Math.min(420, height));
    }
  }
  // Defensive handling if a host sends both despite the SDK either/or contract.
  assert.equal(inlineFrameHeight({ containerDimensions: { height: 350, maxHeight: 320 } }), 320);
});

test('invalid bounds are ignored without coercion or masking a valid other bound', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, 0, -1, '320', true, {}]) {
    assert.equal(inlineFrameHeight({ containerDimensions: { maxHeight: invalid } }), 420);
    assert.equal(inlineFrameHeight({ containerDimensions: { height: invalid, maxHeight: 300 } }), 300);
  }
});

test('safe-area padding remains inside the host budget', () => {
  const safeAreaInsets = { top: 44, bottom: 34, left: 20, right: 20 };
  assert.equal(inlineFrameHeight({ safeAreaInsets }), 420);
  assert.equal(inlineFrameHeight({ safeAreaInsets, containerDimensions: { maxHeight: 320 } }), 320);
  assert.equal(inlineFrameHeight({ safeAreaInsets: { top: 500, bottom: 500 }, containerDimensions: { height: 200 } }), 200);
});

test('merged partial context preserves bounds and replacement dimensions clear them', () => {
  let context = { displayMode: 'inline', containerDimensions: { width: 650, maxHeight: 320 } };
  context = { ...context, theme: 'dark' };
  context = { ...context, safeAreaInsets: { top: 12, bottom: 20, left: 0, right: 0 } };
  assert.equal(inlineFrameHeight(context), 320);
  context = { ...context, containerDimensions: { width: 360, height: 280 } };
  assert.equal(inlineFrameHeight(context), 280);
  context = { ...context, containerDimensions: { width: 360 } };
  assert.equal(inlineFrameHeight(context), 420);
});

test('host echoes of a requested height converge without viewport feedback', () => {
  for (const initial of [{}, { maxHeight: 320 }, { height: 600 }]) {
    const expected = inlineFrameHeight({ containerDimensions: initial });
    let dimensions = initial;
    for (let cycle = 0; cycle < 20; cycle++) {
      const requested = inlineFrameHeight({ containerDimensions: dimensions });
      assert.equal(requested, expected);
      dimensions = { height: requested };
    }
  }
});
