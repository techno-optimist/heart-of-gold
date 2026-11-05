import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderAdapter, discoverModels, PROVIDERS } from '../lib/provider-adapter.mjs';

const KEY = 'test-only-never-a-real-provider-key-123456789';
const report = { summary: 'Done', result: 'A useful text result.', children: [] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const completion = (data = report) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(data) }] }], usage: { input_tokens: 100, output_tokens: 40 } });
const assignment = (extras = {}) => ({ node: { name: 'Ford', role: 'Explorer' }, task: 'Write a clear onboarding plan.', phase: 'plan', children: [], canDelegate: true, remainingAgents: 2, signal: new AbortController().signal, onActivity() {}, ...extras });
const adapter = (fetchImpl, extras = {}) => new ProviderAdapter({ provider: 'openai', key: KEY, model: 'gpt-5-mini', fetchImpl, ...extras });

test('provider metadata contains only public connection information', () => {
  assert.deepEqual(PROVIDERS.map(p => p.id), ['openai', 'anthropic', 'xai']);
  assert(PROVIDERS.every(p => p.keyUrl.startsWith('https://')));
  assert.equal(JSON.stringify(adapter(async () => json(completion()))), '{}');
});

for (const provider of ['openai', 'xai']) {
  test(`${provider} sends bounded schema Responses request to its fixed host`, async () => {
    const activity = [];
    const model = provider === 'xai' ? 'grok-4.7' : 'gpt-5-mini';
    const instance = adapter(async (url, options) => {
      assert.equal(url, `https://api.${provider === 'xai' ? 'x.ai' : 'openai.com'}/v1/responses`);
      assert.equal(options.headers.Authorization, `Bearer ${KEY}`);
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.model, model); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 4096);
      assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
      assert(!('tools' in body)); assert(!options.body.includes(KEY));
      assert.equal(body.input[0].role, 'system');
      return json(completion());
    }, { provider, model });
    assert.deepEqual(await instance.run(assignment({ onActivity: message => activity.push(message) })), report);
    assert(activity.some(s => s.includes('100 input tokens')));
    assert(!activity.join().includes(KEY));
  });
}

test('Claude uses workspace header, Messages schema and text block output', async () => {
  const instance = adapter(async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['anthropic-version'], '2026-10-21');
    assert.equal(options.headers['anthropic-workspace-id'], 'wrkspc_test123');
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 4096); assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.messages[0].role, 'user'); assert(!('store' in body)); assert(!('tools' in body));
    return json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(report) }] });
  }, { provider: 'anthropic', model: 'claude-sonnet-5-5', workspaceId: 'wrkspc_test123' });
  assert.deepEqual(await instance.run(assignment()), report);
});

test('OpenAI discovery filters non-text and unsupported models, caps results and validates key once', async () => {
  let calls = 0;
  const result = await discoverModels({ provider: 'openai', key: KEY, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/models'); assert.equal(options.headers.Authorization, `Bearer ${KEY}`);
    return json({ data: [{ id: 'gpt-5-mini' }, { id: 'gpt-4.1' }, { id: 'gpt-image-1' }, { id: 'gpt-5-realtime' }, { id: 'gpt-5-codex' }, { id: 'text-embedding-3-small' }, { id: 'https://evil.example/' }, ...Array.from({ length: 150 }, (_, i) => ({ id: `gpt-6-fixture-${i}` }))] });
  } });
  assert.equal(calls, 1); assert(result.length <= 100);
  assert(result.some(m => m.id === 'gpt-5-mini'));
  assert(!result.some(m => /image|realtime|embedding|codex|evil/.test(m.id)));
  assert(result.every(m => m.label === m.id));
});

test('Claude discovery pages with bounded cursor and requires supported active capabilities', async () => {
  const calls = [];
  const result = await discoverModels({ provider: 'anthropic', key: KEY, workspaceId: 'wrkspc_fixture', fetchImpl: async url => {
    calls.push(new URL(url));
    if (calls.length === 1) return json({ data: [
      { id: 'claude-sonnet-5-5', lifecycle: 'active', capabilities: { structured_outputs: { supported: true } } },
      { id: 'claude-opus-5', lifecycle: 'retired', capabilities: { structured_outputs: { supported: true } } },
      { id: 'claude-haiku-5-5', capabilities: { structured_outputs: { supported: false } } },
    ], has_more: true, last_id: 'claude-haiku-5-5' });
    return json({ data: [{ id: 'claude-opus-4-6' }, { id: 'claude-3-haiku-20240307' }], has_more: false });
  } });
  assert.equal(calls.length, 2); assert.equal(calls[1].searchParams.get('after_id'), 'claude-haiku-5-5');
  assert.deepEqual(result.map(m => m.id), ['claude-opus-4-6', 'claude-sonnet-5-5']);
});

test('Grok discovery uses language-models and excludes non-text modalities', async () => {
  const result = await discoverModels({ provider: 'xai', key: KEY, fetchImpl: async url => {
    assert.equal(url, 'https://api.x.ai/v1/language-models');
    return json({ models: [{ id: 'grok-4.7', output_modalities: ['text'] }, { id: 'grok-4-image', output_modalities: ['image'] }, { id: 'grok-4.1', output_modalities: ['audio'] }] });
  } });
  assert.deepEqual(result, [{ id: 'grok-4.7', label: 'grok-4.7' }]);
});

test('malformed, refused, truncated, tool-bearing and secret-echoing reports are rejected', async t => {
  const bad = [
    ['invalid JSON', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'not-json' }] }] }],
    ['extra field', completion({ ...report, instructions: 'secret side channel' })],
    ['empty leaf', completion({ ...report, result: '' })],
    ['credential echo', completion({ ...report, result: KEY })],
    ['truncated', { ...completion(), status: 'incomplete' }],
    ['refusal', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: KEY }] }] }],
    ['tool call', { status: 'completed', output: [{ type: 'function_call', name: 'unrequested', arguments: KEY }] }],
  ];
  for (const [name, value] of bad) await t.test(name, async () => {
    await assert.rejects(adapter(async () => json(value)).run(assignment()), error => !error.message.includes(KEY));
  });
});

test('Claude rejects truncation, refusal, tools, and malformed JSON', async t => {
  for (const [stop_reason, content] of [
    ['max_tokens', [{ type: 'text', text: JSON.stringify(report) }]],
    ['refusal', [{ type: 'text', text: KEY }]],
    ['end_turn', [{ type: 'tool_use', input: KEY }]],
    ['end_turn', [{ type: 'text', text: '{bad json' }]],
  ]) await t.test(stop_reason, async () => {
    await assert.rejects(adapter(async () => json({ stop_reason, content }), { provider: 'anthropic', model: 'claude-sonnet-5-5' }).run(assignment()));
  });
});

test('delegation is accepted only during a permitted plan and obeys remaining helper limit', async () => {
  const delegated = { summary: 'Delegate', result: '', children: [{ name: 'Marvin', role: 'Skeptic', task: 'Critique the draft.' }] };
  const instance = adapter(async () => json(completion(delegated)));
  assert.deepEqual(await instance.run(assignment()), delegated);
  await assert.rejects(instance.run(assignment({ phase: 'synthesize' })), /validation/);
  await assert.rejects(instance.run(assignment({ canDelegate: false })), /validation/);
  await assert.rejects(instance.run(assignment({ remainingAgents: 0 })), /validation/);
});

test('HTTP and network errors are generic, credential-safe and never retried', async t => {
  for (const status of [400, 401, 403, 429, 500, 503]) await t.test(String(status), async () => {
    let calls = 0;
    await assert.rejects(adapter(async () => { calls++; return json({ error: { message: KEY } }, status); }).run(assignment()), error => !error.message.includes(KEY) && error.code !== undefined);
    assert.equal(calls, 1);
  });
  await assert.rejects(adapter(async () => { throw new Error(`network failure ${KEY}`); }).run(assignment()), error => error.code === 'network' && !error.message.includes(KEY));
});

test('response stream and declared content length have a hard byte cap', async () => {
  await assert.rejects(adapter(async () => new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } })).run(assignment()), /size limit/);
  await assert.rejects(adapter(async () => new Response('x'.repeat(1024 * 1024 + 1))).run(assignment()), /size limit/);
});

test('request deadline aborts fetch even when a transport ignores AbortSignal', async () => {
  let seenSignal;
  const instance = adapter(async (_, options) => { seenSignal = options.signal; return new Promise(() => {}); }, { timeoutMs: 15 });
  await assert.rejects(instance.run(assignment()), error => error.code === 'timeout');
  assert.equal(seenSignal.aborted, true);
});

test('cancellation before or during a request stops without completion', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(adapter(async () => { calls++; }).run(assignment({ signal: controller.signal })), error => error.name === 'AbortError');
  assert.equal(calls, 0);
  const inFlight = new AbortController();
  const pending = adapter(async () => new Promise(() => {})).run(assignment({ signal: inFlight.signal }));
  setTimeout(() => inFlight.abort(), 10);
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('execution gate is released on failed response and invalid credentials never reach fetch', async () => {
  let released = 0;
  await assert.rejects(adapter(async () => json({}, 429), { gate: { async acquire() { return () => released++; } } }).run(assignment()));
  assert.equal(released, 1);
  for (const key of ['', 'tiny', `${KEY}\n`, `${KEY} `, 'x'.repeat(513)]) assert.throws(() => adapter(async () => {}, { key }), /API key/);
  assert.throws(() => adapter(async () => {}, { provider: 'https://evil.example' }), /supported provider/);
  assert.throws(() => adapter(async () => {}, { provider: 'anthropic', workspaceId: 'not\na-header' }), /workspace/);
});
