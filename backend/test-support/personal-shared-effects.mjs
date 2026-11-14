import assert from 'node:assert/strict';

/** 只读采样与断言，供故障检查使用；不推导许可，也不改写权威状态。 */
export function sampleSharedPersonalEffects(state, context) {
  const purposes = Object.fromEntries(['appearance', 'private_items'].map(purpose => {
    const consentId = context[purpose];
    return [purpose, { consent: state.chapter.consents[consentId], request: state.chapter.personalRequests[consentId] }];
  }));
  return structuredClone({ sessionSeq: state.sessionSeq, paused: state.paused,
    actor: { id: context.actorId, epoch: state.characters[context.actorId].controlEpoch },
    disguise: state.chapter.disguise, purposes,
    held: { item: state.items[context.itemId], acquisition: state.chapter.privateAcquisitions[context.acquisitionId] } });
}

export function assertBothActiveEffects(sample) {
  for (const purpose of ['appearance', 'private_items']) {
    assert.equal(sample.purposes[purpose].consent.status, 'accepted');
    assert.equal(sample.purposes[purpose].request.execution.state, 'active', '必须是实际执行态，不能把Accepted/READY当ACTIVE');
    assert.ok(sample.purposes[purpose].request.execution.acceptedProof);
  }
  assert.equal(sample.purposes.appearance.request.execution.appearanceStarted, true);
  assert.notEqual(sample.purposes.appearance.request.execution.appearanceEnded, true);
  assert.equal(sample.disguise?.consentId, sample.purposes.appearance.consent.consentId);
  assert.equal(sample.disguise?.actorId, sample.purposes.appearance.consent.performerId);
  const { item, acquisition } = sample.held;
  assert.equal(acquisition.outcome, 'held');
  assert.equal(acquisition.originalConsentId, sample.purposes.private_items.consent.consentId);
  assert.equal(acquisition.holderId, sample.actor.id);
  assert.equal(item.personalAcquisitionId, acquisition.acquisitionId);
  assert.deepEqual(item.location, { kind: 'character', characterId: sample.actor.id });
}

export function assertSharedStoppedEffects(before, after, { systemPhase = true } = {}) {
  assertBothActiveEffects(before);
  assert.ok(BigInt(after.actor.epoch) > BigInt(before.actor.epoch), '必须有真实控制围栏失效，不以进程存在性推断停权');
  assert.equal(after.disguise, null);
  assert.equal(after.purposes.appearance.request.execution.state, 'ended');
  assert.equal(after.purposes.appearance.request.execution.appearanceEnded, true);
  assert.equal(after.purposes.private_items.request.execution.state, 'return_only');
  for (const purpose of ['appearance', 'private_items']) {
    const prior = before.purposes[purpose], current = after.purposes[purpose];
    if (systemPhase) assert.deepEqual(current.consent, prior.consent, '系统停权不得冒充本人withdraw或改写原接受');
    assert.deepEqual(current.request.execution.acceptedProof, prior.request.execution.acceptedProof);
    assert.deepEqual(current.request.proposalBinding, prior.request.proposalBinding);
  }
  assert.deepEqual(after.held.acquisition, before.held.acquisition, '共享失效不改原取得事实');
  assert.deepEqual(after.held.item.location, before.held.item.location);
  assert.equal(after.held.item.personalAcquisitionId, before.held.item.personalAcquisitionId);
}

/** 首个实际停权事务必须有自己的持久 outbox，不能拿后续 C2 的最终状态补证。 */
export function assertSharedStopTransaction(before, transaction) {
  assert.equal(transaction.committed, true);
  assert.equal(transaction.captureError, undefined);
  assertSharedStoppedEffects(before, transaction.after);
  const events = transaction.events;
  assert.ok(events.length > 0);
  assert.equal(transaction.outbox.from_exclusive, String(BigInt(events[0].sessionSeq) - 1n));
  assert.equal(transaction.outbox.through_seq, events.at(-1).sessionSeq);
  assert.equal(transaction.after.sessionSeq, transaction.outbox.through_seq);
  const controls = events.filter(event => event.kind === 'control.changed');
  assert.ok(controls.some(event => event.payload.actorId === before.actor.id && BigInt(event.payload.controlEpoch) > BigInt(before.actor.epoch)));
  for (const purpose of ['appearance', 'private_items']) {
    const notice = transaction.after.purposes[purpose].request.notice;
    assert.ok(notice && controls.some(event => event.eventId === notice.sourceEventId && event.sessionSeq === notice.sourceSeq), '两项中断通知均来自本事务真实控制变化');
  }
}

/** 收据读取单独绑定原 raw/ID 与自己的零事件事务，允许旁路时钟另有合法提交。 */
export function assertOriginalReceiptRead(original, actual, transaction, { command = 'receipt' } = {}) {
  assert.equal(JSON.parse(original.raw).clientActionId, original.receipt.clientActionId);
  assert.deepEqual(actual, original.receipt);
  assert.equal(transaction.command, command);
  assert.equal(transaction.committed, true);
  assert.equal(transaction.captureError, undefined);
  assert.deepEqual(transaction.events, [], '查询旧动作不能新增世界事件或复活许可');
  assert.deepEqual(transaction.after, transaction.before);
}

/** 沿原locked调用记录真正完成的事务；不改变操作、返回、提交或业务事件。 */
export function tracePersonalTransactions(runtime, sessionId, context) {
  const original = runtime.locked, records = [];
  runtime.locked = async function(id, command, operation) {
    if (id !== sessionId) return original.call(this, id, command, operation);
    return original.call(this, id, command, async tx => {
      const record = { command: command.kind, startedAt: new Date().toISOString() };
      try { record.before = sampleSharedPersonalEffects(tx.state, context); } catch { record.captureError = '事务前采样失败'; }
      tx.afterFinish.push(({ committed, committing }) => {
        record.committed = committed; record.committing = committing; record.endedAt = new Date().toISOString();
        try { record.after = sampleSharedPersonalEffects(tx.state, context); record.events = structuredClone(tx.events); } catch { record.captureError = '事务后采样失败'; }
        records.push(record);
      });
      return operation(tx);
    });
  };
  return { records, close() { runtime.locked = original; } };
}
