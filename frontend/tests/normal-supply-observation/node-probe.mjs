/** 仅观察原commit通知和原enqueue；不消费proof，不补发，不读取私有槽。 */
import { createCollector, ownData, isObject } from './collector.mjs';
import { SCHEMA } from './schema.mjs';

export function createNodeProbe(config, fixtures = {}) {
  const collector = createCollector('node', config, fixtures);
  let started = false, bound = false;
  function bind(original, read, write) {
    if (bound || typeof original !== 'function' || typeof read !== 'function' || typeof write !== 'function')
      throw Error('NSO原enqueue绑定不符');
    bound = true;
    const observed = collector.observe(1, original, (_receiver, args) => {
      const input = args[0], handle = ownData(input, 'handle'), binding = ownData(input, 'binding'), value = ownData(input, 'value');
      const payload = ownData(value, 'snapshot') ?? value;
      const kind = SCHEMA.enums.packetKind.indexOf(ownData(input, 'kind'));
      const type = SCHEMA.enums.payloadType.indexOf(ownData(payload, 'type'));
      return { tail: [null, null, null, null, null, null,
        collector.text(ownData(handle, 'connectionId')), kind < 0 ? 0 : kind, type < 0 ? 0 : type,
        collector.text(ownData(payload, 'sessionId')), collector.text(ownData(payload, 'viewId')),
        collector.decimal(ownData(payload, 'fromExclusive')), collector.decimal(ownData(payload, 'throughSeq'))],
      references: [[0, input], [1, handle], [2, binding], [3, value], [4, ownData(input, 'send')], [5, ownData(input, 'current')]] };
    });
    const wrapper = function (...args) { return Reflect.apply(started ? observed : original, this, args); };
    collector.addRestore(() => { if (read() === wrapper) write(original); return read() === original; });
    write(wrapper);
    if (read() !== wrapper) throw Error('NSO enqueue导出安装不符');
    collector.raw.setup.hookCount = 1;
  }
  function activate(runtime) {
    if (started || !bound || !isObject(runtime) || typeof runtime.on !== 'function' || typeof runtime.off !== 'function')
      throw Error('NSO runtime冷入口不符');
    const listener = function (...args) {
      if (!started) return;
      collector.notification(0, this, args, (_receiver, values) => {
        const value = values[0], events = ownData(value, 'events'), length = ownData(events, 'length');
        const count = collector.integer(length);
        const first = count && ownData(events, '0'), last = count && ownData(events, String(count - 1));
        return { tail: [collector.text(ownData(value, 'sessionId')),
          collector.decimal(ownData(first, 'sessionSeq')), collector.decimal(ownData(last, 'sessionSeq')), count] };
      });
    };
    collector.addRestore(() => { runtime.off('commit', listener); return !runtime.listeners('commit').includes(listener); });
    runtime.on('commit', listener); collector.raw.setup.listenerCount = 1;
    started = true; collector.installed();
  }
  return { bind, activate, fail: collector.fail, raw: collector.raw,
    stop() { started = false; return collector.stop(); } };
}
