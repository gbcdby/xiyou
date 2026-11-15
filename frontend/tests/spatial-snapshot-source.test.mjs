import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, defineComponent, h, shallowRef, watch, nextTick } from 'vue';
import { createSpatialSnapshotSource } from '../src/domain/spatial-snapshot-source.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';

const snapshot = seq => ({ ...spatialSnapshot(), snapshotSeq: seq });
test('SUP-04：真实Vue props合并45/48时，稳定source逐条入Motion且当前绘制输入为48', async () => {
  const { source, publish } = createSpatialSnapshotSource(), first = snapshot('40'), propsSeen = [], motionSeen = [], motion = new ConfirmedMotion();
  first.projection.sceneTimeMs = 0; first.projection.self.position = { x: 0, y: 0 }; first.projection.entities[0].position = { x: 0, y: 0 };
  const state = shallowRef(first);
  publish(state.value);
  const subscription = source.subscribe(value => { if (value) { motionSeen.push(value.snapshotSeq); motion.update(value, 0); } else motion.reset(); }, () => assert.fail('有效输入不应隔离'));
  const Child = defineComponent({ props: ['snapshot'], setup(props) { watch(() => props.snapshot, value => propsSeen.push(value.snapshotSeq), { immediate: true, flush: 'sync' }); return () => h('canvas'); } });
  const host = { createElement: tag => ({ tag, children: [] }), createText: text => ({ text }), createComment: text => ({ text }), setText() {}, setElementText() {}, parentNode: n => n.parent || null, nextSibling: () => null, insert(n, p) { n.parent = p; p.children.push(n); }, remove() {}, patchProp() {} };
  const app = createRenderer(host).createApp({ setup: () => () => h(Child, { snapshot: state.value }) }); app.mount({ children: [] });
  const next = (seq, from, through, x) => {
    const value = structuredClone(first); value.snapshotSeq = seq; value.projection.sceneTimeMs = through; value.projection.self.position = { x, y: 0 };
    Object.assign(value.projection.entities[0], { position: { x, y: 0 }, motionTrail: [{ x: x - 10, y: 0 }, { x, y: 0 }], motionFromSceneTimeMs: from, motionThroughSceneTimeMs: through,
      motionTimeline: [{ kind: 'motion', fromSceneTimeMs: from, throughSceneTimeMs: through, fromTrailIndex: 0, throughTrailIndex: 1 }] }); return value;
  };
  const middle = next('45', 0, 100, 10), latest = next('48', 100, 200, 20); state.value = middle; publish(middle); state.value = latest; publish(latest);
  assert.equal(subscription.current, latest, '父props还未刷新时，owner的成功消费输入已经是48');
  assert.deepEqual(propsSeen, ['40']); assert.deepEqual(motionSeen, ['40', '45', '48']);
  await nextTick(); assert.deepEqual(propsSeen, ['40', '48']); assert.equal(motion.presentationCreditMs, 0, '同步状态回调不是paint');
  assert.equal(motion.pose(selfRef, 50).position.x, 5); assert.equal(motion.pose(selfRef, 150).position.x, 15); assert.equal(motion.pose(selfRef, 200).distance, 20);
  subscription.close(); app.unmount();
});
test('SUP-04：同身份同seq通知去重，换binding先reset，新挂载只读当前基线', () => {
  const { source, publish } = createSpatialSnapshotSource(), seen = [];
  const subscription = source.subscribe(value => seen.push(value?.snapshotSeq ?? null), assert.fail);
  publish(snapshot('40')); publish(snapshot('40')); const next = snapshot('41'); next.viewId = 'new-view'; publish(next);
  assert.deepEqual(seen, [null, '40', null, '41']);
  const mounted = []; const second = source.subscribe(value => mounted.push(value?.snapshotSeq ?? null), assert.fail);
  assert.deepEqual(mounted, ['41']); subscription.close(); publish(snapshot('42')); assert.equal(subscription.current, null);
  second.close(); publish(null); assert.equal(source.current, null);
});
test('SUP-04：失败owner清信用并隔离，其他owner继续；只有明确重新订阅从当前基线恢复', () => {
  const { source, publish } = createSpatialSnapshotSource(), motion = new ConfirmedMotion(), good = [], bad = []; let failures = 0;
  const failed = source.subscribe(value => { if (value?.snapshotSeq === '45') throw new Error('受控显示失败'); bad.push(value?.snapshotSeq ?? null); }, () => { failures++; motion.invalidatePresentation(); motion.reset(); });
  const healthy = source.subscribe(value => good.push(value?.snapshotSeq ?? null), assert.fail);
  publish(snapshot('40')); publish(snapshot('45')); publish(snapshot('48'));
  assert.equal(failures, 1); assert.equal(failed.current, null); assert.deepEqual(bad, [null, '40']); assert.deepEqual(good, [null, '40', '45', '48']);
  assert.equal(motion.presentationCreditMs, 0); assert.equal(motion.pose(selfRef, 0), null);
  const resumed = source.subscribe(value => bad.push(value?.snapshotSeq ?? null), assert.fail); assert.equal(resumed.current.snapshotSeq, '48'); assert.equal(bad.at(-1), '48');
  healthy.close(); resumed.close();
});
