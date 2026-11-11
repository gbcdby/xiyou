import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startTestPostgres } from './postgres.mjs';
import { createMockServer } from '../../backend/mock-main.mjs';
import { createRunningRoom, actionRaw } from '../../backend/test-support/ai-room.mjs';
import { decodeStoredOutput } from '../../backend/ai/output.mjs';

const report = { candidate: '71aad48878c532521919c72511c023285785d7e7', clock: 'real', schedulingIntervalMs: 10, maxCallsPerSession: 120,
  scope: '五人标准内容合法输入，经真实 Runtime、双 provider/Gateway/Orchestrator 和 PostgreSQL；缩短公开可配的调度间隔以检查有限调用预算，不计作60秒观察或整局验收。', phases: [], actions: [] };
const db = await startTestPostgres('req-mock-priority');
let server; let room;
try {
  server = await createMockServer({ pool: db.pool, minIntervalMs: 10 });
  const runtime = server.runtime;
  room = await createRunningRoom(runtime, 5);
  report.sessionId = room.sessionId;
  const world = () => runtime.replay(room.sessionId);
  const calls = async () => Number((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count);
  async function settle(label) {
    const end = Date.now() + 180000;
    let statuses; let state;
    while (true) {
      statuses = server.ai.status().roles.map(role => ({ actorId: role.actorId, calls: role.metrics.calls, ...role.sessions.find(s => s.sessionId === room.sessionId) }));
      if ((statuses.every(s => ['Idle', 'BudgetExhausted', 'Unavailable'].includes(s.phase) && !s.pendingWake) && server.ai.status().roles.every(role => role.metrics.active === 0))) break;
      if (Date.now() >= end) throw new Error(`阶段未收束：${label} ${JSON.stringify(statuses)}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    state = await world();
    const phase = { label, phase: state.phase, calls: await calls(), roles: statuses,
      locations: Object.fromEntries(['tangseng','wukong'].map(id => [id,state.characters[id].regionId])),
      gate: state.targets.passage_structure.fields };
    report.phases.push(phase); console.log(JSON.stringify(phase));
    return state;
  }
  async function human(index, action) {
    const raw = actionRaw(room, index, action);
    const receipt = await runtime.submit(room.connections[index], raw);
    report.actions.push({ actor: index, action, status: receipt.status, code: receipt.code, actionEventRange: receipt.actionEventRange });
    assert.equal(receipt.status, 'Accepted', `${index}/${action.kind}: ${receipt.code}`);
    return receipt;
  }
  async function move(index, regionId) {
    if ((await world()).characters[room.actors[index]].regionId !== regionId) await human(index, { kind:'move', regionId });
  }
  async function share(index, sourceId, recipientId) {
    const projection = (await runtime.snapshot(room.users[index].token, room.sessionId)).projection;
    const source = projection.observations.find(o => o.category === 'Evidence' && o.source.sourceIds.includes(sourceId));
    assert.ok(source, sourceId);
    await human(index, { kind:'share_evidence', evidenceId:source.observationId, recipientIds:[recipientId] });
  }
  await settle('五身份开局主动行为');
  await human(0, { kind:'inspect', targetId:'passage_structure' });
  await human(4, { kind:'inspect', targetId:'stock_record' });
  await human(3, { kind:'inspect', targetId:'material_cache' });
  await human(3, { kind:'take_item', itemId:'original_material', expectedItemRevision:'0' });
  for (let i=0;i<5;i++) await move(i,'side_path');
  for (const [i,id] of [[0,'structure-before-arrival'],[0,'structure-current-trace'],[4,'authorized-movement-register'],[3,'material-site-trace']]) await share(i,id,'wukong');
  await human(0,{kind:'speak',channel:'public',recipientIds:[],text:'请从出口 passage 前往通路口，我们按实际条件协调修复。'});
  const afterRoute = await settle('五人提供合法核验来源并请求悟空前往通路口');
  if (afterRoute.characters.wukong.regionId !== 'passage') {
    report.observation = '悟空未执行当前可见且合法的passage路线请求';
  } else {
    for (let i=0;i<5;i++) await move(i,'passage');
    await settle('五人携材料与工具在通路口会合');
    await human(1,{kind:'transfer_item',itemId:'repair_tool',targetId:room.actors[3],expectedItemRevision:'0'});
    await settle('工具已合法交接');
    await human(3,{kind:'use_item',itemIds:['original_material','repair_tool'],expectedItemRevisions:{original_material:'1',repair_tool:'1'},targetId:'passage_structure',expectedTargetRevision:'0',operation:'repair'});
    await settle('玩家实际修复后');
    await human(2,{kind:'interact',targetId:'passage_structure',expectedTargetRevision:'1',operation:'grant_passage'});
    await human(0,{kind:'speak',channel:'public',recipientIds:[],text:'请从出口 destination 通行。'});
    const final = await settle('实际安全与许可均满足且公开明确终点后');
    report.observation = final.characters.tangseng.regionId === 'destination' && final.characters.wukong.regionId === 'destination'
      ? '两角色均执行实际通行' : '合法通行请求未由两角色完成';
  }
  report.final = await world();
  report.final = { phase:report.final.phase, locations:Object.fromEntries(['tangseng','wukong'].map(id=>[id,report.final.characters[id].regionId])),gate:report.final.targets.passage_structure.fields, ending:report.final.ending };
  const rows=(await db.pool.query('SELECT actor_id,decision_id,context,output_raw,output_encoding,configuration,outcome FROM ai_runs WHERE session_id=$1 ORDER BY created_at,decision_id',[room.sessionId])).rows;
  report.runs=rows.map(row=>({actorId:row.actor_id,decisionId:row.decision_id,location:row.context.current.self.regionId,observationCount:row.context.memory.observations.length,ownClaimCount:row.context.memory.claims.filter(c=>c.speakerId===row.actor_id).length,
    tools:row.output_raw===null?null:JSON.parse(decodeStoredOutput(row)).toolCalls,receipt:row.outcome?.receipt?{status:row.outcome.receipt.status,code:row.outcome.receipt.code,range:row.outcome.receipt.actionEventRange}:null}));
  report.totalCalls=rows.length;
  report.status='OBSERVED';
} catch(error) {
  report.status='PROBE_ERROR'; report.error={message:error.message,stack:error.stack}; process.exitCode=1;
} finally {
  await server?.close(); await db.stop();
  await writeFile(new URL('./priority-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,totalCalls:report.totalCalls,observation:report.observation,error:report.error?.message}));
}
