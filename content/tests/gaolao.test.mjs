import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent, contentDigest } from '../index.mjs';
import { validateSpatialContent } from '../spatial.mjs';
import { findPath, inPolygon } from '../../game/spatial-geometry.mjs';
test('高老庄独立版本声明2–5人职责、三自主角色和两个真实内室安置点', async()=>{
  const c=await loadContent('gaolaozhuang-v1');
  assert.equal(c.reducerVersion,'gaolao-world-v1');
  assert.deepEqual(c.chapterRules.partyRoles['2'],[['A','B','D'],['C','E']]);
  assert.deepEqual(c.chapterRules.partyRoles['3'],[['A','B'],['C'],['D','E']]);
  assert.deepEqual(c.chapterRules.partyRoles['4'],[['A'],['B'],['C'],['D','E']]);
  assert.deepEqual(c.chapterRules.partyRoles['5'],[['A'],['B'],['C'],['D'],['E']]);
  assert.equal(c.npcs.filter(x=>['persistent_core','chapter_autonomous'].includes(x.actorKind)).length,3);
  for(const d of c.chapterRules.safeDestinations){const scene=c.scenes.find(s=>s.sceneId===d.sceneId);assert.ok(inPolygon(d.position,scene.walkableAreas.find(a=>a.areaId===d.areaId).polygon));assert.ok(findPath(scene,d.position,d.exitPosition,()=>false));}
  assert.equal(contentDigest(c).length,64);
  const bad=structuredClone(c);bad.chapterRules.partyRoles['2']=[['A'],['B']];assert.throws(()=>validateSpatialContent(bad));
});
test('高老庄配置拒绝伪独立来源、Claim升级、缺失去向和私物公共化',async()=>{
  const content=await loadContent('gaolaozhuang-v1');
  for(const mutate of [c=>{c.chapterRules.sources[1].sourceId='old-ledger';},c=>{c.chapterRules.sources[1].category='Evidence';},c=>{c.chapterRules.sources[0].beforeArrivalDays=0;},c=>{c.chapterRules.endings[0].departureActorIds.pop();},c=>{c.items.find(i=>i.itemId==='gz-parcel').publicBorrowable=true;},c=>{c.chapterRules.people.cuilan=c.chapterRules.people.gao;},c=>{c.targets[0].operationIds.push('gz-set-world-fact');}]){const bad=structuredClone(content);mutate(bad);assert.throws(()=>validateSpatialContent(bad));}
});
