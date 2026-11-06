#!/usr/bin/env node
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { watchProject, validateWatcherPaths, ProjectWatcherError } from '../lib/project-watcher.mjs';

const usage = 'Usage: node scripts/watch-project.mjs --root <dedicated-artifact-directory> --manifest <lead-owned-manifest.json>\nPass the scoped artifact connection JSON on stdin. Never put its token in arguments or the watched directory.';
const receipt = value => process.stdout.write(`${JSON.stringify(value)}\n`);
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage); return; }
  if (args.length !== 4) throw new ProjectWatcherError('INVALID_ARGUMENTS', usage);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--root', '--manifest'].includes(args[index]) || values[args[index]] || !args[index + 1]) throw new ProjectWatcherError('INVALID_ARGUMENTS', usage);
    values[args[index]] = args[index + 1];
  }
  if (!values['--root'] || !values['--manifest']) throw new ProjectWatcherError('INVALID_ARGUMENTS', usage);
  const manifestPath = resolve(values['--manifest']);
  await validateWatcherPaths(values['--root'], manifestPath);
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) throw new ProjectWatcherError('INVALID_MANIFEST', 'Use a regular lead-owned manifest of at most 32 KiB outside the artifact directory.');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { throw new ProjectWatcherError('INVALID_MANIFEST', 'The lead-owned manifest must be valid JSON.'); }
  if (process.stdin.isTTY) throw new ProjectWatcherError('CONNECTION_REQUIRED', 'Pass scoped connection JSON on stdin; do not type a capability into command arguments.');
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 32768) throw new ProjectWatcherError('INVALID_CONNECTION', 'Connection JSON exceeds 32 KiB.');
    chunks.push(chunk);
  }
  let connection;
  try { connection = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectWatcherError('INVALID_CONNECTION', 'Standard input must contain one scoped connection JSON object.'); }
  const watcher = await watchProject({ root: values['--root'], manifest, manifestPath, connection, onReceipt: receipt });
  connection = undefined;
  for (const chunk of chunks) chunk.fill(0);
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; watcher.stop({ flush: true, timeoutMs: 10000 }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const result = await watcher.done;
  process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  if (!result.ok) process.exitCode = 1;
}
main().catch(cause => {
  const failure = cause instanceof ProjectWatcherError ? cause : new ProjectWatcherError('WATCH_FAILED', 'The artifact watcher could not start. Check the directory, manifest, and connection.');
  receipt({ event: 'watch.error', code: failure.code, message: failure.message });
  process.exitCode = 1;
});
