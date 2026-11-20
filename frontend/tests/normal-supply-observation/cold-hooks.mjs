/** 复用MI冷接线结构；NSO新增Node封口和Page三点，有限夹具调用本实现。 */
import { sameDescriptor } from './collector.mjs';

export function createColdHooks({ config, nodeProbe, installPageHandle, onRaw, onStatus }) {
  const cold = { format: 'NSO_COLD_V1', naturalQualified: false,
    productHead: config.productHead, productTree: config.productTree,
    methodSHA256: config.methodSHA256, inputSHA256: config.inputSHA256, schemaSHA256: config.schemaSHA256,
    harnessLoaded: false, enqueueLoaded: false, loaderRemoved: false, temporaryBridgeRemoved: false,
    transformedModules: [], ownerHookCalls: 0, originalOwnerHookCalls: 0,
    installationOrder: 'NODE_AT_ROOM_PAGE_BEFORE_PRESENTATION', nodeInstalled: false, pageInstalled: false,
    collectionRequested: false, collectionReason: null, ownedApiCaptured: false, ownedApiDisposed: false,
    pageCollected: false, pageWritten: false, pageBytes: 0, pageSHA256: null,
    nodeCollected: false, nodeWritten: false, nodeBytes: 0, nodeSHA256: null,
    harnessRestored: false, contextRestored: false, browserRestored: false, reloadRestored: false,
    exitFallback: false, errors: [], valid: false };
  const slots = []; let roomBinding = null, ownedApi = null, roomUsed = false, collection = null, published = false;
  function error(code) {
    // 包括onStatus先写后抛及exit fallback：任何冷观察错误都不可继续保留真资格。
    cold.valid = false;
    if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) code = 'UNKNOWN_ERROR';
    if (!cold.errors.includes(code) && cold.errors.length < 16) cold.errors.push(code);
  }
  function increment(name) { if (cold[name] < 2147483647) cold[name]++; else error('COUNTER_CAPACITY'); }
  function restore(slot) {
    const current = Object.getOwnPropertyDescriptor(slot.object, slot.key);
    if (sameDescriptor(current, slot.own)) return true;
    if (!sameDescriptor(current, slot.installed)) return false;
    if (slot.own) Object.defineProperty(slot.object, slot.key, slot.own); else delete slot.object[slot.key];
    return sameDescriptor(Object.getOwnPropertyDescriptor(slot.object, slot.key), slot.own);
  }
  function restoreCold() {
    for (let index = slots.length - 1; index >= 0; index--) {
      const slot = slots[index];
      try { cold[slot.status] = restore(slot); } catch { cold[slot.status] = false; error('COLD_RESTORE_EXCEPTION'); }
      if (!cold[slot.status]) error('COLD_RESTORE_CONFLICT');
    }
    if (roomBinding) {
      try { if (roomBinding.read() === roomBinding.wrapper) roomBinding.write(roomBinding.original);
        cold.harnessRestored = roomBinding.read() === roomBinding.original; } catch { error('COLD_RESTORE_EXCEPTION'); }
      if (!cold.harnessRestored) error('COLD_RESTORE_CONFLICT');
    }
  }
  function writeRaw(realm, raw) {
    const result = onRaw(realm, raw);
    if (!Number.isSafeInteger(result.bytes) || result.bytes < 0 || result.bytes > 16777216 || !/^[a-f0-9]{64}$/.test(result.sha256 ?? ''))
      throw Error('NSO冷输出身份无效');
    cold[realm + 'Written'] = true; cold[realm + 'Bytes'] = result.bytes; cold[realm + 'SHA256'] = result.sha256;
  }
  function publish() { if (!published) { onStatus(cold); published = true; } }
  function stopNode() {
    try { const raw = nodeProbe.stop(); cold.nodeCollected = true; writeRaw('node', raw); return raw; }
    catch { error('NODE_COLLECTION_FAILED'); return null; }
  }
  function collect(reason) {
    if (collection) return collection;
    if (!['context.close', 'browser.close', 'page.reload', 'original-before-session-failure', 'install-failure'].includes(reason)) {
      error('UNKNOWN_COLLECTION_REASON'); reason = 'unknown';
    }
    cold.collectionRequested = true; cold.collectionReason = reason;
    collection = (async () => {
      let pageRaw = null, nodeRaw = null;
      try { if (!ownedApi) throw Error('NSO本次Page API缺失');
        pageRaw = await ownedApi.evaluate(api => api.stop());
        if (!pageRaw) throw Error('NSO Page原件缺失'); cold.pageCollected = true;
      } catch { error('PAGE_COLLECTION_FAILED'); }
      finally {
        if (ownedApi) {
          try { await ownedApi.dispose(); cold.ownedApiDisposed = true; } catch { error('OWNED_API_DISPOSE_FAILED'); }
          ownedApi = null;
        }
        nodeRaw = stopNode(); restoreCold();
      }
      if (pageRaw) { try { writeRaw('page', pageRaw); } catch { error('PAGE_WRITE_FAILED'); } }
      cold.valid = cold.loaderRemoved && cold.temporaryBridgeRemoved && cold.nodeInstalled && cold.pageInstalled
        && cold.pageWritten && cold.nodeWritten && cold.ownedApiCaptured && cold.ownedApiDisposed
        && cold.harnessRestored && cold.contextRestored && cold.browserRestored && cold.reloadRestored
        && pageRaw?.terminal?.valid === true && nodeRaw?.terminal?.valid === true && cold.errors.length === 0;
      try { publish(); } catch { error('COLD_WRITE_FAILED'); }
      return cold.valid;
    })();
    return collection;
  }
  function wrapCold(object, key, reason, status) {
    if (!object || slots.length >= 3) throw Error('NSO冷恢复槽无效');
    const own = Object.getOwnPropertyDescriptor(object, key); let descriptor = own;
    for (let current = Object.getPrototypeOf(object), depth = 0; !descriptor && current && depth < 8;
      current = Object.getPrototypeOf(current), depth++) descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function'
      || (own && !own.configurable && !own.writable)) throw Error('NSO原冷入口描述符不符');
    const original = descriptor.value;
    // 冷路径明确增加收取等待，不承诺原Promise身份或原冷端耗时。
    const wrapper = async function (...args) {
      try { await collect(reason); } catch { error('COLD_COLLECTION_EXCEPTION'); }
      return Reflect.apply(original, this, args);
    };
    const installed = { ...(own ?? { configurable: true, writable: true, enumerable: false }), value: wrapper };
    slots.push({ object, key, own, installed, status });
    Object.defineProperty(object, key, installed);
    if (!sameDescriptor(Object.getOwnPropertyDescriptor(object, key), installed)) throw Error('NSO冷入口安装不符');
  }
  function harness(original, read, write) {
    if (roomBinding || typeof original !== 'function' || typeof read !== 'function' || typeof write !== 'function') throw Error('NSO原房间绑定无效');
    const wrapper = function (...args) {
      if (roomUsed || args.length !== 1 || !args[0] || typeof args[0].beforeSession !== 'function') {
        error('ROOM_SHAPE_OR_REUSE'); return Reflect.apply(original, this, args);
      }
      roomUsed = true; const options = args[0], beforeSession = options.beforeSession;
      try { nodeProbe.activate(options.server.runtime); cold.nodeInstalled = true; }
      catch { error('NODE_INSTALL_FAILED'); nodeProbe.fail('SETUP_FAILURE'); }
      return Reflect.apply(original, this, [{ ...options, beforeSession: async function (...hookArgs) {
        if (hookArgs[1] !== 0) return Reflect.apply(beforeSession, this, hookArgs);
        increment('ownerHookCalls');
        if (cold.ownerHookCalls !== 1) {
          error('OWNER_HOOK_REUSED'); increment('originalOwnerHookCalls'); return Reflect.apply(beforeSession, this, hookArgs);
        }
        const page = hookArgs[0]; let installationFailed = false;
        try {
          const context = page.context();
          wrapCold(context, 'close', 'context.close', 'contextRestored');
          wrapCold(context.browser(), 'close', 'browser.close', 'browserRestored');
          wrapCold(page, 'reload', 'page.reload', 'reloadRestored');
          const installed = await installPageHandle(page, config);
          try {
            const setup = await installed.evaluate(value => ({ installed: value.installed === true,
              hooks: value.hooks, ownAPI: Object.hasOwn(value, 'api') }));
            if (setup.ownAPI) { ownedApi = await installed.getProperty('api'); cold.ownedApiCaptured = true; }
            cold.pageInstalled = setup.installed && setup.hooks === 3 && cold.ownedApiCaptured;
            if (!cold.pageInstalled) throw Error('NSO Page安装不完整');
          } finally { await installed.dispose(); }
        } catch { installationFailed = true; error('COLD_INSTALL_FAILED'); }
        try { increment('originalOwnerHookCalls'); return await Reflect.apply(beforeSession, this, hookArgs); }
        catch (failure) {
          error('ORIGINAL_BEFORE_SESSION_FAILED');
          try { await collect('original-before-session-failure'); } catch { error('COLD_COLLECTION_EXCEPTION'); }
          throw failure;
        } finally { if (installationFailed) {
          try { await collect('install-failure'); } catch { error('COLD_COLLECTION_EXCEPTION'); }
        } }
      } }]);
    };
    roomBinding = { original, read, write, wrapper }; write(wrapper);
    if (read() !== wrapper) throw Error('NSO原房间安装不符');
  }
  function exit() {
    if (published) return;
    cold.exitFallback = true; error('EXIT_WITHOUT_COLD_COLLECTION');
    if (!cold.nodeWritten) stopNode(); restoreCold();
    try { publish(); } catch { error('COLD_WRITE_FAILED'); }
  }
  return { status: cold, error, harness, collect, exit };
}
