import { io } from 'socket.io-client';
import type { ConnectLink } from './link.ts';

/** 禁用库内自动重连，由恢复驱动为每条真实连接分配新的代次。 */
export const connectSocket: ConnectLink = (token, handlers) => {
  const socket = io({ path: '/socket.io', auth: { token }, autoConnect: false, reconnection: false, timeout: 10000 });
  socket.on('connect', handlers.connected);
  socket.on('disconnect', handlers.disconnected);
  socket.on('connect_error', error => handlers.failed(error.data));
  socket.on('world.batch', handlers.batch);
  socket.connect();
  return {
    get connected() { return socket.connected; },
    request(event, value) {
      return new Promise((resolve, reject) => {
        if (!socket.connected) { reject(new Error('当前连接不可用。')); return; }
        socket.timeout(8000).emit(event, value, (error: Error | null, response: unknown) => error ? reject(error) : resolve(response));
      });
    },
    close() { socket.removeAllListeners(); socket.disconnect(); },
  };
};
