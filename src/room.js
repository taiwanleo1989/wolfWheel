// 一個房間＝一個 Durable Object。整局狀態存在這裡，手機只負責顯示與送出點選。
// 連線用 WebSocket Hibernation：大家在講話、沒人操作時，房間會休眠、不吃運算額度。
import { DurableObject } from 'cloudflare:workers';
import * as L from './lobby.js';
import * as G from './game.js';
import * as E from './engine.js';

const IDLE_MS = 2 * 60 * 60 * 1000; // 最後一個人離開 2 小時後清掉房間

// 發牌用的亂數：crypto＋拒絕取樣，每個結果機率相同
function rand(n) {
  const buf = new Uint32Array(1), lim = Math.floor(0x100000000 / n) * n;
  let x;
  do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= lim);
  return x % n;
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 手機每 20 秒送 ping 確認連線還活著；由平台直接回 pong，不會把休眠中的房間叫醒
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get('room')) ?? null; });
  }

  // ── 給 Worker 呼叫（RPC） ──
  async init(code, players, hostClientId) {
    const now = Date.now();
    if (this.room && (this.sockets().length > 0 || now - this.room.touchedAt < IDLE_MS)) return { ok: false };
    this.room = L.newRoom(code, players, hostClientId, now);
    await this.save();
    await this.ctx.storage.setAlarm(now + IDLE_MS);
    return { ok: true };
  }

  async info() {
    return this.room ? { exists: true, players: this.room.players, phase: this.room.phase } : { exists: false };
  }

  // ── WebSocket ──
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('需要 WebSocket', { status: 426 });
    if (!this.room) return new Response('房間不存在', { status: 404 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ clientId: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // 訊息處理丟例外（例如自己改封包送 {"toString":1} 這種 Number() 轉不了的值）：回錯給那支手機，房間照舊（2026-10-29 夜班）
  async webSocketMessage(ws, data) {
    try { await this.handleMessage(ws, data); } catch (e) {
      console.error('webSocketMessage', e);
      this.send(ws, { type: 'error', error: '訊息格式不對' });
    }
  }

  async handleMessage(ws, data) {
    if (!this.room) { ws.close(4004, '房間已關閉'); return; }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return; // 「null」「5」這種也是合法 JSON，但不是訊息
    const me = ws.deserializeAttachment() ?? {};

    if (msg.type === 'hello') {
      const clientId = String(msg.clientId ?? '').slice(0, 64);
      if (!clientId) return;
      ws.serializeAttachment({ clientId });
      // 同一支手機開了兩個分頁：舊的那個關掉，免得一個人佔兩條線
      for (const other of this.sockets()) {
        if (other !== ws && other.deserializeAttachment()?.clientId === clientId) other.close(4001, '這支手機在別的分頁開了房間');
      }
      if (msg.asHost) {
        const r = G.takeHost(this.room, clientId, this.onlineIds(ws), Date.now());
        if (r.ok || r.room) this.room = r.room; // 失敗也可能要存（開始算主機斷線時間）
        if (!r.ok) this.send(ws, { type: 'error', error: r.error });
      }
      // 主機回來＝不再算斷線時間；座位原本的手機回來＝那個座位的接手申請作廢（G.hello）
      this.room = G.hello(this.room, clientId);
      // 主機回來了：夜裡還在等角色的話，接著每 REPEAT_MS（25 秒）重唸
      if (this.room.hostClientId === clientId) this.room = E.resumeRepeat(this.room, Date.now());
      await this.touch();
      return;
    }
    if (!me.clientId) return; // 還沒打招呼

    const online = this.onlineIds();
    const isHost = this.room.hostClientId === me.clientId;
    const now = Date.now();
    if (G.HOST_ONLY.includes(msg.type) && !isHost) return this.send(ws, { type: 'error', error: '只有主機能做這件事' });
    let result;
    switch (msg.type) {
      case 'claimSeat': result = G.claimSeat(this.room, me.clientId, msg.seat, online); break;
      case 'leaveSeat': result = G.leaveSeat(this.room, me.clientId); break;
      case 'claimHost': result = G.takeHost(this.room, me.clientId, online, now); if (result.ok) result.room = E.resumeRepeat(result.room, now); break;
      case 'approveSeat': result = G.approveSeat(this.room, msg.seat, msg.yes, online); break;
      case 'setPlayers':
        if (this.room.phase !== 'lobby') return this.send(ws, { type: 'error', error: '發牌後不能改人數' });
        result = { ok: true, room: L.setPlayers(this.room, msg.players) }; break;
      case 'setSetup': result = G.setSetup(this.room, msg.setup); break;
      case 'deal': result = G.startDeal(this.room, rand); break;
      case 'redeal': result = G.redeal(this.room, rand); break;
      case 'backToSetup': result = G.backToSetup(this.room); break;
      case 'ack': result = G.ack(this.room, me.clientId); break;
      // ── 對局（engine.js） ──
      case 'start': result = E.startGame(this.room, now, rand); break;
      case 'act': result = E.nightAction(this.room, me.clientId, msg.payload, online, now, rand); break;
      case 'skip': result = E.skipStep(this.room, now, rand); break;
      case 'shoot': result = E.shoot(this.room, me.clientId, msg.target, now); break;
      case 'exile': result = { ok: false, error: '放逐由大家用手機投票決定，主機不能登記（Leo 2026-10-28）' }; break; // 舊網頁的手動放逐鈕
      case 'duel': result = E.duel(this.room, me.clientId, msg.target, now); break;
      case 'boom': result = E.boom(this.room, me.clientId, msg.target, now); break;
      case 'idiot': result = E.idiotChoose(this.room, me.clientId, msg.flip, now); break;
      case 'nextNight': result = E.nextNight(this.room, now); break;
      case 'announce': result = E.announceDeaths(this.room, now); break;
      // 投票、警長（Leo 2026-10-27）
      case 'vote': result = E.castVote(this.room, me.clientId, msg.target, now); break;
      case 'startVote': result = E.startVote(this.room, false, now); break; // 平票 PK 由伺服器自動開（Leo 2026-10-28），主機只能開第一輪
      case 'endVote': result = E.endVote(this.room, now); break;
      case 'sheriff': result = E.setSheriff(this.room, msg.seat, now); break;
      case 'tearBadge': result = E.tearBadge(this.room, now); break;
      case 'passBadge': result = E.passBadge(this.room, me.clientId, msg.target, now); break; // 出局的警長自己選
      case 'newGame': result = E.newGame(this.room); break;
      case 'restart': result = G.restart(this.room, rand); break;
      default: return;
    }
    if (!result.ok) {
      this.send(ws, { type: 'error', error: result.error });
      if (result.room) { this.room = result.room; await this.touch(); } // 失敗但有東西要清（例如過期的接手申請）
      return;
    }
    this.room = result.room;
    await this.touch();
  }

  async webSocketClose(ws) { await this.onLeave(ws); }
  async webSocketError(ws) { await this.onLeave(ws); }

  async onLeave(ws) {
    try { ws.close(1000); } catch {}
    if (!this.room) return;
    // 主機斷線：記下時間，對局中別的手機要等滿 1 分鐘才能接手（見 G.left、L.claimHost）
    const next = G.left(this.room, this.onlineIds(ws), Date.now());
    if (next !== this.room) { this.room = next; await this.save(); }
    this.broadcast(ws);
    await this.schedule();
  }

  // 鬧鐘只有一個：有計時（夜裡假等、停頓、重唸；白天沒有計時）就先處理計時；沒有的話用來清掉閒置房間
  async schedule() {
    const t = this.room?.game?.timer?.at;
    await this.ctx.storage.setAlarm(t ?? Date.now() + IDLE_MS);
  }

  async alarm() {
    if (!this.room) return;
    const t = this.room.game?.timer?.at;
    if (t && E.repeatDue(this.room, Math.max(Date.now(), t)) && !this.onlineIds().has(this.room.hostClientId)) {
      // 該重唸了，但主機不在線上（沒人出聲）：不重唸、不更新最後活動時間，讓沒人的房間 2 小時後照樣清掉
      // 死掉的角色也一樣不重唸、只留假等結束那一下（見 E.pauseRepeat）
      this.room = E.pauseRepeat(this.room);
      await this.save();
      await this.schedule();
      return;
    }
    if (t) {
      const r = E.advance(this.room, Math.max(Date.now(), t), rand);
      this.room = r.room;
      await this.touch();
      return;
    }
    if (this.sockets().length === 0 && Date.now() - this.room.touchedAt >= IDLE_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.schedule();
  }

  // ── 小工具 ──
  sockets(except) { return this.ctx.getWebSockets().filter(s => s !== except && s.readyState === WebSocket.OPEN); }
  onlineIds(except) { return new Set(this.sockets(except).map(s => s.deserializeAttachment()?.clientId).filter(Boolean)); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(except) {
    const online = this.onlineIds(except);
    for (const s of this.sockets(except)) {
      const id = s.deserializeAttachment()?.clientId;
      if (id) this.send(s, G.viewFor(this.room, online, id));
    }
  }
  async save() { await this.ctx.storage.put('room', this.room); }
  async touch() {
    this.room = { ...this.room, touchedAt: Date.now() };
    await this.save();
    await this.schedule();
    this.broadcast();
  }
}
