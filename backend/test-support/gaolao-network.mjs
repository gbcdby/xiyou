import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {parseSpatial,validateSpatial} from '../../protocol/spatial.mjs';
/** 真人操作实际经过独立HTTP/Socket身份；受控NPC仍经服务端有限意图入口。测试只控制场景时钟与真实连接心跳，不灌世界事实。 */
export function gaolaoNetworkAdapter(server,origin){
  const sockets=[],tokens=new WeakMap(),serverHandles=new Map(),batches=[],errors=[];
  const open=server.runtime.openConnection.bind(server.runtime);
  server.runtime.openConnection=async(token,...rest)=>{const h=await open(token,...rest);serverHandles.set(token,h);return h;};
  const rpc=(socket,name,value)=>socket.timeout(15000).emitWithAck(name,value);
  async function http(path,token,body){const res=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json','X-Xiyou-Capabilities':'spatial-v2'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await res.text(),value=JSON.parse(raw);assert.equal(res.status,200,JSON.stringify(value));return value.schemaVersion===2&&value.type==='world.snapshot'?parseSpatial('SnapshotV2',raw):value.schemaVersion===2&&value.type==='session.recap'?parseSpatial('RecapV2',raw):value;}
  const adapter={
    guest:body=>http('/auth/guest',null,body),create:(token,body)=>http('/sessions',token,body),join:(token,id,body)=>http(`/sessions/${id}/join`,token,body),start:(token,id,body)=>http(`/sessions/${id}/start`,token,body),
    async openConnection(token,capabilities){const socket=io(origin,{auth:{token,capabilities},transports:['websocket'],reconnection:false});sockets.push(socket);tokens.set(socket,token);socket.on('world.batch',b=>{try{validateSpatial('BatchV2',b);batches.push({socketId:socket.id,throughSeq:b.throughSeq});}catch(e){errors.push(e.message);}});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;},
    subscribe:(socket,id)=>rpc(socket,'session.subscribe',{sessionId:id}),control:(socket,raw)=>rpc(socket,JSON.parse(raw).type,raw),submit:(socket,raw)=>rpc(socket,'player.action.request',raw),sync:(socket,raw)=>rpc(socket,'sync.request',raw),snapshot:(token,id)=>http(`/sessions/${id}`,token),recap:(token,id,q)=>http(`/sessions/${id}/recap?throughSeq=${q.throughSeq}`+(q.beforeSeq?'&beforeSeq='+q.beforeSeq:''),token),receipt:(token,id,actionId)=>http(`/sessions/${id}/actions/${actionId}`,token),
    heartbeat:socket=>server.runtime.heartbeat(serverHandles.get(tokens.get(socket))),maintenance:id=>server.runtime.maintenance(id),
    bindInternal:(...a)=>server.runtime.bindInternal(...a),observeInternal:(...a)=>server.runtime.observeInternal(...a),reserveSpatialIntent:(...a)=>server.runtime.reserveSpatialIntent(...a),submitSpatialIntent:(...a)=>server.runtime.submitSpatialIntent(...a),reserveSpatialFallback:(...a)=>server.runtime.reserveSpatialFallback(...a),spatialContext:(...a)=>server.runtime.spatialContext(...a),
    async close(){for(const socket of sockets)socket.disconnect();},sockets,batches,errors,
  };
  return adapter;
}
