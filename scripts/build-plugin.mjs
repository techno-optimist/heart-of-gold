import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ui = new URL('../plugins/heart-of-gold/ui/', import.meta.url);
const fontRoot = new URL('../public/fonts/', import.meta.url);
const fonts = [
  ['Cormorant Garamond', 'CormorantGaramond-Latin.woff2', '300 700', 'normal'],
  ['Cormorant Garamond', 'CormorantGaramond-Italic-Latin.woff2', '300 700', 'italic'],
  ['DM Sans', 'DMSans-Latin.woff2', '100 1000', 'normal'],
  ['JetBrains Mono', 'JetBrainsMono-Latin.woff2', '100 800', 'normal'],
];
// Match the website's type without adding a font CDN or network permission to
// the embedded app. Font licenses travel with the self-contained resource.
const embeddedFonts = await Promise.all(fonts.map(async ([family, file, weight, style]) => {
  const data = await readFile(new URL(file, fontRoot));
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');font-weight:${weight};font-style:${style};font-display:swap}`;
}));
const fontLicenses = await Promise.all(['cormorantgaramond-OFL.txt', 'dmsans-OFL.txt', 'jetbrainsmono-OFL.txt'].map(async file => `/* ${file}\n${(await readFile(new URL(file, fontRoot), 'utf8')).replaceAll('*/', '* /')}\n*/`));
const [template, css, websiteCss, compiled] = await Promise.all([
  readFile(new URL('index.html', ui), 'utf8'),
  readFile(new URL('style.css', ui), 'utf8'),
  readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
  build({ entryPoints: [fileURLToPath(new URL('app.js', ui))], bundle: true, minify: true, format: 'iife', platform: 'browser', target: ['es2022'], write: false, legalComments: 'inline' }),
]);
for (const placeholder of ['<!-- HOG_STYLES -->', '<!-- HOG_SCRIPT -->']) {
  if (!template.includes(placeholder)) throw new Error(`Missing UI build slot: ${placeholder}`);
}
const script = compiled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const sharedStyles = websiteCss.replace(/@font-face\s*\{[^}]*\}/g, '');
// Replacer functions preserve literal $&, $' and $` sequences in bundled code.
const html = template.replace('<!-- HOG_STYLES -->', () => `<style>${fontLicenses.join('\n')}\n${embeddedFonts.join('\n')}\n${sharedStyles}\n${css}</style>`).replace('<!-- HOG_SCRIPT -->', () => `<script>${script}</script>`);
if (Buffer.byteLength(html) > 1500000) throw new Error('Plugin UI exceeds its 1.5 MB delivery budget.');
await mkdir(new URL('dist/', ui), { recursive: true });
await writeFile(new URL('dist/flight-deck.html', ui), html);
console.log(`Heart of Gold plugin UI built (${Buffer.byteLength(html)} bytes).`);
