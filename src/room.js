// 一個房間＝一個 Durable Object。整局狀態存在這裡，手機只負責顯示與送出點選。
// 連線用 WebSocket Hibernation：大家在講話、沒人操作時，房間會休眠、不吃運算額度。
import { DurableObject } from 'cloudflare:workers';
import * as L from './lobby.js';

const IDLE_MS = 2 * 60 * 60 * 1000; // 最後一個人離開 2 小時後清掉房間

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

  async webSocketMessage(ws, data) {
    if (!this.room) { ws.close(4004, '房間已關閉'); return; }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
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
        const r = L.claimHost(this.room, clientId, this.onlineIds(ws));
        if (r.ok) this.room = r.room; else this.send(ws, { type: 'error', error: r.error });
      }
      await this.touch();
      return;
    }
    if (!me.clientId) return; // 還沒打招呼

    const online = this.onlineIds();
    const isHost = this.room.hostClientId === me.clientId;
    let result = { ok: true, room: this.room };
    switch (msg.type) {
      case 'claimSeat': result = L.claimSeat(this.room, me.clientId, msg.seat, online); break;
      case 'leaveSeat': result = { ok: true, room: L.leaveSeat(this.room, me.clientId) }; break;
      case 'claimHost': result = L.claimHost(this.room, me.clientId, online); break;
      case 'setPlayers':
        if (!isHost) return this.send(ws, { type: 'error', error: '只有主機能改人數' });
        if (this.room.phase !== 'lobby') return this.send(ws, { type: 'error', error: '遊戲開始後不能改人數' });
        result = { ok: true, room: L.setPlayers(this.room, msg.players) }; break;
      default: return;
    }
    if (!result.ok) return this.send(ws, { type: 'error', error: result.error });
    this.room = result.room;
    await this.touch();
  }

  async webSocketClose(ws) { await this.onLeave(ws); }
  async webSocketError(ws) { await this.onLeave(ws); }

  async onLeave(ws) {
    try { ws.close(1000); } catch {}
    if (!this.room) return;
    this.broadcast(ws);
    if (this.sockets(ws).length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  async alarm() {
    if (this.sockets().length > 0) { await this.ctx.storage.setAlarm(Date.now() + IDLE_MS); return; }
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  // ── 小工具 ──
  sockets(except) { return this.ctx.getWebSockets().filter(s => s !== except && s.readyState === WebSocket.OPEN); }
  onlineIds(except) { return new Set(this.sockets(except).map(s => s.deserializeAttachment()?.clientId).filter(Boolean)); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  broadcast(except) {
    const online = this.onlineIds(except);
    for (const s of this.sockets(except)) {
      const id = s.deserializeAttachment()?.clientId;
      if (id) this.send(s, L.publicView(this.room, online, id));
    }
  }
  async save() { await this.ctx.storage.put('room', this.room); }
  async touch() {
    this.room = { ...this.room, touchedAt: Date.now() };
    await this.save();
    this.broadcast();
  }
}
