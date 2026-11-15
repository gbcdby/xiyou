import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { enqueueSocketPacket } from '../socket-enqueue.mjs';

/** 只有真实Socket传输，没有PG、世界或呈现；业务授权由各受控fixture单独标明。 */
export async function supplyLoopback(t) {
  const http = createServer(), server = new Server(http, { serveClient: false }), sockets = new Map();
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const accepted = once(server, 'connection');
  const client = io(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], reconnection: false, timeout: 2000 });
  await once(client, 'connect'); const [socket] = await accepted;
  const handle = Object.freeze({ connectionId: crypto.randomUUID() }); socket.data.handle = handle; sockets.set(handle.connectionId, socket);
  const waiting = new Map(); let sequence = 0;
  socket.on('reserve', (id, ack) => { waiting.get(id)(ack); waiting.delete(id); });
  t.after(async () => { client.close(); await new Promise(resolve => server.close(resolve)); });
  function enqueue(value, binding, kind, send, current = () => true) { return enqueueSocketPacket({ sockets, handle, binding, value, kind, send, current }); }
  return {
    socket, client, sockets, handle, enqueue,
    push: (value, binding) => enqueue(value, binding, 'push', () => socket.emit('world.batch', value)),
    async reserve() {
      const id = ++sequence; let capture; const captured = new Promise(resolve => { capture = resolve; }); waiting.set(id, capture);
      const reply = client.timeout(3000).emitWithAck('reserve', id); reply.catch(() => {});
      const ack = await captured;
      return { reply, ack, send: (value, binding) => enqueue(value, binding, 'ack', () => ack(value)) };
    },
  };
}
