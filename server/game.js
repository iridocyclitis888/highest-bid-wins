// Server-authoritative engine. Pure logic + a `push(room)` callback; no socket code here.
const CH = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
export const rooms = new Map();
const rid = (n = 12) => [...Array(n)].map(() => Math.random().toString(36)[2]).join('');
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const P = (r, id) => r.players.find(p => p.id === id);
const bidders = r => r.bidders.map(id => P(r, id));
const err = e => ({ error: e });

export function createRoom(name) {
  let code; do code = [...Array(4)].map(() => CH[Math.floor(Math.random() * CH.length)]).join(''); while (rooms.has(code));
  const r = { code, players: [], phase: 'LOBBY', timers: {}, push: () => {} };
  rooms.set(code, r); return { r, ...addPlayer(r, name, true) };
}
function addPlayer(r, name, host) {
  const p = { id: rid(6), token: rid(), name, host, connected: true, balance: 20, commit: 0, purchases: [], points: 0 };
  r.players.push(p); return { p };
}
export function joinRoom(code, name) {
  const r = rooms.get((code || '').toUpperCase().trim());
  name = (name || '').trim().slice(0, 14);
  if (!r) return err('Room not found.');
  if (r.phase !== 'LOBBY') return err('Game already in progress.');
  if (!name) return err('Enter your name.');
  if (r.players.length >= 10) return err('Room is full (10 max).');
  if (r.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return err('That name is taken.');
  return { r, ...addPlayer(r, name, false) };
}
export function resume(code, token) {
  const r = rooms.get(code); const p = r && r.players.find(p => p.token === token);
  if (!p) return err('Session expired.'); p.connected = true; arm(r); return { r, p };
}
export function leave(r, p) {
  if (r.phase !== 'LOBBY') return;
  r.players = r.players.filter(x => x !== p);
  if (!r.players.length) return rooms.delete(r.code);
  if (p.host) r.players[0].host = true;
}
export function disconnect(r, p) { p.connected = false; if (r.phase === 'LOBBY') leave(r, p); else { arm(r); tallyIfDone(r); } }

export function start(r, p) {
  if (!p.host || r.phase !== 'LOBBY') return err('Only the host can start.');
  r.players = r.players.filter(x => x.connected);
  if (r.players.length < 3) return err('Need at least 3 players.');
  r.order = shuffle(r.players.map(x => x.id)); r.round = 0; r.startCtr = 0; r.votes = {}; r.voteRound = 1; r.tally = null; r.winner = null;
  r.players.forEach(x => Object.assign(x, { balance: 20, commit: 0, purchases: [], points: 0 }));
  beginRound(r);
}
function beginRound(r) {
  r.players.forEach(x => { x.balance = 20; x.commit = 0; }); // fresh $20 every round
  r.auctioneer = r.order[r.round]; r.bidders = r.players.map(x => x.id).filter(id => id !== r.auctioneer);
  r.category = ''; r.items = []; r.itemNo = 0; r.phase = 'SETUP'; r.cur = null; r.sold = null;
}
export function submitItems(r, p, category, items) {
  if (r.phase !== 'SETUP' || p.id !== r.auctioneer) return err('Not allowed.');
  const need = 3 * r.bidders.length;
  category = String(category || '').trim().slice(0, 40);
  items = (Array.isArray(items) ? items : []).map(s => String(s).trim().slice(0, 30)).filter(Boolean);
  if (!category) return err('Enter a category.');
  if (items.length !== need) return err(`Enter exactly ${need} items.`);
  r.category = category; r.items = shuffle(items); r.total = need; nextItem(r);
}
function nextItem(r) {
  if (r.itemNo >= r.total) { r.phase = 'ROUND_DONE'; r.sold = null; return later(r, 3000, afterRound); }
  r.cur = r.items[r.itemNo++]; r.sold = null; r.phase = 'AUCTION';
  const b = bidders(r), n = b.length; let s = null;
  for (let k = 0; k < n; k++) { const c = b[(r.startCtr + k) % n]; if (c.connected && c.balance >= 1) { s = c; break; } }
  r.startCtr++;
  if (!s) { // nobody can afford anything: hand the item to a bidder for free, rotating one by one
    const g = b[(r.startCtr - 1) % n]; g.purchases.push({ item: r.cur, price: 0, category: r.category, round: r.round });
    r.phase = 'SOLD'; r.sold = { free: true, winner: g.name, item: r.cur, price: 0 }; return later(r, 2500, () => nextItem(r));
  }
  r.active = new Set(b.map(x => x.id)); r.bid = 1; r.high = s.id; s.balance--; s.commit++; r.turn = s.id; advance(r);
}
function advance(r) { // move to next active bidder; auto-pass anyone who cannot afford a bid
  for (;;) {
    if (r.active.size === 1) return sell(r);
    const ids = r.bidders; let i = ids.indexOf(r.turn);
    do i = (i + 1) % ids.length; while (!r.active.has(ids[i]));
    r.turn = ids[i]; const c = P(r, r.turn);
    if (r.turn !== r.high && c.balance < r.bid + 1 - c.commit) { refund(r, c); continue; }
    if (r.turn === r.high) return sell(r); // everyone else out
    break;
  }
  arm(r);
}
function refund(r, p) { p.balance += p.commit; p.commit = 0; r.active.delete(p.id); }
export function bid(r, p) {
  if (r.phase !== 'AUCTION' || r.turn !== p.id || !r.active.has(p.id)) return err('Not your turn.');
  const cost = r.bid + 1; // only the high bidder has money held, so a new bid pays the full new price
  if (p.balance < cost) return err('Not enough money.');
  const prev = P(r, r.high); prev.balance += prev.commit; prev.commit = 0; // outbid player is refunded immediately
  p.balance -= cost; p.commit = cost; r.bid = cost; r.high = p.id; advance(r);
}
export function pass(r, p) {
  if (r.phase !== 'AUCTION' || r.turn !== p.id || !r.active.has(p.id)) return err('Not your turn.');
  if (p.id === r.high) return err('You hold the high bid.');
  refund(r, p); advance(r);
}
function sell(r) {
  clearTimeout(r.timers.arm);
  const w = P(r, [...r.active][0]); w.commit = 0; w.purchases.push({ item: r.cur, price: r.bid, category: r.category, round: r.round });
  r.sold = { winner: w.name, item: r.cur, price: r.bid }; r.phase = 'SOLD'; r.active = new Set();
  later(r, 2800, () => nextItem(r));
}
function afterRound(r) { // each round ends with a vote among that round's bidders
  r.cands = [...r.bidders]; r.votes = {}; r.voteRound = 1; r.tie = false; r.coin = false; r.phase = 'RESULTS';
}
function nextRound(r) {
  r.round++; r.tie = false; r.coin = false;
  if (r.round >= r.order.length) { // everyone has been Auctioneer: most points wins
    const m = Math.max(...r.players.map(x => x.points)), ws = r.players.filter(x => x.points === m);
    r.winner = ws.map(x => x.name).join(' & '); r.tally = Object.fromEntries(r.players.map(x => [x.name, x.points])); r.phase = 'WINNER'; return;
  }
  beginRound(r);
}
function later(r, ms, fn) { clearTimeout(r.timers.later); r.timers.later = setTimeout(() => { fn(r); r.push(r); }, ms); }
// Turn timer: the player on turn is auto-passed after 30s (15s if disconnected). Never the high bidder, who never holds the turn.
const TURN_MS = +process.env.TURN_MS || 30000;
export function arm(r) {
  clearTimeout(r.timers.arm); r.turnEnds = null;
  if (r.phase !== 'AUCTION') return;
  const c = P(r, r.turn); if (!c) return;
  const ms = c.connected ? TURN_MS : Math.min(15000, TURN_MS), turn = r.turn; r.turnEnds = Date.now() + ms;
  r.timers.arm = setTimeout(() => {
    if (r.phase !== 'AUCTION' || r.turn !== turn) return;
    const q = P(r, turn); if (q.id !== r.high) refund(r, q); advance(r); r.push(r);
  }, ms);
}
function tallyIfDone(r) {
  if (r.phase !== 'RESULTS') return;
  if (!r.players.filter(x => x.connected).every(x => r.votes[x.id])) return;
  const t = {}; r.cands.forEach(id => t[id] = 0); Object.values(r.votes).forEach(v => t[v]++);
  const max = Math.max(...Object.values(t)), top = Object.keys(t).filter(id => t[id] === max);
  if (top.length > 1 && r.voteRound === 1) { r.voteRound = 2; r.cands = top; r.votes = {}; r.tie = true; return; }
  r.coin = top.length > 1; const w = P(r, top[Math.floor(Math.random() * top.length)]); // server-side random tiebreak
  w.points++; r.roundWinner = w.name; r.roundTally = Object.fromEntries(Object.entries(t).map(([id, n]) => [P(r, id).name, n]));
  r.phase = 'ROUND_WIN'; later(r, 6000, nextRound);
}
export function vote(r, p, target) {
  if (r.phase !== 'RESULTS') return err('Voting is closed.');
  if (r.votes[p.id]) return err('You already voted.');
  if (!r.cands.includes(target)) return err('Not an eligible player.');
  r.votes[p.id] = target; tallyIfDone(r);
}
export function playAgain(r, p) {
  if (r.phase !== 'WINNER') return err('Game is not over.');
  r.players = r.players.filter(x => x.connected);
  if (!r.players.some(x => x.host)) r.players[0].host = true; // host left: hand it to someone still here
  Object.assign(r, { phase: 'LOBBY', tie: false, coin: false, winner: null, tally: null });
  r.players.forEach(x => Object.assign(x, { balance: 20, commit: 0, purchases: [], points: 0 }));
}
// Per-player view: future items are never included.
export function view(r, me) {
  const rv = r.phase === 'RESULTS' || r.phase === 'ROUND_WIN', fin = r.phase === 'WINNER';
  const inAuc = r.phase === 'AUCTION';
  return {
    code: r.code, phase: r.phase, round: (r.round ?? 0) + 1, rounds: r.players.length,
    me: { id: me.id, host: me.host, balance: me.balance, commit: me.commit },
    players: r.players.map(p => ({ id: p.id, name: p.name, host: p.host, connected: p.connected, balance: p.balance, points: p.points,
      passed: inAuc && r.bidders.includes(p.id) && !r.active.has(p.id), purchases: fin ? p.purchases : rv && r.bidders.includes(p.id) ? p.purchases.filter(x => x.round === r.round) : undefined })),
    auctioneer: r.auctioneer, category: r.category, need: r.bidders ? 3 * r.bidders.length : 0,
    item: ['AUCTION'].includes(r.phase) ? r.cur : null, itemNo: r.itemNo, total: r.total,
    turnMs: inAuc && r.turnEnds ? Math.max(0, r.turnEnds - Date.now()) : null, bid: r.bid, high: r.high, turn: inAuc ? r.turn : null, sold: r.sold,
    upcoming: me.id === r.auctioneer && r.items ? r.items.slice(r.itemNo) : undefined,
    cands: r.phase === 'RESULTS' ? r.cands : undefined, voted: r.phase === 'RESULTS' ? Object.keys(r.votes) : undefined, myVote: r.votes?.[me.id],
    tie: r.tie, tally: fin ? r.tally : r.phase === 'ROUND_WIN' ? r.roundTally : null, winner: r.phase === 'ROUND_WIN' ? r.roundWinner : r.winner, coin: r.coin,
  };
}
