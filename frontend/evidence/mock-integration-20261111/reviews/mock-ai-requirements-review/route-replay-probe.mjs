import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startTestPostgres } from './postgres.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { createRunningRoom, actionRaw } from '../../backend/test-support/ai-room.mjs';
import { createMockProvider, mockPolicies } from '../../backend/ai/mock-provider.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { reserveCall, saveOutput, saveOutcome } from '../../backend/ai/persistence.mjs';

const report={candidate:'c2511f4a81d29502aed4c122cd701d3c3632d237',scope:'真实PG、原始Gateway上下文和未修改provider；两次合法路线输入后，检查旧请求是否复活并产生反复移动。逐次驱动真实Decision/预留/提交，未启用自动调度，不计为60秒观察。',actions:[],decisions:[],moves:[]};
const db=await startTestPostgres('req-route-replay');let runtime;let gateway;
try {
  runtime=await createRuntime({pool:db.pool});
  const room=await createRunningRoom(runtime,2);report.sessionId=room.sessionId;
  const handle=await runtime.bindInternal(room.sessionId,'wukong','core_npc');
  gateway=new ModelGateway({provider:createMockProvider('wukong'),modelId:mockPolicies.wukong.modelId});
  async function human(action){
    const receipt=await runtime.submit(room.connections[0],actionRaw(room,0,action));
    assert.equal(receipt.status,'Accepted');report.actions.push({action,receipt:{status:receipt.status,range:receipt.actionEventRange}});
  }
  async function step(){
    const prepared=await runtime.prepareDecisionContext(handle);
    assert.equal((await reserveCall(runtime,handle,prepared,gateway.configuration(),120)).reserved,true);
    const output=await gateway.generate(prepared.context);assert.equal(output.status,'Valid');
    await saveOutput(runtime,handle,prepared.decision.decisionId,output);
    const receipt=await runtime.submitIntent(handle,prepared.decision.decisionId,output.rawText);
    await saveOutcome(runtime,handle,prepared.decision.decisionId,{decisionStatus:(await runtime.decisionState(handle,prepared.decision.decisionId)).status,receipt,fallback:null});
    assert.equal(receipt.status,'Accepted');
    const tools=JSON.parse(output.rawText).toolCalls;
    report.decisions.push({decisionId:prepared.decision.decisionId,region:prepared.context.current.self.regionId,tools,receipt:{status:receipt.status,range:receipt.actionEventRange},routeClaims:prepared.context.memory.claims.filter(c=>c.speakerId!== 'wukong' && c.text.startsWith('出口 ')).map(c=>({claimId:c.claimId,text:c.text}))});
    for(const tool of tools)if(tool.kind==='move')report.moves.push({from:prepared.context.current.self.regionId,to:tool.regionId,decisionId:prepared.decision.decisionId,humanInputs:report.actions.length});
  }
  await human({kind:'move',regionId:'side_path'});
  await human({kind:'speak',text:'出口 store',channel:'public',recipientIds:[]});
  for(let i=0;i<50 && report.moves.length<1;i++)await step();
  assert.equal(report.moves[0]?.to,'store');
  await human({kind:'move',regionId:'store'});
  await human({kind:'speak',text:'出口 side_path',channel:'public',recipientIds:[]});
  for(let i=0;i<60 && report.moves.length<4;i++)await step();
  const state=await runtime.replay(room.sessionId);
  report.final={phase:state.phase,region:state.characters.wukong.regionId};
  report.replayedWithoutNewInput=report.moves.length>=4 && report.moves.slice(1).every(move=>move.humanInputs===4);
  report.status='OBSERVED';
}catch(error){report.status='PROBE_ERROR';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{await gateway?.close();await runtime?.close();await db.stop();await writeFile(new URL('./route-replay-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,decisions:report.decisions.length,moves:report.moves,replayedWithoutNewInput:report.replayedWithoutNewInput,error:report.error?.message}));}
