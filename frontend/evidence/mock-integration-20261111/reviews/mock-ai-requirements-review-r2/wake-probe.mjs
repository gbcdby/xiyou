import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startTestPostgres } from './postgres.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { attachMockAI } from '../../backend/ai/mock-runtime.mjs';
import { createRunningRoom, actionRaw, controlRaw, until } from '../../backend/test-support/ai-room.mjs';

const report={candidate:'71aad48878c532521919c72511c023285785d7e7',scope:'真实PG与原attachMockAI；只检验实际受众唤醒、合法新输入、控制epoch、变化Fact、重启与新会话，不计作60秒观察。',checks:[]};
const db=await startTestPostgres('req-mock-wake-r2');let runtime;let ai;
const privateMarker=`私有不可泄漏-${crypto.randomUUID()}`;
try{
  runtime=await createRuntime({pool:db.pool});ai=await attachMockAI({runtime,minIntervalMs:10});
  const room=await createRunningRoom(runtime,2);report.sessionId=room.sessionId;
  function slots(sessionId=room.sessionId){return ai.status().roles.map(role=>({actorId:role.actorId,...role.sessions.find(s=>s.sessionId===sessionId)}));}
  async function stable(sessionId=room.sessionId){
    await until(()=>slots(sessionId).every(s=>s.sessionId===sessionId&&s.phase==='Idle'&&!s.pendingWake)&&ai.status().roles.every(r=>r.metrics.active===0),'模拟角色未到空闲',10000);
    return slots(sessionId);
  }
  const countMap=rows=>Object.fromEntries(rows.map(s=>[s.actorId,s.calls]));
  async function latest(role,sessionId=room.sessionId){return(await db.pool.query("SELECT context,outcome FROM ai_runs WHERE session_id=$1 AND actor_id=$2 ORDER BY (context->'decision'->>'generation')::numeric DESC LIMIT 1",[sessionId,role])).rows[0];}
  async function human(action){const r=await runtime.submit(room.connections[0],actionRaw(room,0,action));assert.equal(r.status,'Accepted');return r;}
  const events=[];const capture=({sessionId,events:batch})=>{if(sessionId===room.sessionId)events.push(...batch.map(e=>({kind:e.kind,coreAudience:e.audience.coreNpcCharacterIds,controlEpoch:e.kind==='control.changed'?e.payload.controlEpoch:null})));};
  runtime.on('commit',capture);
  await stable();

  let before=countMap(await stable());
  await human({kind:'speak',text:privateMarker,channel:'private',recipientIds:[room.actors[1]]});
  await new Promise(resolve=>setTimeout(resolve,25));
  let after=countMap(await stable());assert.deepEqual(after,before);
  report.checks.push({name:'仅真人可见的private Claim不唤醒',before,after,status:'PASS'});

  before=after;
  await human({kind:'inspect',targetId:'passage_structure'});
  await new Promise(resolve=>setTimeout(resolve,25));
  after=countMap(await stable());assert.deepEqual(after,before);
  report.checks.push({name:'仅检查者可见的新Observation不唤醒',before,after,status:'PASS'});

  before=after;const publicMarker=`合法新建议-${crypto.randomUUID()}：请继续核对安全与许可。`;
  await human({kind:'speak',text:publicMarker,channel:'public',recipientIds:[]});
  await until(()=>slots()[0].calls>before.tangseng,'合法公开Claim未唤醒唐僧');
  after=countMap(await stable());assert.ok(after.tangseng>before.tangseng);assert.equal(after.wukong,before.wukong);
  assert.ok((await latest('tangseng')).context.memory.claims.some(c=>c.text===publicMarker));
  assert.equal(JSON.stringify((await latest('tangseng')).context).includes(privateMarker),false);
  report.checks.push({name:'合法新Claim只唤醒实际在场受众且仍不泄露私人输入',before,after,status:'PASS'});

  before=after;const epochBefore=room.epochs[0];const newConnection=await runtime.openConnection(room.users[0].token);
  const eventStart=events.length;
  const control=await runtime.control(newConnection,controlRaw(room.sessionId,room.actors[0],'control.take'));
  assert.equal(control.mode,'HumanControlled');assert.ok(BigInt(control.controlEpoch)>BigInt(epochBefore));
  room.connections[0]=newConnection;room.epochs[0]=control.controlEpoch;
  const controlEvents=events.slice(eventStart).filter(e=>e.kind==='control.changed');assert.equal(controlEvents.length,1);
  for(const role of controlEvents[0].coreAudience)await until(()=>slots().find(s=>s.actorId===role).calls>before[role],'合法控制epoch通知被遗漏');
  after=countMap(await stable());
  report.checks.push({name:'真实control.take增长epoch并按实际核心受众唤醒',epochBefore,epochAfter:control.controlEpoch,audience:controlEvents[0].coreAudience,before,after,status:'PASS'});

  before=after;
  await human({kind:'move',regionId:'side_path'});
  await until(()=>slots().every(s=>s.calls>before[s.actorId]),'合法可见移动Fact没有唤醒原地/到达地NPC');
  after=countMap(await stable());
  const monkey=(await latest('wukong')).context;const tang=(await latest('tangseng')).context;
  assert.equal(monkey.current.characters.find(c=>c.characterId===room.actors[0]).regionId,'side_path');
  assert.equal(tang.current.characters.find(c=>c.characterId===room.actors[0]).regionId,null);
  report.checks.push({name:'变化WorldFact唤醒相关受众，重新构造各自可见位置',before,after,status:'PASS'});

  await ai.close();
  const savedBefore=(await db.pool.query('SELECT decision_id FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows.map(r=>r.decision_id);
  const restartMarker=`停机期间合法建议-${crypto.randomUUID()}`;
  await human({kind:'speak',text:restartMarker,channel:'public',recipientIds:[]});
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows[0].count,String(savedBefore.length));
  await runtime.close();
  runtime=await createRuntime({pool:db.pool});ai=await attachMockAI({runtime,minIntervalMs:10});
  await stable();
  const savedAfter=(await db.pool.query('SELECT decision_id FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows.map(r=>r.decision_id);
  assert.ok(savedBefore.every(id=>savedAfter.includes(id)));assert.ok(savedAfter.length>savedBefore.length&&savedAfter.length<=120);
  assert.ok((await latest('wukong')).context.memory.claims.some(c=>c.text===restartMarker));
  report.checks.push({name:'新Runtime恢复Running局，处理停机期间合法Claim，保留原调用预算记录',callsBefore:savedBefore.length,callsAfter:savedAfter.length,status:'PASS'});

  const oldCounts=countMap(await stable());
  const nextRoom=await createRunningRoom(runtime,2);
  const nextSlots=await stable(nextRoom.sessionId);assert.ok(nextSlots.every(s=>s.calls>0));
  assert.deepEqual(countMap(slots()),oldCounts);
  for(const role of ['tangseng','wukong'])assert.equal((await latest(role,nextRoom.sessionId)).context.sessionId,nextRoom.sessionId);
  report.checks.push({name:'新会话自动登记两角色且不会唤醒旧会话',oldSessionBefore:oldCounts,oldSessionAfter:countMap(slots()),newSessionCalls:countMap(nextSlots),status:'PASS'});

  const endingBefore=(await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows[0].count;
  await runtime.abortSession(room.sessionId,'需求复审终局样本');
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows[0].count,endingBefore);
  assert.equal((await runtime.replay(room.sessionId)).phase,'Aborted');
  report.checks.push({name:'终局不触发新模型调用，原调度器仍负责取消在途任务',callsBefore:endingBefore,callsAfter:endingBefore,status:'PASS',inFlightCancellation:'由未改Orchestrator及本轮受影响测试单列验证，此步骤从Idle检查'});
  report.status='PASS';
}catch(error){report.status='FAIL';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await ai?.close();await runtime?.close();await db.stop();report.resourcesClosed=true;await writeFile(new URL('./wake-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
