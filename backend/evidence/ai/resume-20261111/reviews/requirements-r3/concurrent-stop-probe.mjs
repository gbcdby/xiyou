import assert from 'node:assert/strict';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';

const database = await startTestPostgres('requirements-concurrent-stop');
const client = await database.pool.connect();
let released = false;
try {
  let firstSettled = false; let secondSettled = false; let ended = false;
  client.once('end', () => { ended = true; });
  const first = database.stop();
  const second = database.stop();
  assert.equal(first, second, '两个调用方必须观察同一清理结果');
  first.then(() => { firstSettled = true; });
  second.then(() => { secondSettled = true; });
  await Promise.resolve();
  assert.equal(firstSettled, false);
  assert.equal(secondSettled, false, '尚有借出的连接，第二调用方不能提前成功');
  client.release(); released = true;
  await Promise.all([first, second]);
  assert.equal(ended, true);
  assert.equal(firstSettled, true);
  assert.equal(secondSettled, true);
  await database.stop();
  console.log('通过：两个并发 stop 调用共同等待真实客户端结束与数据库清理；再次 stop 保持同一已完成结果。');
} finally {
  if (!released) client.release();
  await database.stop();
}
