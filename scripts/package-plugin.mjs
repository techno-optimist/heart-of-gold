#!/usr/bin/env node
// Package only the portable plugin, never the website, build cache, or host data.
import { lstat, readdir, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../', import.meta.url));
const plugin = resolve(repository, 'plugins/heart-of-gold');
const allowedRoots = new Set(['plugin.json', 'mcp.json', 'skills', 'assets', 'ui']);
const textExtensions = new Set(['.json', '.md', '.yaml', '.yml', '.svg', '.mjs']);
const assetExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);
const maxBytes = 10 * 1024 * 1024;

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function safeName(name) {
  return !isAbsolute(name) && name.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part) && part !== '..');
}

function checkText(name, text) {
  // These release checks catch common accidental inclusions, not every possible secret.
  const forbidden = [
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:\/\/)/,
    /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/,
    /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{24,}/,
  ];
  requireThat(!forbidden.some(pattern => pattern.test(text)), `Release content check failed for ${name}; inspect for private paths or credentials.`);
}

async function collect() {
  const entries = new Map();
  let total = 0;
  for (const name of await readdir(plugin)) requireThat(allowedRoots.has(name), `Unexpected plugin-root entry: ${name}`);
  async function add(source, name) {
    requireThat(safeName(name), 'An unsafe archive path was found.');
    const info = await lstat(source);
    requireThat(info.isFile() && !info.isSymbolicLink(), `Only regular files may be packaged: ${name}`);
    requireThat(info.size <= 5 * 1024 * 1024, `File exceeds the release limit: ${name}`);
    const bytes = await readFile(source);
    total += bytes.length;
    requireThat(total <= maxBytes && entries.size < 100, 'Plugin exceeds the release size or file-count limit.');
    if (name === 'LICENSE' || textExtensions.has(extname(name))) checkText(name, bytes.toString('utf8'));
    entries.set(name, bytes);
  }
  async function walk(folder, prefix) {
    const folderInfo = await lstat(folder);
    requireThat(folderInfo.isDirectory() && !folderInfo.isSymbolicLink(), `Expected a real directory: ${prefix}`);
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = `${prefix}/${entry.name}`;
      requireThat(safeName(name) && !entry.isSymbolicLink(), `Unexpected or linked package entry: ${name}`);
      if (entry.isDirectory()) await walk(resolve(folder, entry.name), name);
      else {
        const extensions = prefix.startsWith('assets') ? assetExtensions : new Set(['.md', '.yaml', '.yml']);
        requireThat(extensions.has(extname(entry.name)), `Unreviewed file type in package: ${name}`);
        await add(resolve(folder, entry.name), name);
      }
    }
  }
  await add(resolve(plugin, 'plugin.json'), 'plugin.json');
  await add(resolve(plugin, 'mcp.json'), 'mcp.json');
  await add(resolve(repository, 'LICENSE'), 'LICENSE');
  await walk(resolve(plugin, 'skills'), 'skills');
  await walk(resolve(plugin, 'assets'), 'assets');
  // Two reviewed dependency-free bridge files only; never archive arbitrary
  // repository scripts, node_modules, source workspaces, or run credentials.
  await add(resolve(repository, 'scripts/watch-project.mjs'), 'skills/deploy-drive/scripts/watch-project.mjs');
  await add(resolve(repository, 'lib/project-watcher.mjs'), 'skills/deploy-drive/lib/project-watcher.mjs');

  const manifest = JSON.parse(entries.get('plugin.json').toString('utf8'));
  const mcp = JSON.parse(entries.get('mcp.json').toString('utf8'));
  requireThat(manifest.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json' && manifest.name === 'heart-of-gold', 'Unexpected portable plugin identity.');
  requireThat(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Expected a release version.');
  requireThat(mcp.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'Unexpected MCP schema.');
  requireThat(Object.keys(mcp).sort().join(',') === '$schema,mcpServers', 'Unexpected MCP configuration fields.');
  requireThat(Object.keys(mcp.mcpServers).join(',') === 'heart-of-gold', 'Expected exactly the Heart of Gold MCP server.');
  const server = mcp.mcpServers['heart-of-gold'];
  requireThat(Object.keys(server).sort().join(',') === 'type,url' && server.type === 'streamable-http' && server.url === 'https://projectforty2.ai/heartofgold/mcp', 'Expected the public no-auth MCP connection without credential headers.');
  const openai = manifest.extensions?.['com.openai'];
  requireThat(openai && !openai.hooks && !openai.apps && !manifest.hooks && !manifest.apps, 'Unexpected plugin hooks or registered app references.');
  const listing = openai.interface;
  requireThat(listing?.displayName?.length <= 30 && listing.shortDescription?.length <= 30 && listing.longDescription?.length <= 4000, 'Invalid listing text limits.');
  const paths = [listing.logo, listing.composerIcon, listing.logoDark, listing.composerIconDark, ...(listing.screenshots || []), openai.onboardingSkill].filter(Boolean);
  for (const path of paths) requireThat(path.startsWith('./') && entries.has(path.slice(2)), `Referenced file is absent from the package: ${path}`);
  requireThat(entries.has('skills/deploy-drive/SKILL.md') && entries.has('skills/deploy-drive/references/flight-contract.md'), 'The complete deploy-drive skill is required.');
  requireThat(openai.review?.test_cases?.positive?.length === 5 && openai.review?.test_cases?.negative?.length === 3, 'Expected five positive and three negative review cases.');
  return { entries: [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), version: manifest.version };
}

// Python's standard-library ZIP writer gives a portable archive without adding a
// project dependency. Stored entries, sorted paths, fixed dates and permissions
// make identical inputs produce identical bytes across runs and time zones.
const writer = String.raw`
import base64, json, os, pathlib, sys, tempfile, zipfile
payload = json.load(sys.stdin)
destination = pathlib.Path(sys.argv[1])
entries = [(item['name'], base64.b64decode(item['data'], validate=True)) for item in payload]
fd, temp = tempfile.mkstemp(prefix='.heart-of-gold-', suffix='.zip', dir=destination.parent)
os.close(fd)
try:
    with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100644 << 16)
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    with zipfile.ZipFile(temp) as archive:
        if archive.namelist() != [name for name, _ in entries] or archive.testzip() is not None:
            raise RuntimeError('Archive integrity check failed')
        for name, data in entries:
            if archive.read(name) != data:
                raise RuntimeError('Archive content check failed')
    os.replace(temp, destination)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
`;

async function main() {
  requireThat(process.argv.length === 3 && process.argv[2].toLowerCase().endsWith('.zip'), 'Usage: node scripts/package-plugin.mjs <destination.zip>');
  const destination = resolve(process.argv[2]);
  const fromPlugin = relative(plugin, destination);
  requireThat(fromPlugin.startsWith(`..${sep}`) || isAbsolute(fromPlugin), 'Write the release ZIP outside the source plugin folder.');
  try {
    const info = await lstat(destination);
    requireThat(info.isFile() && !info.isSymbolicLink(), 'The destination must be a regular file or a new path.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { entries, version } = await collect();
  await mkdir(dirname(destination), { recursive: true });
  const result = spawnSync('python3', ['-c', writer, destination], {
    input: JSON.stringify(entries.map(([name, data]) => ({ name, data: data.toString('base64') }))),
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  requireThat(!result.error && result.status === 0, 'ZIP creation failed. Python 3 with its standard zipfile module is required.');
  const bytes = await readFile(destination);
  console.log(JSON.stringify({ name: 'heart-of-gold', version, files: entries.map(([name]) => name), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
