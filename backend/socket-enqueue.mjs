import { canonicalize } from '../protocol/index.mjs';

const queued = new WeakMap();

/** 当前默认namespace的普通JSON ACK/EVENT；不把emit真值或packetCreate单独当入队。 */
export function enqueueSocketPacket({ sockets, handle, binding, value, kind, send, current }) {
  if (!['ack', 'push'].includes(kind)) return null;
  const socket = sockets.get(handle.connectionId), connection = socket?.conn;
  const live = () => sockets.get(handle.connectionId) === socket && socket?.data.handle === handle
    && socket.connected && socket.conn === connection && connection?.readyState === 'open'
    && socket.nsp.name === '/' && current();
  if (typeof send !== 'function' || !live()) return null;
  let expected;
  try { expected = canonicalize(value); } catch { return null; }
  let matches = 0, failed = false;
  const created = packet => {
    if (packet.type !== 'message' || typeof packet.data !== 'string') return;
    // 此适配器只发送无二进制、无ack请求的world.batch；RPC回应须带库分配的ACK id。
    const encoded = kind === 'ack' ? /^3(?:0|[1-9]\d*)(\[.*\])$/s.exec(packet.data) : /^2(\[.*\])$/s.exec(packet.data);
    if (!encoded) return;
    try {
      const data = JSON.parse(encoded[1]);
      if (Array.isArray(data) && (kind === 'ack'
        ? data.length === 1 && canonicalize(data[0]) === expected
        : data.length === 2 && data[0] === 'world.batch' && canonicalize(data[1]) === expected)) matches++;
    } catch { failed = true; }
  };
  connection.on('packetCreate', created);
  try {
    const returned = send();
    // 整个证据窗口必须同步完成；异步包装不能冒充确定的入队临界区。
    if (returned && typeof returned.then === 'function') { failed = true; Promise.resolve(returned).catch(() => {}); }
  } catch { failed = true; }
  finally { connection.off('packetCreate', created); }
  if (failed || matches !== 1 || !live()) return null;
  const proof = Object.freeze({});
  queued.set(proof, { handle, binding, expected, kind });
  return proof;
}

/** 只接受本模块真实发送临界区生成的、同handle/绑定/完整DTO的一次性证明。 */
export function consumeQueuedPacket(proof, handle, binding, value, kind) {
  const evidence = proof && typeof proof === 'object' ? queued.get(proof) : null;
  if (!evidence) return false;
  queued.delete(proof);
  return evidence.handle === handle && evidence.binding === binding && evidence.kind === kind && evidence.expected === canonicalize(value);
}
