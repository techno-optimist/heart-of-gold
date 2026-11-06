export const ARTIFACT_EVENTS_URL = 'https://projectforty2.ai/heartofgold/artifacts/events';
export function artifactEventsUrl(value, location = globalThis.location) {
  const local = ['localhost', '127.0.0.1'].includes(location?.hostname) ? new URL('/heartofgold/artifacts/events', location.origin).href : null;
  if (value === ARTIFACT_EVENTS_URL) return local || ARTIFACT_EVENTS_URL;
  return local && value === local ? local : null;
}
/** Incremental SSE parser with a bounded event buffer; comments are heartbeats. */
export function createEventParser(onEvent) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    if (buffer.length > 1048576) throw new Error('STREAM_EVENT_LIMIT');
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      let type = 'message'; const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length && ['snapshot', 'update', 'expired'].includes(type)) onEvent(type, JSON.parse(data.join('\n')));
    }
  };
}
export function createArtifactStream({ onSnapshot, onState, getRevision, fetchImpl = (...args) => fetch(...args), location = globalThis.location }) {
  let authority = null, controller = null, timer = null, watchdog = null, generation = 0, failures = 0, closed = true;
  const clear = () => { clearTimeout(timer); clearTimeout(watchdog); controller?.abort(); controller = null; };
  function stop() { closed = true; generation++; clear(); authority = null; }
  function schedule() { if (!closed) timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(failures, 4))); }
  async function connect() {
    if (closed || !authority) return;
    const current = ++generation, requestController = new AbortController(); controller = requestController; let reader;
    const refreshWatchdog = () => { if (closed || current !== generation) return; clearTimeout(watchdog); watchdog = setTimeout(() => requestController.abort(), 60000); };
    onState('connecting'); refreshWatchdog();
    try {
      const response = await fetchImpl(authority.url, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ flightId: authority.flightId, readToken: authority.readToken, afterRevision: getRevision() }), signal: requestController.signal });
      if (closed || current !== generation) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body?.getReader || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('STREAM_UNAVAILABLE');
      reader = response.body.getReader(); const decoder = new TextDecoder();
      const consume = createEventParser((type, value) => {
        if (closed || current !== generation) return;
        if (type === 'expired') { stop(); onState('expired'); return; }
        onSnapshot(value, type === 'snapshot' || value?.resync === true); failures = 0; onState('connected');
      });
      while (!closed && current === generation) {
        const { done, value } = await reader.read();
        if (closed || current !== generation) break;
        if (done) break;
        refreshWatchdog(); consume(decoder.decode(value, { stream: true }));
      }
      if (!closed && current === generation) throw new Error('STREAM_CLOSED');
    } catch {
      if (!closed && current === generation) { failures++; onState('interrupted'); schedule(); }
    } finally {
      requestController.abort();
      if (reader) { try { await reader.cancel(); } catch { /* A stopped reader may already be closed. */ } finally { try { reader.releaseLock(); } catch { /* No pending ownership is retained. */ } } }
      if (current === generation) { clearTimeout(watchdog); if (controller === requestController) controller = null; }
    }
  }
  return {
    start(flight) {
      const url = artifactEventsUrl(flight?.eventsUrl, location);
      if (!url || !flight?.id || !flight?.readToken) { stop(); return false; }
      if (!closed && authority?.flightId === flight.id && authority.readToken === flight.readToken && authority.url === url) return true;
      stop(); authority = { flightId: flight.id, readToken: flight.readToken, url }; failures = 0; closed = false; connect(); return true;
    },
    stop,
  };
}
