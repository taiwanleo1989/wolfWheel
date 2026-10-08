// 入口：/api/* 交給房間；其他路徑都是靜態網頁（public/）
import { Room } from './room.js';
import { clampPlayers } from './lobby.js';
export { Room };

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const roomStub = (env, code) => env.ROOM.get(env.ROOM.idFromName(code));

function randomCode() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return String(1000 + (b[0] % 9000));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 開新房間
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const clientId = String(body.clientId ?? '').slice(0, 64);
      if (!clientId) return json({ error: '缺少 clientId' }, 400);
      for (let i = 0; i < 20; i++) {
        const code = randomCode();
        const r = await roomStub(env, code).init(code, clampPlayers(body.players), clientId);
        if (r.ok) return json({ code });
      }
      return json({ error: '房號暫時用完了，請稍後再試' }, 503);
    }

    const m = url.pathname.match(/^\/api\/rooms\/(\d{4})(\/ws)?$/);
    if (m) {
      const stub = roomStub(env, m[1]);
      if (m[2]) return stub.fetch(request);                 // 連線
      if (request.method === 'GET') return json(await stub.info()); // 加入前先確認房號存在
    }
    if (url.pathname.startsWith('/api/')) return json({ error: '找不到' }, 404);

    return env.ASSETS.fetch(request);
  },
};
