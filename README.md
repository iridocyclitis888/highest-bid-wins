# Highest Bid Wins
Browser-based multiplayer party game. Node + Express + Socket.IO server (authoritative); static mobile-first client (no build step).

## Run locally
    npm install
    npm start        # http://localhost:3000
Test multiplayer: open the URL in several browser windows (use a private window per extra player) or on phones via your LAN IP (`http://192.168.x.x:3000`).
Engine tests (no network needed): `npm test`.

## Deploy
Any host with WebSocket support (Render, Railway, Fly.io). Build command `npm install`, start command `npm start`; HTTPS is provided by the host. The server also serves `client/`, so one service is enough. To host the client elsewhere, set `window.SERVER_URL` before the main script and `CLIENT_ORIGIN` on the server (CORS). Env: `PORT`, `CLIENT_ORIGIN`.

## Rules as implemented
Everyone gets a fresh budget ($20 for 3 players, +$10 per extra player) at the start of every round (topic). Only the current high bidder has money held: bidding holds your full bid, and you are refunded the moment someone outbids you. The current high bidder cannot pass. A bidder who can't afford the next raise is auto-passed. Disconnected bidders are auto-passed after 15s. Each round ends with a vote among that round's bidders (winner earns 1 point; ties re-vote once, then random); most points after every round wins. Future items never leave the server (the Auctioneer alone sees their own remaining list).

## Known limitations
Rooms live in server memory (lost on restart). Plain-JS client rather than React/TS. No PWA manifest. Disconnected Auctioneer pauses the game indefinitely. Not yet exercised with real browsers.
