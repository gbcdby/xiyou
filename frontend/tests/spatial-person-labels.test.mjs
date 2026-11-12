import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialPersonLabels } from '../src/domain/spatial-person-labels.ts';

test('同名临时标记按公开引用绑定，重排和暂离不把编号换给另一个人', () => {
  const labels = new SpatialPersonLabels(); const first = { entityRef: 'A', name: '翠兰' }; const second = { entityRef: 'B', name: '翠兰' };
  assert.deepEqual(labels.update('view-one', [first]), { A: '1号 · 翠兰' });
  assert.deepEqual(labels.update('view-one', [first, second]), { A: '1号 · 翠兰', B: '2号 · 翠兰' });
  assert.deepEqual(labels.update('view-one', [second, first]), { B: '2号 · 翠兰', A: '1号 · 翠兰' });
  assert.deepEqual(labels.update('view-one', [second]), { B: '2号 · 翠兰' });
  assert.deepEqual(labels.update('view-one', [first, second]), { A: '1号 · 翠兰', B: '2号 · 翠兰' });
});

test('新视图重新分配、失权清空；只返回当前合法人物称呼，不输出原引用或旧姓名', () => {
  const labels = new SpatialPersonLabels();
  labels.update('old-view', [{ entityRef: 'A', name: '获准称呼' }, { entityRef: 'B', name: '获准称呼' }]);
  assert.deepEqual(labels.update('new-view', [{ entityRef: 'B', name: '翠兰' }, { entityRef: 'A', name: '翠兰' }]), { B: '1号 · 翠兰', A: '2号 · 翠兰' });
  assert.deepEqual(labels.update(null, []), {});
  assert.deepEqual(labels.update('new-view', [{ entityRef: 'A', name: '当前可见称呼' }]), { A: '1号 · 当前可见称呼' });
  labels.clear(); assert.deepEqual(labels.update('new-view', [{ entityRef: 'B', name: '翠兰' }]), { B: '1号 · 翠兰' });
});

test('合法姓名包含编号格式时，最终可见标记仍各自唯一', () => {
  const labels = new SpatialPersonLabels();
  const result = labels.update('view', [{ entityRef: 'A', name: '翠兰' }, { entityRef: 'B', name: '翠兰' }, { entityRef: 'C', name: '翠兰 · 1号' }, { entityRef: 'D', name: '1号 · 翠兰' }, { entityRef: 'E', name: '2号 · 翠兰' }]);
  assert.equal(new Set(Object.values(result)).size, 5);
});
