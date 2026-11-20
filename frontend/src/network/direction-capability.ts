import type { LinkHandlers, SessionLink } from './link.ts';
import { SPATIAL_CAPABILITIES } from './spatial-capabilities.ts';

export const DIRECTION_CAPABILITY = 'spatial-direction-v1';
export const TIMED_TRAIL_CAPABILITY = 'spatial-timed-trail-v1';

/** 握手成功是能力接受信号；唯一兼容重连发生在任何世界动作之前。 */
export function negotiatedSpatialLink(handlers: LinkHandlers, directionHandoff: boolean, connect: (handlers: LinkHandlers, capabilities: string[]) => SessionLink, timedTrail = false): SessionLink {
  let current: SessionLink | null = null, serial = 0, closed = false, connected = false, everConnected = false, fallback = false;
  let accepted: readonly string[] = [];
  const open = () => {
    const generation = ++serial;
    const capabilities = [...SPATIAL_CAPABILITIES, ...(directionHandoff && !fallback ? [DIRECTION_CAPABILITY, ...(timedTrail ? [TIMED_TRAIL_CAPABILITY] : [])] : [])];
    current = connect({
      connected() {
        if (closed || generation !== serial) return;
        connected = true; everConnected = true; accepted = Object.freeze([...capabilities]); handlers.connected();
      },
      disconnected() { if (!closed && generation === serial) { connected = false; accepted = []; handlers.disconnected(); } },
      batch(value) { if (!closed && generation === serial && connected) handlers.batch(value); },
      failed(value) {
        if (closed || generation !== serial) return;
        accepted = []; connected = false;
        if (directionHandoff && !fallback && !everConnected && value && typeof value === 'object' && 'code' in value && value.code === 'INVALID_MESSAGE') {
          fallback = true; serial++; const old = current; current = null; old?.close(); open(); return;
        }
        handlers.failed(value);
      },
    }, capabilities);
  };
  open();
  return {
    get connected() { return connected && Boolean(current?.connected); },
    get acceptedCapabilities() { return connected ? accepted : []; },
    get capabilityFallback() { return fallback; },
    request(event, value, consumeReply) {
      if (!connected || !current?.connected) return Promise.reject(new Error('当前连接尚未完成能力确认。'));
      return current.request(event, value, consumeReply);
    },
    close() { closed = true; serial++; connected = false; accepted = []; const old = current; current = null; old?.close(); },
  };
}
