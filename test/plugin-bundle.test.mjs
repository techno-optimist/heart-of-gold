import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

test('published UI bundle contains parseable inline code and no unfilled slots', async () => {
  const html = await readFile(new URL('../plugins/heart-of-gold/ui/dist/flight-deck.html', import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(html) < 1500000);
  assert.ok(!html.includes('<!-- HOG_'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Script(scripts[0][1]));
  assert.doesNotMatch(html, /<script\s+src=/);
  assert.equal((html.match(/data:font\/woff2;base64,/g) || []).length, 4);
  for (const font of ['Cormorant Garamond', 'DM Sans', 'JetBrains Mono']) assert.ok(html.includes(`font-family:'${font}'`));
  assert.ok(html.includes('SIL OPEN FONT LICENSE'));
  assert.doesNotMatch(html, /url\(['"]?(?:https?:|\.\/fonts\/)/);
});
