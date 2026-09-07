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
        const r = await pool.query('SELECT numero, creds, updated_at FROM titan_sessions ORDER BY numero');
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

module.exports = {
    enabled,
    loadPremiumNumbers,
    addPremiumNumber,
    removePremiumNumber,
    saveSession,
    listSessions,
    removeSession,
};
