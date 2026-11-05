import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../', import.meta.url));
const script = resolve(repository, 'scripts/package-personal-plugin.mjs');
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('personal archive references registered app, omits raw MCP, and preserves public source', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'hog-personal-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const before = await readFile(resolve(repository, 'plugins/heart-of-gold/plugin.json'));
  const first = resolve(directory, 'first.zip'), second = resolve(directory, 'second.zip');
  for (const [id, destination] of [['asdk_app_test', first], ['plugin_asdk_app_test', second]]) {
    const result = run(id, destination, '0.2.0');
    assert.equal(result.status, 0, result.stderr);
    assert(!result.stdout.includes(id), 'receipt must not print the private app ID');
  }
  assert.deepEqual(await readFile(first), await readFile(second), 'normalized IDs produce deterministic bytes');
  assert.deepEqual(await readFile(resolve(repository, 'plugins/heart-of-gold/plugin.json')), before);
  const inspected = spawnSync('python3', ['-c', `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    assert 'mcp.json' not in z.namelist() and '.mcp.json' not in z.namelist()
    assert json.loads(z.read('.app.json')) == {'apps': {'heart-of-gold': {'id': 'asdk_app_test', 'required': True}}}
    p = json.loads(z.read('plugin.json'))
    assert p['version'] == '0.2.0' and p['extensions']['com.openai']['apps'] == './.app.json'
    assert 'review' not in p['extensions']['com.openai']
    assert 'skills/deploy-drive/SKILL.md' in z.namelist() and 'LICENSE' in z.namelist()
`, first], { encoding: 'utf8' });
  assert.equal(inspected.status, 0, inspected.stderr);
});

test('personal packager rejects unsafe IDs and destinations without touching source', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'hog-personal-reject-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const id of ['plugin_package123', 'plugin_connector_test', 'asdk_app_../../private', 'asdk_app_test\nheader:value', 'https://chatgpt.com/plugins/plugin_asdk_app_test']) {
    assert.notEqual(run(id, resolve(directory, 'rejected.zip')).status, 0);
  }
  assert.notEqual(run('asdk_app_test', resolve(repository, 'private-test.zip')).status, 0);
  const linked = resolve(directory, 'linked.zip');
  await symlink(resolve(repository, 'plugins/heart-of-gold/plugin.json'), linked);
  assert.notEqual(run('asdk_app_test', linked).status, 0);
  assert.notEqual(run('asdk_app_test', resolve(directory, 'version.zip'), 'bad/version').status, 0);
});
