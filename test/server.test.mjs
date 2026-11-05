import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createFlightServer } from '../server.mjs';

class FakeRuntime extends EventEmitter {
  runs = [];
  async init() {}
  async close() {}
  listRuns() {return this.runs;}
  getRun(id) {return this.runs.find(r=>r.id===id);}
  createRun(input) {const run={...input,id:'flight-1',status:'running',nodes:[],events:[]};this.runs.push(run);return run;}
  cancelRun(id) {const r=this.getRun(id);r.status='cancelled';return r;}
}

async function setup(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'heart-server-'));
  await writeFile(path.join(dir,'index.html'),'<title>Flight deck</title>');
  const runtime=new FakeRuntime();
  const flight=await createFlightServer({runtime,publicDir:dir});
  const url=await flight.listen(0);
  t.after(async()=>{await flight.close();await rm(dir,{recursive:true,force:true});});
  const config=await (await fetch(url+'/api/config')).json();
  const post=(route,data,token=config.token,extra={})=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json','x-flight-token':token,...extra},body:JSON.stringify(data)});
  return {url,post,runtime,flight};
}

test('loopback API requires token, refuses cross-origin requests and validates limits',async t=>{
  const {url,post}=await setup(t);
  assert.equal((await fetch(url)).status,200);
  assert.equal((await post('/api/runs',{task:'Design a community experiment',mode:'demo'},'')).status,403);
  assert.equal((await fetch(url+'/api/config',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(url+'/api/config',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await post('/api/runs',{task:'Design a community experiment',mode:'demo',maxAgents:100})).status,400);
  assert.equal((await post('/api/runs',{task:'Design a community experiment',mode:'arbitrary-command'})).status,400);
  assert.equal((await post('/api/runs',{task:'x'.repeat(20000),mode:'demo'})).status,413);
});

test('run creation, duplicate launch protection, snapshot, and cancellation',async t=>{
  const {post,url}=await setup(t);
  const response=await post('/api/runs',{task:'Design a community experiment',mode:'demo'});
  assert.equal(response.status,201);
  const run=await response.json();
  assert.equal(run.maxAgents,7);
  assert.equal((await post('/api/runs',{task:'Another community experiment',mode:'demo'})).status,409);
  assert.equal((await (await fetch(url+'/api/runs/'+run.id)).json()).status,'running');
  assert.equal((await (await post('/api/runs/'+run.id+'/cancel',{})).json()).status,'cancelled');
  assert.equal((await fetch(url+'/api/runs/missing')).status,404);
});

test('host rebinding and filesystem traversal are rejected',async t=>{
  const {url}=await setup(t);
  const status=await new Promise((resolve,reject)=>{
    const req=http.get(url,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);
  });
  assert.equal(status,403);
  assert.equal((await fetch(url+'/%2e%2e%2fserver.mjs')).status,403);
});

test('server-sent events carry runtime events',async t=>{
  const {url,runtime}=await setup(t);
  const controller=new AbortController();
  const response=await fetch(url+'/api/events',{signal:controller.signal});
  assert.equal(response.headers.get('content-type'),'text/event-stream');
  const reader=response.body.getReader();
  await reader.read();
  runtime.emit('event',{id:'event-1',runId:'flight-1',type:'node.started',at:new Date().toISOString(),data:{nodeId:'node-1'}});
  const {value}=await reader.read();
  assert.match(new TextDecoder().decode(value),/node.started/);
  controller.abort();
});
