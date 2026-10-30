// Darktide stats API: stores uploaded runs in D1, serves them to the webapp,
// and pushes a "runs_updated" message to open webapp tabs over WebSockets.

import { DurableObject } from "cloudflare:workers";

const STAT_FIELDS = [
  "melee_elite_kills", "ranged_elite_kills", "melee_special_kills", "ranged_special_kills",
  "horde_trash_kills", "ranged_trash_kills", "boss_damage", "elite_damage", "horde_damage",
  "specialist_damage", "revives_done", "needed_revives", "ammo_used", "blitz_uses",
  "combat_ability_uses", "damage_taken",
];
const LOADOUT_FIELDS = ["class", "melee_weapon", "ranged_weapon", "blitz", "aura", "combat_ability", "keystones"];
const MAX_PLAYERS = 8;
const MAX_RUNS_PER_UPLOAD = 50;
const MAX_TEXT = 200;
const MAX_SOCKETS = 200;

// ── Live updates ────────────────────────────────────────────────────────────
// One shared object holds every open webapp socket. It uses WebSocket
// hibernation, so idle sockets cost nothing; "ping" is answered automatically.
export class LiveHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
        return new Response("Too many live connections", { status: 503 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const message = await request.text();
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(message); } catch (_) {}
      }
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage() {}

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (_) {}
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
}

// CORS headers for the webapp's origin, if it is on the allowed list.
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(extra || {}) },
  });
}

// Constant-time comparison of the upload token.
function tokenMatches(given, expected) {
  if (!expected || typeof given !== "string") return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

function cleanText(v) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, MAX_TEXT);
}

function cleanInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// "YYYY-MM-DDTHH:MM:SS" from the export's "MM/DD/YYYY" and "HH:MM:SS".
function runKey(date, time) {
  const d = String(date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const t = String(time || "").match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!d || !t) return null;
  let year = parseInt(d[3], 10);
  if (year < 100) year += 2000;
  const pad = n => String(n).padStart(2, "0");
  return `${year}-${pad(d[1])}-${pad(d[2])}T${pad(t[1])}:${pad(t[2])}:${pad(t[3])}`;
}

// A validated run from the upload body, or an error message.
function parseRun(raw) {
  if (!raw || typeof raw !== "object") return { error: "run must be an object" };
  const key = runKey(raw.date, raw.time);
  if (!key) return { error: "run needs date MM/DD/YYYY and time HH:MM:SS" };
  if (!Array.isArray(raw.players) || raw.players.length === 0 || raw.players.length > MAX_PLAYERS) {
    return { error: `run needs 1-${MAX_PLAYERS} players` };
  }
  const players = [];
  for (const p of raw.players) {
    const name = cleanText(p && p.player);
    if (!name) return { error: "every player needs a name" };
    const row = {
      player: name,
      in_game_name: cleanText(p.in_game_name),
      is_known: p.is_known ? 1 : 0,
      sort_order: cleanInt(p.sort_order),
    };
    for (const f of LOADOUT_FIELDS) row[f] = cleanText(p[f]);
    for (const f of STAT_FIELDS) row[f] = cleanInt(p[f]);
    players.push(row);
  }
  const havoc = raw.havoc && raw.havoc.rank !== undefined && raw.havoc.rank !== null
    ? { rank: cleanInt(raw.havoc.rank), mutators: (Array.isArray(raw.havoc.mutators) ? raw.havoc.mutators : []).map(cleanText).filter(Boolean) }
    : null;
  return { run: { key, outcome: cleanText(raw.outcome), havoc, players } };
}

// Insert or update one run and its players.
async function saveRun(db, run, now) {
  const saved = await db.prepare(
    `INSERT INTO runs (run_key, outcome, havoc_rank, havoc_mutators, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(run_key) DO UPDATE SET
       outcome        = COALESCE(excluded.outcome, runs.outcome),
       havoc_rank     = COALESCE(excluded.havoc_rank, runs.havoc_rank),
       havoc_mutators = COALESCE(excluded.havoc_mutators, runs.havoc_mutators),
       updated_at     = excluded.updated_at
     RETURNING id`
  ).bind(
    run.key, run.outcome, run.havoc ? run.havoc.rank : null,
    run.havoc ? JSON.stringify(run.havoc.mutators) : null, now
  ).first();

  const cols = ["run_id", "player", "in_game_name", "is_known", "sort_order", ...LOADOUT_FIELDS, ...STAT_FIELDS];
  const updates = cols.slice(2).map(c => `${c} = excluded.${c}`).join(", ");
  const sql = `INSERT INTO run_players (${cols.join(", ")}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(", ")})
               ON CONFLICT(run_id, player) DO UPDATE SET ${updates}`;
  const stmts = run.players.map(p => db.prepare(sql).bind(saved.id, ...cols.slice(1).map(c => p[c])));
  await db.batch(stmts);
}

// All runs, newest first, in the shape the webapp renders.
async function listRuns(db) {
  const { results } = await db.prepare(
    `SELECT r.run_key, r.outcome, r.havoc_rank, r.havoc_mutators, p.*
     FROM runs r JOIN run_players p ON p.run_id = r.id
     ORDER BY r.run_key DESC, p.sort_order ASC, p.player ASC`
  ).all();

  const runs = [];
  const byKey = new Map();
  for (const row of results) {
    let run = byKey.get(row.run_key);
    if (!run) {
      run = {
        key: row.run_key,
        outcome: row.outcome,
        havoc: row.havoc_rank === null ? null
          : { rank: row.havoc_rank, mutators: row.havoc_mutators ? JSON.parse(row.havoc_mutators) : [] },
        players: [],
      };
      byKey.set(row.run_key, run);
      runs.push(run);
    }
    const stats = {};
    for (const f of STAT_FIELDS) stats[f] = row[f];
    run.players.push({
      player: row.player,
      in_game_name: row.in_game_name,
      is_known: !!row.is_known,
      loadout: LOADOUT_FIELDS.map(f => row[f] || ""),
      stats,
    });
  }
  return runs;
}

// The last /api/runs body this isolate built, reused until the data version
// changes, so repeated page loads read one row instead of every run.
let cachedRuns = { version: undefined, body: null };

async function runsBody(db) {
  const version = await currentVersion(db);
  if (cachedRuns.body && cachedRuns.version === version) return cachedRuns.body;
  const body = JSON.stringify({ version, runs: await listRuns(db) });
  cachedRuns = { version, body };
  return body;
}

async function currentVersion(db) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = 'version'").first();
  return row ? row.value : null;
}

// ── Routes ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url  = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === "/api/live") {
        const origin = request.headers.get("Origin");
        if (origin && !allowedOrigins(env).includes(origin)) return json({ error: "origin not allowed" }, 403);
        const hub = env.LIVE.get(env.LIVE.idFromName("global"));
        return hub.fetch(new Request("https://live/connect", request));
      }

      if (url.pathname === "/api/runs" && request.method === "GET") {
        return new Response(await runsBody(env.DB), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
        });
      }

      if (url.pathname === "/api/version" && request.method === "GET") {
        return json({ version: await currentVersion(env.DB) }, 200, cors);
      }

      if (url.pathname === "/api/runs" && request.method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        if (!tokenMatches(auth.replace(/^Bearer\s+/i, ""), env.UPLOAD_TOKEN)) {
          return json({ error: "unauthorized" }, 401);
        }
        const body = await request.json().catch(() => null);
        const rawRuns = body && Array.isArray(body.runs) ? body.runs : [body];
        if (rawRuns.length === 0 || rawRuns.length > MAX_RUNS_PER_UPLOAD) {
          return json({ error: `send 1-${MAX_RUNS_PER_UPLOAD} runs` }, 400);
        }
        const runs = [];
        for (const raw of rawRuns) {
          const parsed = parseRun(raw);
          if (parsed.error) return json({ error: parsed.error }, 400);
          runs.push(parsed.run);
        }

        const now = new Date().toISOString();
        for (const run of runs) await saveRun(env.DB, run, now);
        await env.DB.prepare(
          "INSERT INTO meta (key, value) VALUES ('version', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(now).run();

        const hub = env.LIVE.get(env.LIVE.idFromName("global"));
        ctx.waitUntil(hub.fetch("https://live/broadcast", {
          method: "POST",
          body: JSON.stringify({ type: "runs_updated", version: now }),
        }));
        return json({ ok: true, saved: runs.map(r => r.key), version: now });
      }

      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "server error" }, 500, cors);
    }
  },
};
