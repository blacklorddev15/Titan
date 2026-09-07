// TITAN ANIME MD — optional Neon sync (same pattern as the crasher bot).
//
// When DATABASE_URL / NEON_DATABASE_URL is set (and the 'pg' package is
// installed), the bot also mirrors data into the shared Neon database:
//   - premium whitelist   (table: titan_bot_premium)
//   - WhatsApp session creds (table: titan_sessions)
// Without a database URL the bot keeps working exactly as before (local JSON
// files only). Any database error is swallowed on purpose, so the bot never
// breaks when Neon is unreachable.

'use strict';

const cachedUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';
const enabled = Boolean(cachedUrl);

function makePool() {
    const pg = require('pg');
    const ssl = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(cachedUrl)
        ? false
        : { rejectUnauthorized: false };
    return new pg.Pool({
        connectionString: cachedUrl,
        connectionTimeoutMillis: 8000,
        max: 2,
        ssl,
    });
}

async function ensureTables(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS titan_bot_premium (
        number   text PRIMARY KEY,
        added_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS titan_sessions (
        numero     text PRIMARY KEY,
        creds      jsonb NOT NULL,
        sid        text,
        updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    // migrate older tables created before the sid column existed
    await pool.query(`ALTER TABLE titan_sessions ADD COLUMN IF NOT EXISTS sid text`);
    await pool.query(`CREATE TABLE IF NOT EXISTS titan_pair_requests (
        id         serial PRIMARY KEY,
        phone      text NOT NULL,
        status     text NOT NULL DEFAULT 'pending',
        code       text,
        error      text,
        sid        text,
        created_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS titan_heartbeat (
        id           int PRIMARY KEY,
        status       text NOT NULL,
        last_seen    timestamptz NOT NULL DEFAULT now(),
        premium_mode boolean NOT NULL DEFAULT false,
        extra        jsonb NOT NULL DEFAULT '{}'::jsonb
    )`);
}

// ── premium ─────────────────────────────────────────────────────────
async function loadPremiumNumbers() {
    if (!enabled) return null;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        const r = await pool.query('SELECT number FROM titan_bot_premium');
        return r.rows.map((x) => x.number);
    } catch (e) {
        return null;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function addPremiumNumber(number) {
    if (!enabled || !number) return false;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        await pool.query(
            `INSERT INTO titan_bot_premium (number, added_at) VALUES ($1, now())
             ON CONFLICT (number) DO NOTHING`,
            [String(number).replace(/[^0-9]/g, '')]
        );
        return true;
    } catch (e) {
        return false;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function removePremiumNumber(number) {
    if (!enabled || !number) return;
    let pool = null;
    try {
        pool = makePool();
        await pool.query('DELETE FROM titan_bot_premium WHERE number = $1', [String(number).replace(/[^0-9]/g, '')]);
    } catch (e) {
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

// ── WhatsApp session creds mirror ──────────────────────────────────
async function saveSession(numero, creds, sid) {
    if (!enabled || !creds) return false;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        await pool.query(
            `INSERT INTO titan_sessions (numero, creds, sid, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (numero) DO UPDATE SET creds = EXCLUDED.creds, sid = EXCLUDED.sid, updated_at = now()`,
            [String(numero).replace(/[^0-9]/g, ''), JSON.stringify(creds), sid ? String(sid) : null]
        );
        return true;
    } catch (e) {
        return false;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function listSessions() {
    if (!enabled) return [];
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        const r = await pool.query('SELECT numero, creds, sid, updated_at FROM titan_sessions ORDER BY numero');
        return r.rows;
    } catch (e) {
        return [];
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function removeSession(numero) {
    if (!enabled) return;
    let pool = null;
    try {
        pool = makePool();
        await pool.query('DELETE FROM titan_sessions WHERE numero = $1', [String(numero).replace(/[^0-9]/g, '')]);
    } catch (e) {
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

// ── pairbridge: website requests <-> this bot, via Neon ─────────
async function heartbeat(online, extra = {}) {
    if (!enabled) return;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        await pool.query(
            `INSERT INTO titan_heartbeat (id, status, last_seen, premium_mode, extra)
             VALUES (1, $1, now(), $2, $3::jsonb)
             ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_seen = now(),
                 premium_mode = EXCLUDED.premium_mode, extra = EXCLUDED.extra`,
            [online ? 'online' : 'offline', Boolean(extra.premiumMode), JSON.stringify(extra || {})]
        );
    } catch (e) {
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function getHeartbeat() {
    if (!enabled) return null;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        const r = await pool.query('SELECT status, last_seen, premium_mode, extra FROM titan_heartbeat WHERE id = 1');
        return r.rows[0] || null;
    } catch (e) {
        return null;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function claimPendingPair() {
    if (!enabled) return null;
    let pool = null;
    try {
        pool = makePool();
        await ensureTables(pool);
        const r = await pool.query(
            `UPDATE titan_pair_requests
                SET status = 'claimed', claimed_at = now(), updated_at = now()
              WHERE id = (SELECT id FROM titan_pair_requests
                           WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
              RETURNING id, phone, created_at`
        );
        return r.rows[0] || null;
    } catch (e) {
        return null;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function completePair(id, patch) {
    if (!enabled || !id) return false;
    let pool = null;
    try {
        pool = makePool();
        const code = patch.code || null;
        const error = patch.error || null;
        await pool.query(
            `UPDATE titan_pair_requests
                SET status = $2, code = $3, error = $4, sid = COALESCE($5, sid), updated_at = now()
              WHERE id = $1`,
            [id, error ? 'error' : 'done', code, error, patch.sid || null]
        );
        return true;
    } catch (e) {
        return false;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function getPairRequest(id) {
    if (!enabled || !id) return null;
    let pool = null;
    try {
        pool = makePool();
        const r = await pool.query(
            'SELECT id, phone, status, code, error, created_at, updated_at FROM titan_pair_requests WHERE id = $1',
            [id]
        );
        return r.rows[0] || null;
    } catch (e) {
        return null;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

async function getSessionByNumero(numero) {
    if (!enabled || !numero) return null;
    let pool = null;
    try {
        pool = makePool();
        const r = await pool.query(
            'SELECT numero, creds, sid, updated_at FROM titan_sessions WHERE numero = $1 LIMIT 1',
            [String(numero).replace(/[^0-9]/g, '')]
        );
        return r.rows[0] || null;
    } catch (e) {
        return null;
    } finally {
        if (pool) pool.end().catch(() => {});
    }
}

module.exports = {
    enabled,
    loadPremiumNumbers,
    addPremiumNumber,
    removePremiumNumber,
    saveSession,
    listSessions,
    removeSession,
    heartbeat,
    getHeartbeat,
    claimPendingPair,
    completePair,
    getPairRequest,
    getSessionByNumero,
};
