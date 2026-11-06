import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { normalizeComponentRuntime, componentShellKey, componentPatches, installComponentRuntime } from '../plugins/heart-of-gold/ui/component-runtime.mjs';
import { normalizeProject, buildStandaloneProject } from '../plugins/heart-of-gold/ui/project-preview.mjs';
import { createEventParser, artifactEventsUrl, ARTIFACT_EVENTS_URL, createArtifactStream } from '../plugins/heart-of-gold/ui/artifact-stream.mjs';

const project = () => ({ revision: 1, title: 'Live authored app', entrypoint: 'index.html', files: [
  { path: 'index.html', content: '<html><head></head><body><section data-hog-component="entry"></section><section data-hog-component="list"></section></body></html>' },
  { path: 'entry.html', content: '<button>Add</button>' }, { path: 'entry.css', content: 'button{color:gold}' }, { path: 'entry.js', content: '(ctx)=>{ctx.state.mounts=(ctx.state.mounts||0)+1;}' },
  { path: 'list.html', content: '<p>Empty list</p>' },
].map(file => ({ ...file, memberId: 'builder' })), components: [
  { id: 'entry', memberId: 'builder', filePaths: ['entry.html','entry.css','entry.js'] }, { id: 'list', memberId: 'builder', filePaths: ['list.html'] },
], runtime: { kind: 'components-v1', shellPaths: ['index.html'], components: [{ id: 'entry', htmlPath: 'entry.html', cssPath: 'entry.css', scriptPath: 'entry.js' }, { id: 'list', htmlPath: 'list.html' }] }, changes: [], checks: [] });

// Minimal DOM boundary; controller JavaScript is parsed and executed by V8.
function runtimeHarness(bootSource) {
  const events = new Map(), messages = [], parent = {}, anchors = new Map();
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.attributes=[]; this.textContent=''; this.shadowRoot=null; this.dataset={}; if(tag==='template') this.content=new Element('fragment'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=[...nodes]; }
    remove() {}
    cloneNode() { const result=new Element(this.tagName); result.textContent=this.textContent; return result; }
    set innerHTML(value) { this.content.textContent=value; }
    querySelector(selector) { return /<script\b/.test(this.textContent) && selector.includes('script') ? {} : null; }
    querySelectorAll() { return []; }
    getAttribute() { return this.id; }
    getBoundingClientRect() { return {x:0,y:0,width:200,height:100}; }
    attachShadow() { this.shadowRoot=new Element('shadow'); return this.shadowRoot; }
  }
  for(const id of ['entry','list']) { const anchor=new Element('section'); anchor.id=id; anchors.set(id,anchor); }
  const context = createContext({ console, structuredClone, AbortController, Math, Map, Set, JSON, Error, TypeError });
  const add = (name,fn) => { if(!events.has(name)) events.set(name,new Set()); events.get(name).add(fn); };
  const remove = (name,fn) => events.get(name)?.delete(fn);
  const dispatch = (name,event={}) => { for(const fn of [...(events.get(name)||[])]) fn(event); };
  Object.assign(context,{ parent, document:{ querySelectorAll:()=>[...anchors.values()], createElement:tag=>new Element(tag), head:{append(script){ try{new Script(script.textContent).runInContext(context);}catch(error){dispatch('error',{preventDefault(){},stopImmediatePropagation(){},message:error.message});}}}}, addEventListener:add });
  context.window=context; context.window.addEventListener=add; context.window.removeEventListener=remove;
  parent.postMessage=message=>messages.push(message);
  new Script(bootSource || `(${installComponentRuntime.toString()})({nonce:'test-nonce',ids:['entry','list'],patches:[]});`).runInContext(context);
  dispatch('DOMContentLoaded');
  const patch=(id,revision,script,extra={})=>({id,revision,digest:`${id}-${revision}`,html:'<button>Authored</button>',css:'',script,...extra});
  const send=(patches,extra={})=>dispatch('message',{source:parent,data:{type:'hog:component-patches',nonce:'test-nonce',ids:['entry','list'],patches,...extra}});
  return {context,anchors,messages,patch,send,dispatch,parent};
}

test('runtime manifest resolves declared anchors/files and shell identity ignores component edits', () => {
  const input=project(), normalized=normalizeProject(input), before=componentShellKey(normalized);
  assert.equal(normalized.runtime.kind,'components-v1');
  normalized.files.find(file=>file.path==='entry.js').content='()=>{}';
  assert.equal(componentShellKey(normalized),before);
  normalized.files[0].content+='<footer>Changed shell</footer>';
  assert.notEqual(componentShellKey(normalized),before);
  assert.throws(()=>normalizeComponentRuntime({...input.runtime,shellPaths:['entry.html']},input.files,input.components,'index.html'));
  assert.throws(()=>normalizeComponentRuntime({...input.runtime,components:[{id:'unknown',htmlPath:'entry.html'}]},input.files,input.components,'index.html'));
});

test('standalone export embeds complete component runtime and exact source with no flight authority', () => {
  const normalized=normalizeProject(project()), html=buildStandaloneProject(normalized);
  assert.match(html,/attachShadow/); assert.match(html,/ctx.state.mounts/);
  assert.doesNotMatch(html,/installComponentProbe|readToken|writeToken|flightId|unsafe-eval/);
  assert.equal(componentPatches(normalized).length,2);
  const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  for(const match of scripts) assert.doesNotThrow(()=>new Script(match[1]));
  const standalone=runtimeHarness(scripts[0][1]);
  assert.ok(standalone.anchors.get('entry').shadowRoot, 'the exported HTML mounts its actual entry component without the plugin');
  assert.ok(standalone.anchors.get('list').shadowRoot, 'the exported HTML mounts the second independent component');
  assert.equal(standalone.messages.filter(message=>message.type==='hog:component-applied').length,2);
});

test('invalid component source retains mounted DOM and unrelated instances; later valid patch preserves state', () => {
  const h=runtimeHarness();
  const entry=h.patch('entry',1,'ctx=>{ctx.state.count=(ctx.state.count||0)+1;ctx.root.textContent=String(ctx.state.count);return ()=>{globalThis.disposals=(globalThis.disposals||0)+1;};}');
  const list=h.patch('list',1,'ctx=>{ctx.root.textContent="untouched";}');
  h.send([entry,list]); const prior=h.anchors.get('entry').shadowRoot.children[1], sibling=h.anchors.get('list').shadowRoot.children[1];
  h.send([h.patch('entry',2,'ctx=>{'),list]);
  assert.equal(h.anchors.get('entry').shadowRoot.children[1],prior); assert.equal(h.context.disposals,undefined);
  assert.equal(h.messages.at(-2).type,'hog:component-error');
  h.send([h.patch('entry',3,'ctx=>{ctx.state.count++;ctx.root.textContent=String(ctx.state.count);}'),list]);
  assert.equal(h.anchors.get('entry').shadowRoot.children[1].textContent,'2'); assert.equal(h.context.disposals,1);
  assert.equal(h.anchors.get('list').shadowRoot.children[1],sibling);
});

test('failed mount cannot commit shared-store writes or mutate the retained component state', () => {
  const h=runtimeHarness();
  const entry=h.patch('entry',1,'ctx=>{ctx.state.count=7;ctx.store.set("count",7);}');
  const list=h.patch('list',1,'ctx=>{ctx.root.textContent=String(ctx.store.get("count"));ctx.store.subscribe("count",v=>{ctx.root.textContent=String(v);});}');
  h.send([entry,list]);
  h.send([h.patch('entry',2,'ctx=>{ctx.state.count=99;ctx.store.set("count",99);throw Error("mount failed");}'),list]);
  assert.equal(h.anchors.get('list').shadowRoot.children[1].textContent,'7');
  h.send([h.patch('entry',3,'ctx=>{ctx.root.textContent=String(ctx.state.count);ctx.store.set("count",8);}'),list]);
  assert.equal(h.anchors.get('entry').shadowRoot.children[1].textContent,'7');
  assert.equal(h.anchors.get('list').shadowRoot.children[1].textContent,'8');
});

test('replacement/removal disposes once, duplicate receipts do not remount, and foreign messages are ignored', () => {
  const h=runtimeHarness(), entry=h.patch('entry',1,'ctx=>{globalThis.mounts=(globalThis.mounts||0)+1;return ()=>{globalThis.disposals=(globalThis.disposals||0)+1;};}');
  h.send([entry]); h.send([entry]); assert.equal(h.context.mounts,1);
  h.send([h.patch('entry',2,'ctx=>{}')],{nonce:'wrong'}); assert.equal(h.context.disposals,undefined);
  h.dispatch('message',{source:{},data:{type:'hog:component-patches',nonce:'test-nonce',ids:[],patches:[]}}); assert.equal(h.context.disposals,undefined);
  h.send([]); assert.equal(h.context.disposals,1); assert.equal(h.anchors.get('entry').shadowRoot.children.length,0);
});

test('SSE parser handles split payloads and heartbeats without replaying nonexistent events', () => {
  const seen=[],consume=createEventParser((type,value)=>seen.push([type,value]));
  consume(': heartbeat\r'); consume('\n\r\nevent: snapshot\ndata: {"revision":'); consume('1}\n\nevent: update\ndata: {"revision":2}\n\n');
  assert.deepEqual(seen,[['snapshot',{revision:1}],['update',{revision:2}]]);
  assert.equal(artifactEventsUrl('https://attacker.invalid/events',{hostname:'host.example'}),null);
  assert.equal(artifactEventsUrl(ARTIFACT_EVENTS_URL,{hostname:'host.example'}),ARTIFACT_EVENTS_URL);
  assert.equal(artifactEventsUrl('http://127.0.0.1:4270/heartofgold/artifacts/events',{hostname:'127.0.0.1',origin:'http://127.0.0.1:4270'}),'http://127.0.0.1:4270/heartofgold/artifacts/events');
  assert.equal(artifactEventsUrl('http://127.0.0.1:9999/heartofgold/artifacts/events',{hostname:'127.0.0.1',origin:'http://127.0.0.1:4270'}),null);
});

test('stream keeps read authority in a credentialless POST and accepts authoritative resync', async () => {
  const requests=[],snapshots=[]; let resolve; const done=new Promise(r=>resolve=r); let client;
  client=createArtifactStream({ location:{hostname:'host.example'},getRevision:()=>4,onSnapshot:(value,resync)=>{snapshots.push({value,resync});},onState:status=>{if(status==='connected'){client.stop();resolve();}},fetchImpl:async(url,options)=>{requests.push({url,options});return new Response('event: snapshot\ndata: {"resync":true,"flight":{"revision":5}}\n\n',{headers:{'content-type':'text/event-stream'}});} });
  client.start({id:'flight',readToken:'test-read-authority',eventsUrl:ARTIFACT_EVENTS_URL}); await done;
  assert.equal(requests[0].options.credentials,'omit'); assert.equal(requests[0].options.method,'POST');
  assert.equal(requests[0].url.includes('test-read-authority'),false); assert.equal(JSON.parse(requests[0].options.body).afterRevision,4);
  assert.equal(snapshots[0].resync,true); assert.equal(snapshots[0].value.flight.revision,5);
});
