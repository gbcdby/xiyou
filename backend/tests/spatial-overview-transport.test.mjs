import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createAuthorityServer } from '../server.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { SPATIAL_CAPABILITIES } from '../../frontend/src/network/spatial-capabilities.ts';
import { parseSpatial, validateSpatial } from '../../protocol/spatial.mjs';

test('GZ-UX-AC-01：新能力枚举有明确定义，未知能力仍拒绝',()=>{
  assert.equal(parseSpatial('SpatialClientCapability','"spatial-scene-overview-v1"'),'spatial-scene-overview-v1');
  assert.throws(()=>parseSpatial('SpatialClientCapability','"unregistered-overview"'));
});

test('GZ-UX-AC-01：前端实际能力列表经过真实HTTP与Socket握手取得概览，旧reader不收到扩展',async t=>{
  const db=await startTestPostgres('overview-transport',{outputSubdirectory:'ux-c-20261115'}),server=await createAuthorityServer({pool:db.pool}),sockets=[];
  t.after(async()=>{for(const socket of sockets)socket.disconnect();await server.close();await db.stop();});
  const base=`http://127.0.0.1:${(await server.listen(0)).port}`,users=[];
  const post=async(path,token,value)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(value)});assert.equal(response.status,200);return response.json();};
  for(let i=0;i<2;i++)users.push(await server.runtime.guest({name:'真实概览入口'+i}));
  const {sessionId}=await post('/api/sessions',users[0].token,{nonce:crypto.randomUUID(),contentVersion:'gaolaozhuang-scene-v3',capabilities:SPATIAL_CAPABILITIES});
  await post(`/api/sessions/${sessionId}/join`,users[1].token,{nonce:crypto.randomUUID(),capabilities:SPATIAL_CAPABILITIES});
  await post(`/api/sessions/${sessionId}/start`,users[0].token,{nonce:crypto.randomUUID()});
  const connect=async capabilities=>{const socket=io(base,{auth:{token:users[0].token,capabilities},transports:['websocket'],reconnection:false,autoConnect:false});sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return socket;};
  const current=await connect(SPATIAL_CAPABILITIES);
  const subscribe=socket=>new Promise((resolve,reject)=>socket.timeout(5000).emit('session.subscribe',{sessionId},(error,value)=>error?reject(error):resolve(value)));
  const full=validateSpatial('SnapshotV2',await subscribe(current));assert.ok(full.projection.sceneOverview?.entities.length);assert.equal(full.projection.mapCatalog.length,2);
  const oldCaps=SPATIAL_CAPABILITIES.filter(cap=>cap!=='spatial-scene-overview-v1');
  const old=validateSpatial('SnapshotV2',await subscribe(await connect(oldCaps)));assert.equal(old.projection.sceneOverview,undefined);assert.equal(old.projection.mapCatalog,undefined);
  for(const capabilities of [SPATIAL_CAPABILITIES,oldCaps]){const response=await fetch(`${base}/api/sessions/${sessionId}`,{headers:{authorization:`Bearer ${users[0].token}`,'x-xiyou-capabilities':capabilities.join(',')}});assert.equal(response.status,200);const value=validateSpatial('SnapshotV2',await response.json());assert.equal(Boolean(value.projection.sceneOverview),capabilities.includes('spatial-scene-overview-v1'));}
  await assert.rejects(connect([...SPATIAL_CAPABILITIES,'unregistered-overview']),error=>error.data?.code==='INVALID_MESSAGE');
});
