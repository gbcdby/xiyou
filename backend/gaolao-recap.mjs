import {createHash} from 'node:crypto';
import {validateSpatial} from '../protocol/spatial.mjs';
import {decodeJsonbText} from './jsonb-text.mjs';
import {validateQuery} from './recap.mjs';
import {RuntimeError} from './errors.mjs';
/** 不重新渲染真实actor/owner；只读取发生时已经存下的安全表示。 */
export async function readGaolaoRecap(runtime,token,sessionId,query){
  validateQuery(query);
  return runtime.locked(sessionId,{kind:'gaolao-recap'},async tx=>{
    const user=await runtime.access(tx.client,tx.row,token);
    if(!['Finished','Aborted'].includes(tx.state.phase))throw new RuntimeError('FORBIDDEN','本局尚未结束。');
    if(query.throughSeq!==tx.state.sessionSeq)throw new RuntimeError('RESYNC_REQUIRED','请读取当前终态水位。');
    const rows=(await tx.client.query(`SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq<=$2::numeric AND ($3::numeric IS NULL OR session_seq<$3::numeric) AND ((event->>'kind'='spatial.observation' AND event->'payload'->>'observerId'=$4) OR (event->>'kind'='spatial.claim' AND (event->'payload'->'views') ? $4) OR event->>'kind' IN ('session.finished','session.aborted')) ORDER BY session_seq DESC LIMIT 101`,[sessionId,query.throughSeq,query.beforeSeq??null,user.actorId])).rows;
    const entries=rows.slice(0,100).map(row=>{
      const e=decodeJsonbText(row.event,row.event_text_encoding),p=e.payload;
      if(e.kind==='spatial.observation'){const o=p.observation;return {entryRef:o.observationRef,eventSeq:e.sessionSeq,category:o.category,text:o.statement,fields:o.fields};}
      if(e.kind==='spatial.claim'){const c=p.views[user.actorId];return {entryRef:c.claimRef,eventSeq:e.sessionSeq,category:'Claim',text:c.text,fields:[],speakerRef:c.speakerRef,speakerName:c.speakerName};}
      return {entryRef:'R'+createHash('sha256').update(sessionId+':'+e.sessionSeq).digest('base64url'),eventSeq:e.sessionSeq,category:'WorldFact',text:p.summary??p.reason,fields:p.facts??[]};
    });
    return validateSpatial('RecapV2',{schemaVersion:2,type:'session.recap',sessionId,throughSeq:query.throughSeq,phase:tx.state.phase,ending:tx.state.ending,entries,nextBeforeSeq:rows.length>100?entries.at(-1).eventSeq:null});
  });
}
