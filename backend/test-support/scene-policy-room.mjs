import assert from 'node:assert/strict';
import {gaolaoRoom,accepted,take,share} from './gaolao-room.mjs';
import {gaolaoNetworkAdapter} from './gaolao-network.mjs';
import {until} from './ai-room.mjs';

export async function scenePolicyRoom(server,clock,version='gaolaozhuang-scene-v2'){
  const address=await server.listen(0),network=gaolaoNetworkAdapter(server,`http://127.0.0.1:${address.port}`),r=await gaolaoRoom(network,clock,2,version);
  return decorate(r,server,network);
}
async function decorate(r,server,network){
  const send=r.send,go=r.go;
  // 读取本人投影用于断言；测试不能代翠兰执行任何实际动作。
  r.send=(key,...args)=>{assert.notEqual(key,'cuilan','生产路径禁止测试代答');return send(key,...args);};
  r.go=(key,...args)=>{assert.notEqual(key,'cuilan','生产路径禁止测试代移');return go(key,...args);};
  r.sceneStatus=()=>server.scenePolicy.status().actors.find(a=>a.sessionId===r.sessionId);
  r.drain=async()=>until(()=>{const s=r.sceneStatus();return s&&s.phase==='Idle'&&!s.bootstrap&&s.pendingSemanticSeq==='0';},'场景控制器必须收束当前待办：'+JSON.stringify(r.sceneStatus()),6000);
  const step=r.step;r.step=async(...args)=>{await step(...args);await r.drain();};
  r.propose=async(destinationId,leader=0,{wait=true}={})=>{
    const s=await r.snapshot(leader),c=await r.entity(leader,'翠兰'),own=await r.snapshot('cuilan'),latest=own.projection.chapter.consents.filter(c=>c.purpose==='follow').at(-1);
    accepted(await r.send(leader,{kind:'propose_follow',subjectRef:c.entityRef,leaderRef:s.projection.self.entityRef,destinationId,expectedConsentVersion:latest?.version??'0'}));
    if(wait)await r.drain();return (await r.snapshot('cuilan')).projection.chapter.consents.filter(c=>c.purpose==='follow').at(-1);
  };
  r.state=()=>server.runtime.replay(r.sessionId);r.network=network;await r.drain();return r;
}
/** 重用真实账号/Session，仅重建两条正常Socket与本局测试读端；不重新开局或重放剧情。 */
export async function resumeSceneRoom(server,clock,previous){
  const address=await server.listen(0),network=gaolaoNetworkAdapter(server,`http://127.0.0.1:${address.port}`),{users,content,sessionId}=previous,handles=[],actors=new Map();
  for(let i=0;i<users.length;i++){
    const handle=await network.openConnection(users[i].token,['spatial-v2']),s=await network.subscribe(handle,sessionId);
    const result=await network.control(handle,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,nonce:crypto.randomUUID()}));assert.equal(result.schemaVersion,2);
    handles.push(handle);actors.set(i,{handle,token:users[i].token,seq:0,epoch:null});
  }
  for(const [key,id] of Object.entries(content.chapterRules.people)){const npc=content.npcs.find(n=>n.characterId===id);actors.set(key,{handle:await network.bindInternal(sessionId,id,npc.actorKind==='scene_role'?'scene_role':'core_npc'),internal:true});}
  const snapshot=async key=>{const a=actors.get(key);return a.internal?network.observeInternal(a.handle):network.snapshot(a.token,sessionId);};
  const send=async(key,action)=>{assert.notEqual(key,'cuilan','重启生产路径禁止代答');const a=actors.get(key);if(a.internal){const id=crypto.randomUUID();await network.reserveSpatialIntent(a.handle,id,action);return network.submitSpatialIntent(a.handle,id);}const s=await snapshot(key);return network.submit(a.handle,JSON.stringify({schemaVersion:2,sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,clientActionId:crypto.randomUUID(),controlEpoch:s.projection.self.controlEpoch,baseSeq:s.snapshotSeq,action}));};
  const step=async(ms=1000)=>{clock.value+=ms;for(const h of handles)await network.heartbeat(h);await network.maintenance(sessionId);};
  const move=async(key,sceneId,position)=>{const a=actors.get(key),s=await snapshot(key),action={kind:'move_to',sceneId,destination:position};if(!a.internal){if(a.epoch!==s.projection.self.controlEpoch){a.epoch=s.projection.self.controlEpoch;a.seq=0;}action.movementCommandSeq=String(++a.seq);}accepted(await send(key,action));for(let i=0;i<30;i++){await step();const p=(await snapshot(key)).projection;if(p.movement?.status==='arrived')return p;assert.ok(!['cancelled','blocked'].includes(p.movement?.status),JSON.stringify(p.movement));}throw new Error('重连后的正常导航未到达。');};
  const go=async(key,at)=>{assert.notEqual(key,'cuilan','重启生产路径禁止代移');const s=await snapshot(key);if(s.projection.self.sceneId!==at.sceneId){const scene=content.scenes.find(row=>row.sceneId===s.projection.self.sceneId),exit=scene.exits.find(e=>e.destinationSceneId===at.sceneId);await move(key,scene.sceneId,scene.anchors.find(a=>a.anchorId===exit.anchorId).position);}return move(key,at.sceneId,at.position);};
  const entity=async(key,name)=>{const p=(await snapshot(key)).projection,e=[...p.entities,...p.targets,...p.items].find(e=>e.name===name);assert.ok(e,name);return e;};
  const interact=async(key,name,operationId,parameters)=>{const e=name==='self'?(await snapshot(key)).projection.self:await entity(key,name);return send(key,{kind:'interact',targetRef:e.entityRef,operationId,expectedTargetRevision:e.resourceRevision,...(parameters?{parameters}:{})});};
  const at=(sceneId,anchorId)=>({sceneId,position:content.scenes.find(s=>s.sceneId===sceneId).anchors.find(a=>a.anchorId===anchorId).position});
  return decorate({runtime:network,clock,content,sessionId,users,handles,actors,snapshot,send,step,move,go,entity,interact,at,C:id=>at('gaolao-courtyard',id),R:id=>at('gaolao-village-road',id)},server,network);
}
export async function openSceneDoor(r){
  await r.go(0,r.C('C04'));accepted(await r.interact(0,'侧窗联络点','gz-contact'));await r.drain();
  for(let i=0;i<12&&!(await r.state()).chapter.retreated;i++){await r.step(1000);}
  assert.equal((await r.state()).chapter.retreated,true,'只有生产本人退让并确认后开门');
  await r.go(0,r.C('C01'));accepted(await r.interact(0,'铜封门','gz-check-seal'));await r.go('wukong',r.C('C01'));
  await share(r,0,'侧窗本人回应','孙悟空');await share(r,0,'亲自在门外检查铜封','孙悟空');
  for(const [i,id,name] of [[0,'gz-brace','公共门撑'],[1,'gz-rope','公共绳索']]){await r.go(i,r.content.items.find(x=>x.itemId===id));await take(r,i,name);}
  await r.go(0,r.C('C02'));await r.go(1,r.C('C03'));
  for(const i of [0,1])accepted(await r.send(i,{kind:'cooperate',operationId:'gz-lock-support',operationVersion:'0',phase:'ready'}));
  accepted(await r.interact('wukong','铜封门','gz-break-seal'));await r.go(0,r.C('C08'));await r.drain();
}
export async function finishSceneRoute(r,destinationId){
  const route=destinationId==='front-guest-room'?[r.C('C01'),r.C('C13'),r.C('C11'),r.C('C12')]:[r.C('C01'),r.C('C20'),r.R('R02'),r.R('R06'),r.R('R04'),r.R('R05')];
  for(const at of route){await r.go(0,at);await r.drain();}
  for(let i=0;i<20&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(1000);
  assert.equal((await r.state()).chapter.cuilanSafe,true,JSON.stringify((await r.state()).chapter.follows));
}
