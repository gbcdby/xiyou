import { io } from 'socket.io-client';
import { negotiatedSpatialLink } from './direction-capability.ts';
import type { LinkHandlers, SessionLink } from './link.ts';

/** 禁用库内自动重连，由恢复驱动为每条真实连接分配新的代次。 */
export const connectSocket = (token: string, handlers: LinkHandlers, origin?: string, capabilities?: string[]): SessionLink => {
  const socket = io(origin, { path: '/socket.io', auth: { token, ...(capabilities ? { capabilities } : {}) }, autoConnect: false, reconnection: false, timeout: 10000 });
  socket.on('connect', handlers.connected);
  socket.on('disconnect', handlers.disconnected);
  socket.on('connect_error', error => handlers.failed(error.data));
  socket.on('world.batch', handlers.batch);
  socket.connect();
  return {
    get connected() { return socket.connected; },
    request(event, value, consumeReply) {
      return new Promise((resolve, reject) => {
        if (!socket.connected) { reject(new Error('当前连接不可用。')); return; }
        socket.timeout(8000).emit(event, value, (error: Error | null, response: unknown) => {
          if (error) { reject(error); return; }
          // ACK已由库消费；应用异常必须在此收束Promise，不能逃逸后等待不存在的超时。
          try { consumeReply?.(response); resolve(response); } catch (failure) { reject(failure); }
        });
      });
    },
    close() { socket.removeAllListeners(); socket.disconnect(); },
  };
};

export const connectSpatialSocket = (token: string, handlers: LinkHandlers, origin?: string, options: { directionHandoff?: boolean; timedTrail?: boolean } = {}): SessionLink =>
  negotiatedSpatialLink(handlers, options.directionHandoff === true, (callbacks, capabilities) => connectSocket(token, callbacks, origin, capabilities), options.timedTrail === true);
