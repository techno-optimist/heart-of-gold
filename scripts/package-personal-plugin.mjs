#!/usr/bin/env node
// A private registered-app preview. The public package and its version stay intact.
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repository = fileURLToPath(new URL('../', import.meta.url));
const outside = (base, target) => {
  const path = relative(base, target);
  return path.startsWith(`..${sep}`) || isAbsolute(path);
};
function requireThat(condition, message) { if (!condition) throw new Error(message); }

const transform = String.raw`
import json, os, pathlib, sys, tempfile, zipfile
settings = json.load(sys.stdin)
destination = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(sys.argv[1]) as source:
    if source.testzip() is not None:
        raise RuntimeError('Source archive integrity check failed')
    entries = {name: source.read(name) for name in source.namelist() if name != 'mcp.json'}
manifest = json.loads(entries['plugin.json'])
extension = manifest['extensions']['com.openai']
extension['apps'] = './.app.json'
extension.pop('review', None)
extension.pop('publication', None)
if settings['version'] is not None:
    manifest['version'] = settings['version']
entries['plugin.json'] = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
entries['.app.json'] = (json.dumps({'apps': {'heart-of-gold': {'id': settings['appId'], 'required': True}}}, indent=2) + '\n').encode()
if 'mcp.json' in entries or '.mcp.json' in entries:
    raise RuntimeError('Private preview cannot bundle an MCP definition')
fd, temp = tempfile.mkstemp(prefix='.heart-of-gold-personal-', suffix='.zip', dir=destination.parent)
os.close(fd)
try:
    with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_STORED, allowZip64=False) as target:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            target.writestr(info, entries[name])
    with zipfile.ZipFile(temp) as target:
        if target.testzip() is not None or target.namelist() != sorted(entries):
            raise RuntimeError('Private archive integrity check failed')
        for name, data in entries.items():
            if target.read(name) != data:
                raise RuntimeError('Private archive content check failed')
    os.replace(temp, destination)
    print(json.dumps({'version': manifest['version'], 'files': sorted(entries)}))
finally:
    if os.path.exists(temp):
        os.unlink(temp)
`;

async function main() {
  const [suppliedId, output, version] = process.argv.slice(2);
  requireThat((process.argv.length === 4 || process.argv.length === 5) && output?.toLowerCase().endsWith('.zip'), 'Usage: node scripts/package-personal-plugin.mjs <registered-app-id> <destination.zip> [private-version]');
  // Only this URL-prefix normalization is explicitly documented by OpenAI.
  const appId = suppliedId.startsWith('plugin_asdk_app_') ? suppliedId.slice('plugin_'.length) : suppliedId;
  requireThat(appId.length <= 200 && /^(?:asdk_app_|connector_|templated_apps_)[A-Za-z0-9_-]+$/.test(appId), 'Use the registered app ID, not an uploaded package ID, URL, or credential.');
  requireThat(version === undefined || /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version), 'Private version must use major.minor.patch.');
  const destination = resolve(output);
  requireThat(outside(repository, destination), 'Keep the account-specific ZIP outside the public repository.');
  try {
    const info = await lstat(destination);
    requireThat(info.isFile() && !info.isSymbolicLink(), 'Destination must be a regular file or a new path.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(destination), { recursive: true });
  requireThat(outside(await realpath(repository), resolve(await realpath(dirname(destination)), 'personal.zip')), 'The destination directory resolves inside the public repository.');
  const temporary = await mkdtemp(resolve(tmpdir(), 'heart-of-gold-personal-'));
  try {
    const sourceZip = resolve(temporary, 'public.zip');
    // Reuse the public packager's allowlist, reference checks, secret/path checks,
    // schema-identity checks, and deterministic ZIP generation.
    const source = spawnSync(process.execPath, [resolve(repository, 'scripts/package-plugin.mjs'), sourceZip], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    requireThat(!source.error && source.status === 0, 'Public package validation failed. Run package-plugin.mjs to inspect the source checks.');
    const result = spawnSync('python3', ['-c', transform, sourceZip, destination], {
      input: JSON.stringify({ appId, version: version ?? null }), encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
    requireThat(!result.error && result.status === 0, 'Private ZIP creation failed; Python 3 with its standard zipfile module is required.');
    const receipt = JSON.parse(result.stdout);
    const bytes = await readFile(destination);
    console.log(JSON.stringify({ name: 'heart-of-gold', ...receipt, private: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
    console.log('Keep this account-specific ZIP private. It is not eligible for public directory submission.');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
