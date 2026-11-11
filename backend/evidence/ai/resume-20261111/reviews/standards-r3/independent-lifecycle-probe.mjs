import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import EmbeddedPostgres from 'embedded-postgres';
import { startTestPostgres } from './postgres-fixed.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const events=[];const errors=[];const gates=[deferred(),deferred()];const endings=[deferred(),deferred()];
const poolFinished=deferred();let database;let poolEndCalls=0;
const originalStop=EmbeddedPostgres.prototype.stop;
EmbeddedPostgres.prototype.stop=async function(...args){events.push('postgres.stop.begin');const result=await originalStop.apply(this,args);events.push('postgres.stop.end');return result;};
try{
  database=await startTestPostgres('independent-lifecycle');
  database.pool.on('error',error=>{errors.push({code:error.code??error.name,message:error.message});});
  const clients=await Promise.all([database.pool.connect(),database.pool.connect()]);
  clients.forEach((client,index)=>{
    client.once('end',()=>{events.push(`client.${index}.end`);endings[index].resolve();});
    const end=client.end.bind(client);
    client.end=callback=>{
      events.push(`client.${index}.end.requested`);
      if(callback){gates[index].promise.then(()=>end(callback));return;}
      return gates[index].promise.then(()=>end());
    };
    client.release();
  });
  const poolEnd=database.pool.end.bind(database.pool);
  database.pool.end=async()=>{poolEndCalls++;await poolEnd();events.push('pool.end.resolved');poolFinished.resolve();};
  const first=database.stop();const concurrent=database.stop();
  assert.strictEqual(first,concurrent,'并发stop必须返回同一Promise');
  await poolFinished.promise;
  assert.equal(events.includes('postgres.stop.begin'),false);
  gates[1].resolve();await endings[1].promise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(events.includes('postgres.stop.begin'),false,'一个真实连接已结束时仍须等待另一个');
  assert.equal(events.includes('client.0.end'),false);
  gates[0].resolve();await first;
  assert.strictEqual(database.stop(),first,'已完成stop仍复用同一Promise');
  assert.equal(poolEndCalls,1);
  assert.ok(events.indexOf('pool.end.resolved')<events.indexOf('client.1.end'));
  assert.ok(events.indexOf('client.1.end')<events.indexOf('client.0.end'));
  assert.ok(events.indexOf('client.0.end')<events.indexOf('postgres.stop.begin'));
  assert.equal(events.filter(x=>x==='postgres.stop.begin').length,1);
  assert.deepEqual(errors,[]);
  const result={node:process.version,events,errors,poolEndCalls,concurrentStopSamePromise:true,completedStopSamePromise:true,waitedForBothClients:true,postgresOutput:database.output,actualExternalModelCalls:0};
  await writeFile(new URL('./independent-lifecycle-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{
  for(const gate of gates)gate.resolve();
  try{await database?.stop();}finally{EmbeddedPostgres.prototype.stop=originalStop;}
}
