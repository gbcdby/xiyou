/** NSO Page仅MI-03三个入口；不安装DOM/set/emit观察。 */
import { createCollector, ownData, sameDescriptor } from './collector.mjs';
import { SCHEMA } from './schema.mjs';

export async function installPageProbe(config, fixtures = {}) {
  const collector = createCollector('page', config, fixtures), host = fixtures.host ?? globalThis;
  const key = '__xiyouNormalSupplyObservation';
  const api = { stop: collector.stop };
  try {
    if (Object.getOwnPropertyDescriptor(host, key)) throw Error('NSO Page入口已占用');
    let { Manager, Socket, SpatialView } = fixtures;
    if (!Manager || !Socket || !SpatialView) {
      const predicates = [path => /(?:^|\/)socket__io-client\.js$/.test(path), path => path.endsWith('/src/domain/spatial-view.ts')];
      const paths = ['/src/network/socket-link.ts', '/src/domain/spatial-view.ts'];
      const candidates = predicate => [...new Set(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => {
        try { const url = new URL(name); return url.origin === location.origin && predicate(url.pathname); } catch { return false; }
      }))];
      for (let index = 0; index < paths.length; index++) if (!candidates(predicates[index]).length) {
        await import(paths[index]); collector.raw.setup.coldImports.push(paths[index]);
      }
      const urls = predicates.map(candidates);
      collector.raw.setup.candidates = urls.map(values => Math.min(values.length, collector.limits.maxCounter));
      if (urls.some(values => values.length !== 1 || values[0].length > collector.limits.maxModuleCodeUnits)) throw Error('NSO实际模块身份不唯一');
      collector.raw.setup.modules = urls.map(values => values[0]);
      ({ Manager, Socket } = await import(urls[0][0])); ({ SpatialView } = await import(urls[1][0]));
    }
    const packetFields = kind => (receiver, args) => {
      const packet = args[0], list = ownData(packet, 'data'), type = ownData(packet, 'type');
      const event = (type === 2 || type === 5) ? ownData(list, '0') : undefined;
      const payload = (type === 2 || type === 5) ? ownData(list, '1') : (type === 3 || type === 6) ? ownData(list, '0') : undefined;
      const manager = kind === 0 ? receiver : ownData(receiver, 'io');
      const code = SCHEMA.enums.event.indexOf(event);
      return { tail: [null, null, null, null, collector.integer(type), collector.text(ownData(packet, 'nsp')),
        kind === 1 ? collector.text(ownData(receiver, 'nsp')) : null, collector.integer(ownData(packet, 'id')), code < 0 ? 0 : code,
        collector.text(ownData(payload, 'sessionId')), collector.text(ownData(payload, 'viewId')),
        collector.decimal(ownData(payload, 'fromExclusive')), collector.decimal(ownData(payload, 'throughSeq'))],
      references: [[0, manager], [1, packet], [2, list], [3, payload]] };
    };
    collector.patch(Manager.prototype, 'ondecoded', 0, packetFields(0));
    collector.patch(Socket.prototype, 'onpacket', 1, packetFields(1));
    collector.patch(SpatialView.prototype, 'applyBatch', 2, (_receiver, args) => {
      const payload = args[0];
      return { tail: [null, collector.integer(args[1]), null,
        collector.text(ownData(payload, 'sessionId')), collector.text(ownData(payload, 'viewId')),
        collector.decimal(ownData(payload, 'fromExclusive')), collector.decimal(ownData(payload, 'throughSeq'))],
      references: [[0, payload], [2, args[2]]] };
    });
    const descriptor = { configurable: true, enumerable: false, writable: false, value: api };
    collector.addRestore(() => {
      const current = Object.getOwnPropertyDescriptor(host, key);
      if (!current) return true;
      if (!sameDescriptor(current, descriptor)) return false;
      delete host[key]; return !Object.getOwnPropertyDescriptor(host, key);
    });
    Object.defineProperty(host, key, descriptor);
    if (!sameDescriptor(Object.getOwnPropertyDescriptor(host, key), descriptor)) throw Error('NSO Page入口安装不符');
    collector.installed();
    return { installed: true, hooks: 3, api };
  } catch {
    collector.fail('SETUP_FAILURE'); collector.stop();
    return { installed: false, hooks: collector.raw.setup.hookCount, error: 'SETUP_FAILURE', api };
  }
}
