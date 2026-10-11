import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import * as G from './game.js';

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: process.env.CLIENT_ORIGIN || '*' }, pingInterval: 10000, pingTimeout: 8000 });
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../client')));

const push = r => r.players.forEach(p => p.sid && io.to(p.sid).emit('state', G.view(r, p)));
const attach = (s, r, p) => { s.data = { code: r.code, pid: p.id }; p.sid = s.id; r.push = push; s.join(r.code); };
const ctx = s => { const r = G.rooms.get(s.data?.code); const p = r?.players.find(x => x.id === s.data.pid); return r && p ? { r, p } : null; };

io.on('connection', s => {
  const hello = (res, ack) => {
    if (res.error) return ack({ error: res.error });
    attach(s, res.r, res.p); ack({ ok: true, code: res.r.code, token: res.p.token }); push(res.r);
  };
  s.on('create_room', (d, ack) => hello(G.createRoom(String(d?.name || '').trim().slice(0, 14) || 'Host'), ack));
  s.on('join_room', (d, ack) => hello(G.joinRoom(d?.code, d?.name), ack));
  s.on('reconnect_player', (d, ack) => hello(G.resume(d?.code, d?.token), ack));
  // Every game action runs synchronously on the single Node thread, so simultaneous clicks are processed in order.
  const act = (ev, fn) => s.on(ev, (d, ack = () => {}) => {
    const c = ctx(s); if (!c) return ack({ error: 'Not in a room.' });
    const res = fn(c.r, c.p, d || {}); push(c.r); ack(res || { ok: true });
  });
  act('start_game', (r, p) => G.start(r, p));
  act('submit_items', (r, p, d) => G.submitItems(r, p, d.category, d.items));
  act('bid', (r, p, d) => G.bid(r, p, d.inc));
  act('pass', (r, p) => G.pass(r, p));
  act('submit_vote', (r, p, d) => G.vote(r, p, d.target));
  act('kick_player', (r, p, d) => { const sid = r.players.find(x => x.id === d.target)?.sid; const res = G.kick(r, p, d.target); if (res?.error) return res; if (sid) io.to(sid).emit('kicked'); });
  act('play_again', (r, p) => G.playAgain(r, p));
  act('leave_room', (r, p) => { G.leave(r, p); s.leave(r.code); s.data = {}; });
  s.on('disconnect', () => { const c = ctx(s); if (c && c.p.sid === s.id) { G.disconnect(c.r, c.p); push(c.r); } }); // ignore stale sockets
});
const port = process.env.PORT || 3000;
srv.listen(port, () => console.log(`Highest Bid Wins on http://localhost:${port}`));
