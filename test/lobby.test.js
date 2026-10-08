import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/lobby.js';

const room0 = () => L.newRoom('1234', 12, 'host', 0);

test('人數夾在 4–20，亂填退回 12', () => {
  assert.equal(L.clampPlayers(2), 4);
  assert.equal(L.clampPlayers(99), 20);
  assert.equal(L.clampPlayers('abc'), 12);
  assert.equal(L.clampPlayers('9'), 9);
});

test('空位可以坐，換位會放掉原本的座位', () => {
  let r = L.claimSeat(room0(), 'a', 3, new Set(['a'])).room;
  assert.deepEqual(r.seats, { 3: 'a' });
  r = L.claimSeat(r, 'a', 5, new Set(['a'])).room;
  assert.deepEqual(r.seats, { 5: 'a' });
});

test('別人在線上的座位不能搶', () => {
  const r = L.claimSeat(room0(), 'a', 3, new Set(['a'])).room;
  const res = L.claimSeat(r, 'b', 3, new Set(['a', 'b']));
  assert.equal(res.ok, false);
  assert.match(res.error, /3 號已經有人/);
});

test('座位主人離線時可以接手（換手機回來）', () => {
  const r = L.claimSeat(room0(), 'a', 3, new Set(['a'])).room;
  const res = L.claimSeat(r, 'b', 3, new Set(['b']));
  assert.equal(res.ok, true);
  assert.deepEqual(res.room.seats, { 3: 'b' });
});

test('超出人數或亂填的座位號碼不接受', () => {
  for (const s of [0, 13, 2.5, 'x']) assert.equal(L.claimSeat(room0(), 'a', s, new Set()).ok, false);
});

test('人數調少，超出的座位被清掉', () => {
  let r = room0();
  r = L.claimSeat(r, 'a', 3, new Set()).room;
  r = L.claimSeat(r, 'b', 10, new Set()).room;
  r = L.setPlayers(r, 8);
  assert.deepEqual(r.seats, { 3: 'a' });
  assert.equal(r.players, 8);
});

test('主機在線上不能被接手；離線才可以', () => {
  assert.equal(L.claimHost(room0(), 'x', new Set(['host'])).ok, false);
  const res = L.claimHost(room0(), 'x', new Set());
  assert.equal(res.ok, true);
  assert.equal(res.room.hostClientId, 'x');
});

test('主機也可以坐下當玩家', () => {
  const r = L.claimSeat(room0(), 'host', 1, new Set(['host'])).room;
  const v = L.publicView(r, new Set(['host']), 'host');
  assert.equal(v.you.isHost, true);
  assert.equal(v.you.seat, 1);
  assert.equal(v.seats[0].host, true);
});

test('公開畫面：每支手機只標出自己的座位', () => {
  let r = room0();
  r = L.claimSeat(r, 'a', 1, new Set()).room;
  r = L.claimSeat(r, 'b', 2, new Set()).room;
  const v = L.publicView(r, new Set(['a']), 'b');
  assert.deepEqual(v.seats.slice(0, 3).map(s => [s.taken, s.online, s.mine]), [[true, true, false], [true, false, true], [false, false, false]]);
  assert.equal(v.you.seat, 2);
  assert.equal(JSON.stringify(v).includes('"a"'), false, '不能把別人的 clientId 送出去');
});
