/** Explicit component updates. The opaque preview iframe remains the security boundary. */
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export function normalizeComponentRuntime(value, files, components, entrypoint) {
  if (value == null) return undefined;
  const byPath = new Map(files.map(file => [file.path, file]));
  const known = new Set(components.map(component => component.id));
  if (value.kind !== 'components-v1' || !Array.isArray(value.shellPaths) || !Array.isArray(value.components) || value.components.length > 12 || !value.shellPaths.length || value.shellPaths.length > 24) throw new Error('The component runtime manifest is invalid.');
  const shellPaths = [...new Set(value.shellPaths)];
  if (shellPaths.length !== value.shellPaths.length || shellPaths.some(path => !byPath.has(path)) || !shellPaths.includes(entrypoint)) throw new Error('The runtime shell must include its HTML entrypoint and declared files.');
  const seen = new Set();
  const mappings = value.components.map(component => {
    if (!component || !ID.test(component.id) || !known.has(component.id) || seen.has(component.id)) throw new Error('Runtime components need unique declared component IDs.');
    seen.add(component.id);
    const result = { id: component.id };
    for (const [field, extension] of [['htmlPath', /\.html?$/i], ['cssPath', /\.css$/i], ['scriptPath', /\.m?js$/i]]) {
      const path = component[field];
      if (field === 'htmlPath' || path != null) { if (typeof path !== 'string' || !byPath.has(path) || !extension.test(path)) throw new Error('A component runtime file is missing or has an unsupported type.'); result[field] = path; }
    }
    return result;
  });
  return { kind: 'components-v1', shellPaths, components: mappings };
}
export function componentShellKey(project) {
  if (!project?.runtime) return null;
  const files = new Map(project.files.map(file => [file.path, file]));
  return JSON.stringify([project.runtime.kind, project.entrypoint || (files.has('index.html') ? 'index.html' : project.files.find(file => /\.html?$/i.test(file.path))?.path), project.runtime.shellPaths.map(path => [path, files.get(path)?.sha256 || files.get(path)?.content])]);
}
export function componentPatches(project, drafts = new Map()) {
  if (!project.runtime) return [];
  const files = new Map(project.files.map(file => [file.path, file]));
  return project.runtime.components.map(mapping => {
    const get = field => { const file = files.get(mapping[field]); return file ? drafts.get(file.path) ?? file.content : ''; };
    const html = get('htmlPath'), css = get('cssPath'), script = get('scriptPath');
    // Exact source identity is used for local drafts as well as server-hashed files.
    const digest = JSON.stringify([mapping.htmlPath, mapping.cssPath, mapping.scriptPath].map(path => path ? [path, drafts.has(path) ? drafts.get(path) : files.get(path).sha256 || files.get(path).content] : null));
    return { id: mapping.id, digest, revision: project.revision, html, css, script };
  });
}

/** Serialized into the network-disabled preview; never receives flight capabilities. */
export function installComponentRuntime(config) {
  const records = new Map(), states = new Map(), values = new Map(), listeners = new Map();
  let ids = Array.isArray(config.ids) ? config.ids.slice(0, 12) : [];
  const send = (type, detail) => { if (parent !== window) parent.postMessage({ type, nonce: config.nonce, ...detail }, '*'); };
  const geometry = () => {
    const rects = [], missing = [];
    for (const id of ids) {
      const matches = [...document.querySelectorAll('[data-hog-component]')].filter(node => node.getAttribute('data-hog-component') === id);
      if (matches.length !== 1) { missing.push(id); continue; }
      const rect = matches[0].getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) rects.push({ id, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    return { rects, missing };
  };
  const stop = record => { if (!record) return; record.abort.abort(); try { record.dispose?.(); } catch { /* A disposed component cannot interrupt its siblings. */ } };
  function controller(source) {
    if (!source.trim()) return () => {};
    let factory;
    const key = `__hog_component_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    window[key] = value => { factory = value; };
    script.textContent = `window[${JSON.stringify(key)}]((\n${source}\n));`;
    const compilationError = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('error', compilationError, true);
    try { document.head.append(script); } finally { window.removeEventListener('error', compilationError, true); script.remove(); delete window[key]; }
    if (typeof factory !== 'function') throw new Error('The controller must be a complete function expression.');
    return factory;
  }
  function apply(patch) {
    if (!patch || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(patch.id) || !Number.isInteger(patch.revision) || patch.revision < 1 || typeof patch.digest !== 'string' || [patch.html, patch.css, patch.script].some(value => typeof value !== 'string' || value.length > 65536)) return;
    const prior = records.get(patch.id);
    if (prior && patch.revision < prior.revision) return;
    if (prior?.digest === patch.digest) { prior.revision = patch.revision; send('hog:component-applied', { id: patch.id, digest: patch.digest, revision: patch.revision, unchanged: true, ...geometry() }); return; }
    let abort;
    try {
      const matches = [...document.querySelectorAll('[data-hog-component]')].filter(node => node.getAttribute('data-hog-component') === patch.id);
      if (matches.length !== 1) throw new Error('The shell must contain exactly one declared component anchor.');
      const anchor = matches[0], factory = controller(patch.script);
      const template = document.createElement('template'); template.innerHTML = patch.html;
      if (template.content.querySelector('script,iframe,object,embed,base,meta,link,style') || [...template.content.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name) || attribute.name === 'srcdoc' || /^javascript:/i.test(attribute.value.trim())))) throw new Error('Use declarative component HTML, separate CSS, and the controller function.');
      const root = document.createElement('div'); root.append(template.content.cloneNode(true));
      const style = document.createElement('style'); style.textContent = patch.css;
      abort = new AbortController();
      const state = structuredClone(states.get(patch.id) || {});
      const writes = new Map(), subscriptions = []; let committed = false;
      const publish = (key, value) => { values.set(key, value); for (const callback of [...(listeners.get(key) || [])]) { try { callback(structuredClone(value)); } catch { /* Component subscribers are independent. */ } } };
      const store = {
        get: key => structuredClone(writes.has(String(key)) ? writes.get(String(key)) : values.get(String(key))),
        set(key, value) { key = String(key); const safe = structuredClone(value); if (committed) publish(key, safe); else writes.set(key, safe); },
        subscribe(key, callback) {
          if (typeof callback !== 'function') throw new TypeError('A store subscriber must be a function.');
          key = String(key); let active = true;
          const register = () => { if (!active || abort.signal.aborted) return; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(callback); };
          const unsubscribe = () => { active = false; listeners.get(key)?.delete(callback); if (!listeners.get(key)?.size) listeners.delete(key); };
          abort.signal.addEventListener('abort', unsubscribe, { once: true });
          if (committed) register(); else subscriptions.push(register);
          return unsubscribe;
        },
      };
      // Mount against detached DOM first. A registration or synchronous mount
      // failure leaves the old visible component in place.
      const dispose = factory({ root, state, store, signal: abort.signal });
      if (dispose != null && typeof dispose !== 'function') throw new Error('A component controller may return only a dispose function.');
      const shadow = anchor.shadowRoot || anchor.attachShadow({ mode: 'open' });
      stop(prior); shadow.replaceChildren(style, root);
      records.set(patch.id, { digest: patch.digest, revision: patch.revision, abort, dispose, anchor });
      states.set(patch.id, state); committed = true;
      for (const register of subscriptions) register();
      for (const [key, value] of writes) publish(key, value);
      writes.clear();
      send('hog:component-applied', { id: patch.id, digest: patch.digest, revision: patch.revision, unchanged: false, ...geometry() });
    } catch (error) {
      abort?.abort();
      send('hog:component-error', { id: patch.id, digest: patch.digest, revision: patch.revision, message: String(error?.message || 'This component could not be mounted.').slice(0, 240) });
    }
  }
  function update(data) {
    if (!Array.isArray(data.patches) || data.patches.length > 12 || !Array.isArray(data.ids) || data.ids.length > 12) return;
    ids = data.ids.filter(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id));
    const desired = new Set(data.patches.map(patch => patch?.id));
    for (const [id, record] of records) if (!desired.has(id)) { stop(record); record.anchor.shadowRoot?.replaceChildren(); records.delete(id); }
    for (const patch of data.patches) apply(patch);
  }
  addEventListener('message', event => { if (event.source === parent && event.data?.nonce === config.nonce && event.data.type === 'hog:component-patches') update(event.data); });
  addEventListener('pagehide', () => { for (const record of records.values()) stop(record); });
  addEventListener('DOMContentLoaded', () => update({ ids, patches: config.patches || [] }), { once: true });
}
