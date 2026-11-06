import test from 'node:test';
import assert from 'node:assert/strict';
import { createComponentCanvas } from '../plugins/heart-of-gold/ui/component-canvas.mjs';

// Exercise the production canvas against DOM/WAAPI ports. No authored project
// code executes here; the assertions inspect the actual generated trace path.
function fixture(t) {
  const animations = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.attributes = {}; this.listeners = [];
      this.dataset = {}; this.children = []; this.className = ''; this.hidden = false;
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
        toggle: (name, value) => value ? this.classList.add(name) : this.classList.remove(name),
        contains: name => this.className.split(' ').includes(name),
      };
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name) { this.listeners.push(name); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    animate(keyframes, options) {
      const animation = { keyframes, options, cancelled: false, finished: new Promise(() => {}), cancel() { this.cancelled = true; } };
      animations.push(animation); return animation;
    }
  }
  const reduced = { matches: false, addEventListener() {}, removeEventListener() {} };
  const globals = {
    document: { hidden: false, createElement: tag => new Element(tag), createElementNS: (namespace, tag) => new Element(tag) },
    matchMedia: () => reduced,
    getComputedStyle: element => ({ transform: element.style.transform || 'none' }),
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  let now = 0, timer = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', () => ++timer);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const layer = new Element();
  const canvas = createComponentCanvas({ layer, onInspectMember() {}, onSource() {} });
  t.after(() => canvas.destroy());
  return {
    canvas, animations, setTime: value => { now = value; },
    region: () => layer.children.find(child => child.dataset.componentId === 'entry'),
    cursor: () => layer.children.find(child => child.dataset.memberId === 'ford'),
  };
}
const components = [{ id: 'entry', label: 'Entry form', memberId: 'ford', filePaths: ['index.html'] }];
const members = [{ id: 'ford', name: 'Ford', status: 'working' }];
const event = seq => ({ seq, componentId: 'entry', memberId: 'ford', kind: 'component.updated' });
const geometry = (x, y) => ({ rects: [{ id: 'entry', x, y, width: 120, height: 70 }], missing: [] });
const WIDTH = 640, HEIGHT = 330;

test('source-frame handoff traces the new same-ID component bounds, never the previous frame', t => {
  const { canvas, animations, region } = fixture(t);
  canvas.replaceFrame(components, members, geometry(10, 20), WIDTH, HEIGHT, [event(1)]);
  const prior = animations[0];
  canvas.replaceFrame(components, members, geometry(260, 130), WIDTH, HEIGHT, [event(2)]);
  assert.equal(prior.cancelled, true, 'a previous-frame trace cannot continue across replacement');
  assert.equal(animations.length, 2);
  assert.deepEqual(animations[1].keyframes.slice(1, 5).map(frame => frame.transform), [
    'translate3d(260px,130px,0)', 'translate3d(376px,130px,0)',
    'translate3d(376px,196px,0)', 'translate3d(260px,196px,0)',
  ]);
  assert.equal(region().style.left, '260px');
  assert.equal(region().style.top, '130px');
});

test('a ready frame without geometry clears old anchors and waits for its own bounded geometry', t => {
  const { canvas, animations, region, cursor, setTime } = fixture(t);
  canvas.replaceFrame(components, members, geometry(10, 20), WIDTH, HEIGHT);
  canvas.replaceFrame(components, members, null, WIDTH, HEIGHT, [event(2)]);
  assert.equal(animations.length, 0);
  assert.equal(region().hidden, true);
  assert.equal(cursor().hidden, true);
  setTime(1500);
  canvas.geometry(geometry(260, 130), WIDTH, HEIGHT);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].keyframes[1].transform, 'translate3d(260px,130px,0)');
});

test('geometry arriving after the receipt deadline settles without a stale or delayed trace', t => {
  const { canvas, animations, region, setTime } = fixture(t);
  canvas.replaceFrame(components, members, geometry(10, 20), WIDTH, HEIGHT);
  canvas.replaceFrame(components, members, null, WIDTH, HEIGHT, [event(2)]);
  setTime(2201);
  canvas.geometry(geometry(260, 130), WIDTH, HEIGHT);
  assert.equal(region().hidden, false);
  assert.equal(region().style.left, '260px');
  assert.equal(animations.length, 0);
  assert.equal(region().classList.contains('is-arriving'), false);
});

test('superseded pending receipts and metadata refreshes do not replay component arrivals', t => {
  const { canvas, animations } = fixture(t);
  canvas.replaceFrame(components, members, null, WIDTH, HEIGHT, [event(2)]);
  canvas.replaceFrame(components, members, geometry(260, 130), WIDTH, HEIGHT);
  canvas.update(components, [{ ...members[0], status: 'complete' }]);
  canvas.geometry(geometry(270, 140), WIDTH, HEIGHT);
  assert.equal(animations.length, 0);
});

test('paused source-frame handoffs update geometry without starting or deferring motion', t => {
  const { canvas, animations, region } = fixture(t);
  canvas.setPaused(true);
  canvas.replaceFrame(components, members, geometry(260, 130), WIDTH, HEIGHT, [event(2)]);
  assert.equal(region().style.left, '260px');
  canvas.setPaused(false);
  canvas.geometry(geometry(260, 130), WIDTH, HEIGHT);
  assert.equal(animations.length, 0);
});

test('component annotations are passive and a finished worker clears its own overlay immediately', t => {
  const { canvas, animations, cursor, region } = fixture(t);
  canvas.replaceFrame(components, members, geometry(10,20), WIDTH, HEIGHT, [event(1)]);
  assert.equal(cursor().tagName, 'div');
  assert.equal(cursor().attributes['aria-hidden'], 'true');
  assert.equal(cursor().attributes.tabindex, undefined);
  assert.deepEqual(cursor().listeners, []);
  canvas.update(components, [{...members[0],status:'complete'}]);
  assert.equal(cursor(), undefined); assert.equal(region(), undefined); assert.equal(animations[0].cancelled, true);
  canvas.update(components, members);
  assert.ok(cursor()); assert.equal(animations.length, 1, 'resumed status alone cannot replay old source work');
  canvas.update(components, members, [event(2)]);
  assert.equal(animations.length, 2, 'new accepted work still receives its accent');
});
