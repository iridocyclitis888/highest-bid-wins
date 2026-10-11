// Engine test: spec example, refunds, hidden items, voting. Run: npm test
import assert from 'assert';
import * as G from './game.js';
const { r, p: host } = G.createRoom('Alex'); r.push = () => {};
const m = G.joinRoom(r.code, 'Mike').p, s = G.joinRoom(r.code, 'Sarah').p, j = G.joinRoom(r.code, 'Josh').p;
assert(G.start(r, host) === undefined);
const byId = id => r.players.find(x => x.id === id), A = byId(r.auctioneer);
assert(G.submitItems(r, A, 'Food', ['a']).error);
assert(G.submitItems(r, A, 'Food', 'aabcdefgh'.split('')).error); // duplicate item rejected
assert(G.submitItems(r, A, 'Food', ['a','A ','b','c','d','e','f','g','h']).error); // case/space-insensitive
assert(!G.view(r, byId(r.bidders[0])).upcoming);
G.submitItems(r, A, 'Food', 'abcdefghi'.split(''));
const bs = r.bidders.map(byId), v = G.view(r, bs[0]);
assert(typeof v.item === 'string' && !JSON.stringify(v).includes('items'));
assert.equal(r.bid, 1); assert.equal(byId(r.high).balance, 29); // 4 players => $30 budget
const first = r.turn; assert(G.bid(r, byId(r.bidders.find(i => i !== first && i !== r.turn))).error); // out of turn
const t1 = byId(r.turn); const starter = byId(r.high); G.bid(r, t1); assert.equal(starter.balance, 30); assert.equal(starter.commit, 0); assert.equal(r.bid, 2); assert.equal(t1.commit, 2);
const t2 = byId(r.turn); G.pass(r, t2); assert.equal(t2.balance, 30); assert.equal(t2.commit, 0);
const t3 = byId(r.turn); G.pass(r, t3); // only one left -> sold
assert.equal(r.phase, 'SOLD'); const w = r.players.find(x => x.purchases.length); assert.equal(w.balance, 28); assert.equal(w.commit, 0);
// per-round voting: winner gets a point
r.phase = 'RESULTS'; r.cands = [...r.bidders]; r.votes = {}; r.voteRound = 1;
const [c0, c1] = r.cands.map(byId);
assert(G.vote(r, A, 'nobody').error);
r.players.forEach(x => { if (r.phase === 'RESULTS') G.vote(r, x, c0.id); });
assert.equal(r.phase, 'ROUND_WIN'); assert.equal(c0.points, 1); assert.equal(c1.points, 0);
assert(G.vote(r, A, c0.id).error);
// next round resets budgets
r.round = 0; G.vote; r.phase='ROUND_WIN'; r.timers.later && clearTimeout(r.timers.later);
console.log('all tests passed'); process.exit(0);
