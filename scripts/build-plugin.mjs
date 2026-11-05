import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ui = new URL('../plugins/heart-of-gold/ui/', import.meta.url);
const [template, css, compiled] = await Promise.all([
  readFile(new URL('index.html', ui), 'utf8'),
  readFile(new URL('style.css', ui), 'utf8'),
  build({ entryPoints: [fileURLToPath(new URL('app.js', ui))], bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2022'], write: false, legalComments: 'inline' }),
]);
for (const placeholder of ['<!-- HOG_STYLES -->', '<!-- HOG_SCRIPT -->']) {
  if (!template.includes(placeholder)) throw new Error(`Missing UI build slot: ${placeholder}`);
}
const script = compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Replacer functions preserve literal $&, $' and $` sequences in bundled code.
const html = template.replace('<!-- HOG_STYLES -->', () => `<style>${css}</style>`).replace('<!-- HOG_SCRIPT -->', () => `<script>${script}</script>`);
if (Buffer.byteLength(html) > 1500000) throw new Error('Plugin UI exceeds its 1.5 MB delivery budget.');
await mkdir(new URL('dist/', ui), { recursive: true });
await writeFile(new URL('dist/flight-deck.html', ui), html);
console.log(`Heart of Gold plugin UI built (${Buffer.byteLength(html)} bytes).`);
