import test from 'node:test';
import assert from 'node:assert/strict';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {createAuthorityServer} from '../server.mjs';
import {gaolaoNetworkAdapter} from '../test-support/gaolao-network.mjs';
import {gaolaoRoom,fullChapter,accepted,confirmEnd} from '../test-support/gaolao-room.mjs';
import {validateSpatial} from '../../protocol/spatial.mjs';
test('真实HTTP/Socket：2/3/4/5独立客户端全章与2/5人乔装/公开、同行/分别矩阵',async t=>{
  const db=await startTestPostgres('gaolao-network',{outputSubdirectory:'adv001-32'}),clock={value:Date.parse('2026-11-12T19:00:00Z')};let server,net;
  t.after(async()=>{await net?.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});const address=await server.listen(0);net=gaolaoNetworkAdapter(server,`http://127.0.0.1:${address.port}`);
  const cases=[];for(const count of [2,5])for(const route of ['public','disguise'])for(const ending of ['GZ-E01','GZ-E02'])cases.push({count,route,ending,version:route==='public'?'gaolaozhuang-v1':'gaolaozhuang-tools-east-v1'});for(const count of [3,4])cases.push({count,route:'public',ending:'GZ-E01',version:'gaolaozhuang-v1'});
  for(const c of cases){
    const r=await gaolaoRoom(net,clock,c.count,c.version),starts=await Promise.all(r.users.map((_,i)=>r.snapshot(i)));
    await fullChapter(r,c);
    for(let i=0;i<c.count;i++){
      const s=await r.snapshot(i);assert.equal(s.projection.ending.endingCode,c.ending,JSON.stringify(c));const recap=await net.recap(r.users[i].token,r.sessionId,{throughSeq:s.snapshotSeq});validateSpatial('RecapV2',recap);assert.ok(recap.entries.length);
      let cursor=starts[i].snapshotSeq;for(let page=0;BigInt(cursor)<BigInt(s.snapshotSeq)&&page<100;page++){const batch=await net.sync(r.handles[i],JSON.stringify({schemaVersion:2,type:'sync.request',sessionId:r.sessionId,viewId:s.viewId,cursor}));validateSpatial('BatchV2',batch);assert.ok(BigInt(batch.throughSeq)>BigInt(cursor));cursor=batch.throughSeq;}assert.ok(BigInt(cursor)>=BigInt(s.snapshotSeq));
    }
    const state=await server.runtime.replay(r.sessionId);assert.equal(state.chapter.cuilanSafe,true);assert.equal(state.ending.endingCode,c.ending);assert.equal(new Set(r.handles.map(s=>s.id)).size,c.count);t.diagnostic(JSON.stringify({contentVersion:c.version,mapVersion:r.content.mapVersion,variantId:r.content.variantId,clients:c.count,route:c.route,ending:c.ending,sessionSeq:state.sessionSeq,transport:'HTTP+Socket.IO',npc:'受控有限意图',sceneClock:'受控推进，非15分钟长时证据'}));
  }
  assert.deepEqual(net.errors,[]);assert.ok(net.batches.length>0);
});
test('真实HTTP/Socket：大页复盘按授权历史分页，NUL不改写且当前资格撤销后拒绝',async t=>{
  const db=await startTestPostgres('gaolao-recap-network',{outputSubdirectory:'adv001-32'}),clock={value:Date.parse('2026-11-12T21:00:00Z')};let server,net;
  t.after(async()=>{await net?.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});const address=await server.listen(0),origin=`http://127.0.0.1:${address.port}`;net=gaolaoNetworkAdapter(server,origin);
  const r=await gaolaoRoom(net,clock,2),texts=[];let firstRaw,firstReceipt;
  for(let index=0;index<104;index++){
    const text=`第${index}条\u0000与字面\\0：`+'原文'.repeat(350);texts.push(text);const raw=await r.raw(0,{kind:'speak',text,channel:'team',recipientRefs:[]}),receipt=accepted(await net.submit(r.handles[0],raw));
    if(!index){firstRaw=raw;firstReceipt=receipt;}
  }
  await confirmEnd(r,'chapter');const terminal=await r.snapshot(0),query={throughSeq:terminal.snapshotSeq},first=await net.recap(r.users[0].token,r.sessionId,query);
  assert.ok(Buffer.byteLength(JSON.stringify(first))>65536);assert.equal(first.entries.length,100);assert.equal(first.nextBeforeSeq,first.entries.at(-1).eventSeq);assert.equal(first.phase,'Finished');
  const second=await net.recap(r.users[0].token,r.sessionId,{...query,beforeSeq:first.nextBeforeSeq});assert.equal(second.throughSeq,first.throughSeq);assert.equal(second.phase,first.phase);assert.equal(second.nextBeforeSeq,null);assert.ok(second.entries.length>0);assert.ok(second.entries.every(e=>BigInt(e.eventSeq)<BigInt(first.nextBeforeSeq)));
  const entries=[...first.entries,...second.entries];assert.equal(new Set(entries.map(e=>e.entryRef)).size,entries.length);for(const text of texts)assert.equal(entries.filter(e=>e.text===text).length,1);
  for(let index=1;index<entries.length;index++)assert.ok(BigInt(entries[index-1].eventSeq)>BigInt(entries[index].eventSeq));
  const empty=await net.recap(r.users[0].token,r.sessionId,{...query,beforeSeq:entries.at(-1).eventSeq});assert.deepEqual(empty.entries,[]);assert.equal(empty.nextBeforeSeq,null);
  assert.deepEqual(await net.submit(r.handles[0],firstRaw),firstReceipt);assert.deepEqual(await net.receipt(r.users[0].token,r.sessionId,JSON.parse(firstRaw).clientActionId),firstReceipt);
  await server.runtime.revokeAccess(r.sessionId,r.users[0].userId);const denied=await fetch(origin+`/api/sessions/${r.sessionId}/recap?throughSeq=${query.throughSeq}`,{headers:{Authorization:'Bearer '+r.users[0].token,'X-Xiyou-Capabilities':'spatial-v2'}});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'FORBIDDEN');
  assert.deepEqual(net.errors,[]);t.diagnostic(JSON.stringify({firstPageBytes:Buffer.byteLength(JSON.stringify(first)),pages:2,claimCount:texts.length,transport:'HTTP+Socket.IO',textEncoding:'NUL与字面反斜杠分别保留'}));
});
