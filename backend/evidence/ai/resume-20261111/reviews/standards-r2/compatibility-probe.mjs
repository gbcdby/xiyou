import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { startTestPostgres } from './postgres.mjs';
import { createRuntime as oldRuntime } from '/workspace/scratch/17ff92cde78f/xiyou-ai/backend/runtime.mjs';
import { reserveCall as oldReserve, saveOutput as oldSave } from '/workspace/scratch/17ff92cde78f/xiyou-ai/backend/ai/persistence.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { AIOrchestrator } from '../../backend/ai/orchestrator.mjs';
import { createRunningRoom } from '../../backend/test-support/ai-room.mjs';
import { captureAI } from '../../backend/test-support/ai-evidence.mjs';
import { parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';
import { decodeStoredOutput, outputStringDigest } from '../../backend/ai/output.mjs';
import { saveOutput } from '../../backend/ai/persistence.mjs';
import { RuntimeError } from '../../backend/errors.mjs';

const reports = [];
const db = await startTestPostgres('compatibility');
const clock = Date.now();
let previous; let runtime;
const rawByDecision = new Map();
const neverGenerate = () => new ModelGateway({provider:{kind:'controlled',providerId:'review-recovery',generate(){throw new Error('恢复不应调用供应商');}},modelId:'unused'});
const runRow = async (sessionId,decisionId) => (await db.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2',[sessionId,decisionId])).rows[0];
const receiptCount = async (sessionId,decisionId) => Number((await db.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[sessionId,`${decisionId}:fallback`])).rows[0].count);

try {
  previous = await oldRuntime({pool:db.pool,now:()=>clock});
  assert.equal((await db.pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='ai_runs' AND column_name='output_encoding'")).rowCount,0);
  const legacy = [];
  for (const name of ['旧正常 Ready','旧 NUL Ready','旧已提交但未标记 Resolved']) {
    const room = await createRunningRoom(previous);
    const handle = await previous.bindInternal(room.sessionId,'tangseng','core_npc');
    const prepared = await previous.prepareDecisionContext(handle);
    const decisionId = prepared.decision.decisionId;
    const raw = name==='旧 NUL Ready'
      ? JSON.stringify({decisionId,toolCalls:[{kind:'inspect',targetId:'passage_structure'}],dialogue:{text:'核查'+String.fromCharCode(0),channel:'public',recipientIds:[]}})
      : `{ "decisionId": "${decisionId}", "toolCalls": [{"kind":"inspect","targetId":"passage_structure"}] }`;
    const semanticDigest = intentSemanticDigestSync(parseProposedIntent(raw,decisionId));
    await oldReserve(previous,handle,prepared,{providerKind:'controlled',modelId:'legacy'},1);
    await oldSave(previous,handle,decisionId,{status:'Valid',rawText:raw,semanticDigest});
    let committed = null;
    if(name==='旧已提交但未标记 Resolved') committed = await previous.submitIntent(handle,decisionId,raw);
    const before = await runRow(room.sessionId,decisionId);
    assert.equal(before.output_raw,raw); assert.equal(before.status,'Ready');
    legacy.push({name,room,decisionId,raw,semanticDigest,committed,before});
    rawByDecision.set(decisionId,raw);
  }
  await previous.close(); previous = null;
  runtime = await createRuntime({pool:db.pool,now:()=>clock});
  await runtime.migrate();
  assert.equal((await db.pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='ai_runs' AND column_name='output_encoding'")).rowCount,1);
  for (const item of legacy) {
    const {name,room,decisionId,raw,semanticDigest,committed,before}=item;
    const afterMigration=await runRow(room.sessionId,decisionId);
    assert.equal(afterMigration.output_encoding,null);
    assert.equal(afterMigration.output_raw,before.output_raw);
    assert.deepEqual(afterMigration.model_result,before.model_result);
    const handle=await runtime.bindInternal(room.sessionId,'tangseng','core_npc');
    const gateway=neverGenerate(); const ai=new AIOrchestrator({runtime,gateway});
    try {
      ai.watch(handle,{wake:false,autoWake:false});
      if(name==='旧 NUL Ready') {
        runtime.hooks={beforeCommit({command}){if(command==='internal-receipt')throw new RuntimeError('OUTCOME_UNKNOWN','受控查询未知');}};
        await assert.rejects(ai.recover(handle),{code:'OUTCOME_UNKNOWN'});
        assert.equal(ai.status(handle).phase,'Unknown');
        assert.equal((await runtime.decisionState(handle,decisionId)).status,'Pending');
        assert.equal(await receiptCount(room.sessionId,decisionId),0);
        reports.push({case:'旧 NUL 查询未知',decision:'Pending',phase:ai.status(handle).phase,fallbackCount:0});
        runtime.hooks={};
      }
      const beforeState=await runtime.replay(room.sessionId);
      await ai.recover(handle); await ai.recover(handle);
      const saved=await runRow(room.sessionId,decisionId);
      assert.equal(saved.output_raw,raw); assert.equal(saved.output_encoding,null); assert.equal(saved.semantic_digest,semanticDigest);
      assert.deepEqual(saved.model_result,before.model_result); assert.equal(saved.status,'Resolved');
      const receipt=await runtime.internalReceipt(handle,`${decisionId}:submit`);
      if(name==='旧 NUL Ready') {
        assert.equal(receipt,null); assert.equal(saved.outcome.rejectionReason,'UNPERSISTABLE_INTENT');
        assert.equal((await runtime.decisionState(handle,decisionId)).status,'Rejected');
        assert.equal(await receiptCount(room.sessionId,decisionId),1);
        assert.deepEqual(await runtime.replay(room.sessionId),beforeState);
      } else {
        assert.equal(receipt.status,'Accepted'); assert.equal(receipt.semanticDigest,semanticDigest);
        if(committed){assert.deepEqual(receipt,committed);assert.deepEqual(await runtime.replay(room.sessionId),beforeState);}
        assert.equal(await receiptCount(room.sessionId,decisionId),0);
      }
      assert.equal(gateway.metrics().calls,0);
      reports.push({case:name,migrationPreservedRaw:true,legacyEncoding:saved.output_encoding,decision:(await runtime.decisionState(handle,decisionId)).status,receipt:receipt?.status??null,fallbackCount:await receiptCount(room.sessionId,decisionId),providerCalls:gateway.metrics().calls});
    } finally {runtime.hooks={};await ai.close();}
  }

  const distinct=[];
  for(const unit of [0xd800,0xdc00]) {
    const room=await createRunningRoom(runtime); const raw='{bad'+String.fromCharCode(unit);
    const child=fork(fileURLToPath(new URL('../../backend/test-support/ai-crash-worker.mjs',import.meta.url)),[],{stdio:['ignore','pipe','pipe','ipc']});
    let stderr='';const messages=[];child.stderr.on('data',d=>{stderr+=d;});child.stdout.resume();child.on('message',m=>messages.push(m));
    const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});
    let timer;
    try {
      child.send({phase:'after-output',rawText:raw,connection:db.connection,sessionId:room.sessionId,token:room.users[0].token});
      const ended=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('子进程未按时退出'));},10000);})]);
      assert.equal(ended.exitCode,81,stderr);assert.equal(ended.signal,null);
      const decisionId=messages.find(m=>m.type==='prepared').decisionId;
      const row=await runRow(room.sessionId,decisionId);
      assert.equal(decodeStoredOutput(row),raw);assert.equal(row.output_raw,JSON.stringify(raw));
      assert.equal(row.model_result.outputStringDigest,outputStringDigest(raw));assert.equal(row.model_result.status,'Invalid');
      rawByDecision.set(decisionId,raw);distinct.push(row.model_result.outputStringDigest);
      const handle=await runtime.bindInternal(room.sessionId,'tangseng','core_npc');const gateway=neverGenerate();const ai=new AIOrchestrator({runtime,gateway});
      try {
        ai.watch(handle,{wake:false,autoWake:false});await ai.recover(handle);
        await saveOutput(runtime,handle,decisionId,{status:'Invalid',rawText:raw});
        await assert.rejects(saveOutput(runtime,handle,decisionId,{status:'Invalid',rawText:'{bad'+String.fromCharCode(0xfffd)}),{code:'ACTION_ID_REUSE'});
        await ai.recover(handle);
        const saved=await runRow(room.sessionId,decisionId);
        assert.equal(decodeStoredOutput(saved).charCodeAt(4),unit);assert.equal(saved.output_raw,row.output_raw);
        assert.equal(saved.status,'Resolved');assert.equal((await runtime.decisionState(handle,decisionId)).status,'Rejected');
        assert.equal(await receiptCount(room.sessionId,decisionId),1);assert.equal(gateway.metrics().calls,0);
        reports.push({case:`孤立码元${unit.toString(16)}`,exit:ended,preservedCodeUnit:decodeStoredOutput(saved).charCodeAt(4),outputStringDigest:saved.model_result.outputStringDigest,fallbackCount:1,recoveryProviderCalls:0});
      } finally {await ai.close();}
    } finally {clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exit;}
  }
  assert.equal(new Set(distinct).size,2);
  assert.throws(()=>decodeStoredOutput({output_raw:'"a"',output_encoding:'other'}),{code:'INVALID_MESSAGE'});
  assert.throws(()=>decodeStoredOutput({output_raw:'[]',output_encoding:'json-string-v1'}),{code:'INVALID_MESSAGE'});
  assert.throws(()=>decodeStoredOutput({output_raw:'"a"',output_encoding:'json-string-v1',model_result:{outputStringDigest:outputStringDigest('b')}}),{code:'INVALID_MESSAGE'});
  process.env.XIYOU_AI_EVIDENCE_DIR=fileURLToPath(new URL('./captures/',import.meta.url));
  await captureAI(db,'review');
  const capture=JSON.parse(await readFile(new URL('./captures/review.json',import.meta.url),'utf8'));
  for(const row of capture.runs) assert.equal(row.output_raw,rawByDecision.get(row.decision_id));
  reports.push({case:'取证消费者与损坏拒绝',capturedRuns:capture.runs.length,rawCodeUnitsPreserved:true,unknownEncodingRejected:true,nonStringPayloadRejected:true,digestMismatchRejected:true});
} finally {delete process.env.XIYOU_AI_EVIDENCE_DIR;await previous?.close();await runtime?.close();await db.stop();}
const result={node:process.version,clock:'固定逻辑时钟以隔离过期条件',databaseOutput:db.output,externalCalls:0,reports};
await writeFile(new URL('./compatibility-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
