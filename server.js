// Tiny relay server: serves the game and passes messages between the host and the players in a room.
// Rooms can be public (listed for anyone on the Join screen) or private (code only).
const express = require("express"), http = require("http"), { WebSocketServer } = require("ws");
const app = express();
app.use(express.static(__dirname + "/public"));
const server = http.createServer(app), wss = new WebSocketServer({ server, maxPayload: 1 << 20 });
const rooms = {}; let nextId = 1;
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join(""); } while (rooms[c]); return c; };
const clampMax = n => Math.max(2, Math.min(20, +n || 4));

wss.on("connection", ws => {
  ws.id = nextId++; ws.alive = true; ws.on("pong", () => { ws.alive = true; });
  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "list" && !ws.code) {
      return send(ws, { t: "rooms", rooms: Object.entries(rooms)
        .filter(([, r]) => r.public && !r.started && r.members.size < r.max)
        .map(([code, r]) => ({ code, name: r.name, host: r.hostName, game: r.game, players: r.members.size, max: r.max })) });
    }
    if (m.t === "create" && !ws.code) {
      const code = newCode();
      rooms[code] = { host: ws, members: new Map([[ws.id, ws]]), public: !!m.public, started: false,
        name: String(m.name || "Room").slice(0, 30), hostName: String(m.host || "Host").slice(0, 20),
        game: String(m.game || "auction").slice(0, 20), max: clampMax(m.max) };
      ws.code = code;
      return send(ws, { t: "created", code, id: ws.id });
    }
    if (m.t === "join" && !ws.code) {
      const code = String(m.code || "").toUpperCase(), r = rooms[code];
      if (!r) return send(ws, { t: "err", msg: "Room not found" });
      r.members.set(ws.id, ws); ws.code = code;
      send(ws, { t: "joined", code, id: ws.id });
      return send(r.host, {
        t: "peer-join", id: ws.id,
        name: String(m.name || "Player").slice(0, 16),
        teamName: String(m.teamName || "").slice(0, 20),
        color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : ""
      });
    }
    const r = rooms[ws.code]; if (!r) return;
    if (ws === r.host) {
      // keep the public listing in sync with the host's lobby state
      if (m.t === "lobby" && m.L) { r.started = !!m.L.started; if (m.L.max) r.max = clampMax(m.L.max); if (m.L.room) r.name = String(m.L.room).slice(0, 30); }
      else if (m.t === "snap") r.started = true;
      r.members.forEach((c, id) => { if (c !== ws && (m.to == null || m.to === id)) send(c, m); });
    }
    else if (m.t === "me" || m.t === "act") send(r.host, { ...m, from: ws.id });
  });
  ws.on("close", () => {
    const r = rooms[ws.code]; if (!r) return;
    r.members.delete(ws.id);
    if (r.host === ws) { r.members.forEach(c => send(c, { t: "closed" })); delete rooms[ws.code]; }
    else send(r.host, { t: "peer-left", id: ws.id });
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }), 30000);
server.listen(process.env.PORT || 3000, () => console.log("Running"));
