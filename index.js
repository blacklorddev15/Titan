// ============================================================
//   index.js  v4  –  𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫  |  Telegram × WhatsApp
// ============================================================
'use strict';
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const pino  = require('pino');
const https = require('https');
const http  = require('http');
const { Telegraf, Markup } = require('telegraf');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const settings  = require('./settings');
const { handleMessage, runAutoFollow }  = require('./case');
const { handleAntiDelete, checkAntilink, checkAntiMedia, handleAntiCall, handleGroupParticipantsUpdate } = require('./helper/listeners');
const {
  sessionExists, listSessions, deleteSession, sessionDir,
  getWaSettings, setWaSetting, getAllPairs, getUserPairs,
  addPair, removePair, getAllPairedSessions,
  registerUser, getAllUsers, numOf,
} = require('./helper/function');
const { normalizeJid, ensureDir, formatUptime } = require('./helper/utils');
const { logInfo, logSuccess, logWarn, logError, logSession } = require('./helper/logger');

global.botStartTime = Date.now();
ensureDir(settings.SESSION_DIR);
ensureDir('./database');

// ═══════════════════════════════════════════════════════════
//   PERSISTENT PENDING REPLIES  (survives restarts)
// ═══════════════════════════════════════════════════════════
const PENDING_FILE  = './database/pendingReplies.json';
const PREMIUM_FILE  = './database/prem_data.json';
const ADMIN_FILE    = './database/admin_state.json';

function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const _adminState = loadJSON(ADMIN_FILE, {});
const adminState = {
  mode: _adminState.mode === 'premium' ? 'premium' : 'free',
  keys: Array.isArray(_adminState.keys) ? _adminState.keys : [],
  updatedAt: _adminState.updatedAt || Date.now(),
};
function saveAdminState() {
  adminState.updatedAt = Date.now();
  saveJSON(ADMIN_FILE, adminState);
}
function generateActivationKey() {
  const key = `TITAN-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  adminState.keys.unshift({ key, createdAt: Date.now(), used: false });
  saveAdminState();
  return key;
}

// pendingReplies: ownerMsgId (string) → { userId, chatId }
let pendingRepliesData = loadJSON(PENDING_FILE, {});
const pendingReplies   = new Map(Object.entries(pendingRepliesData));

function savePendingReplies() {
  saveJSON(PENDING_FILE, Object.fromEntries(pendingReplies));
}

// ═══════════════════════════════════════════════════════════
//   PREMIUM SYSTEM
// ═══════════════════════════════════════════════════════════
// Structure: { premOnly: false, owners: ["id",...], premUsers: ["id",...] }
const _rp = loadJSON(PREMIUM_FILE, {});
let premData = { premOnly: !!_rp.premOnly, owners: Array.isArray(_rp.owners) ? _rp.owners : [], premUsers: Array.isArray(_rp.premUsers) ? _rp.premUsers : [] };

function savePrem() { saveJSON(PREMIUM_FILE, premData); }

function isOwner(id) {
  return String(id) === String(settings.OWNER_TELEGRAM_ID) || premData.owners.includes(String(id));
}
function isPremium(id) {
  return isOwner(id) || premData.premUsers.includes(String(id));
}
function canUseBot(id) {
  if (!premData.premOnly) return true; // open to all
  return isPremium(id);
}

// ─────────────────────────────────────────────────────────────
const activeSockets      = new Map();
const notifiedConnected  = new Set();

// Expose activeSockets immediately; _startWhatsApp set in launch() after function is defined
global._activeSockets  = activeSockets;

// ═══════════════════════════════════════════════════════════
//   GITHUB SESSION SYNC
// ═══════════════════════════════════════════════════════════
const GH_TOKEN  = settings.GITHUB_TOKEN  || process.env.GITHUB_TOKEN;
const GH_USER   = settings.GITHUB_USERNAME || process.env.GITHUB_USERNAME;
const GH_REPO   = settings.GITHUB_REPO   || process.env.GITHUB_REPO;
const GH_BRANCH = settings.GITHUB_BRANCH || process.env.GITHUB_BRANCH || 'main';
const GH_BASE   = `/repos/${GH_USER}/${GH_REPO}/contents`;

function ghRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'User-Agent': 'Titananimemd-Bot',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ghListDir(remotePath) {
  const { status, body } = await ghRequest('GET', `${GH_BASE}/${remotePath}?ref=${GH_BRANCH}`);
  if (status !== 200 || !Array.isArray(body)) return [];
  return body;
}

async function ghGetFile(remotePath) {
  const { status, body } = await ghRequest('GET', `${GH_BASE}/${remotePath}?ref=${GH_BRANCH}`);
  if (status !== 200 || !body.content) return null;
  return { content: Buffer.from(body.content.replace(/\n/g, ''), 'base64'), sha: body.sha };
}

async function ghDeleteFile(remotePath, sha, message) {
  return ghRequest('DELETE', `${GH_BASE}/${remotePath}`, { message, sha, branch: GH_BRANCH });
}

async function downloadSessionFromGitHub(sessionId) {
  try {
    const remotePath = `sessions/${sessionId}`;
    const files = await ghListDir(remotePath);
    if (!files.length) return false;
    const localDir = sessionDir(sessionId);
    ensureDir(localDir);
    for (const f of files) {
      if (f.type !== 'file') continue;
      const fileData = await ghGetFile(`${remotePath}/${f.name}`);
      if (!fileData) continue;
      fs.writeFileSync(path.join(localDir, f.name), fileData.content);
      logInfo('GH-SYNC', `Downloaded: ${sessionId}/${f.name}`);
    }
    return true;
  } catch (e) {
    logError('GH-SYNC', `Download failed for ${sessionId}: ${e.message}`);
    return false;
  }
}

async function deleteSessionFromGitHub(sessionId) {
  try {
    const files = await ghListDir(`sessions/${sessionId}`);
    for (const f of files) {
      if (f.type === 'file') await ghDeleteFile(`sessions/${sessionId}/${f.name}`, f.sha, `Logout cleanup: ${sessionId}`);
    }
    logInfo('GH-SYNC', `Deleted from GitHub: ${sessionId}`);
  } catch (e) {
    logError('GH-SYNC', `GH delete failed for ${sessionId}: ${e.message}`);
  }
}

async function syncSessionsFromGitHub() {
  try {
    // Use git trees API – more reliable than contents API for nested dirs
    const { status, body } = await ghRequest('GET', `/repos/${GH_USER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
    if (status !== 200 || !Array.isArray(body.tree)) { logInfo('GH-SYNC', 'No tree data'); return; }

    // Find unique session folder names: paths like sessions/<sessionId>/creds.json
    const sessionIds = new Set();
    for (const item of body.tree) {
      const m = item.path.match(/^sessions\/([^\/]+)\/creds\.json$/);
      if (m) sessionIds.add(m[1]);
    }

    if (!sessionIds.size) { logInfo('GH-SYNC', 'No remote sessions'); return; }

    for (const sid of sessionIds) {
      if (!sessionExists(sid)) {
        logInfo('GH-SYNC', `Downloading: ${sid}`);
        await downloadSessionFromGitHub(sid);
      } else {
        logInfo('GH-SYNC', `Already local: ${sid}`);
      }
    }
  } catch (e) {
    logError('GH-SYNC', `Sync error: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
//   LIVE SESSION WATCHER  – picks up new web_ sessions from
//   GitHub every 30s without needing a panel restart
// ═══════════════════════════════════════════════════════════
function startSessionWatcher() {
  setInterval(async () => {
    try {
      const { status, body } = await ghRequest('GET', `/repos/${GH_USER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`);
      if (status !== 200 || !Array.isArray(body.tree)) return;

      const sessionIds = new Set();
      for (const item of body.tree) {
        const m = item.path.match(/^sessions\/([^\/]+)\/creds\.json$/);
        if (m) sessionIds.add(m[1]);
      }

      for (const sid of sessionIds) {
        if (activeSockets.has(sid)) continue;       // already running
        if (!sessionExists(sid)) {
          logInfo('WATCHER', `New session detected: ${sid}`);
          await downloadSessionFromGitHub(sid);
        }
        if (sessionExists(sid) && !activeSockets.has(sid)) {
          logInfo('WATCHER', `Starting: ${sid}`);
          // find tgUserId from pairs
          let tgUserId = null;
          const allPairs = getAllPairs();
          for (const [uid, pairs] of Object.entries(allPairs)) {
            if (pairs.find(p => p.sessionId === sid)) { tgUserId = uid; break; }
          }
          notifiedConnected.add(sid); // suppress connect notification
          startWhatsApp(sid, null, null, tgUserId).catch(e => logError('WATCHER', e.message));
        }
      }
    } catch {}
  }, 1000);
  logSuccess('WATCHER', 'Live session watcher started (30s interval)');
}

// ═══════════════════════════════════════════════════════════
//   SELF-PING
// ═══════════════════════════════════════════════════════════
function startPingLoop() {
  const urls = [settings.PANEL_URL, settings.WEBSITE_URL].filter(Boolean);

  // tiny health server so Render/external monitors can hit it
  http.createServer((req, res) => {
    const uptime = formatUptime(Date.now() - global.botStartTime);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'alive', uptime, sessions: activeSockets.size }));
  }).listen(Number(process.env.HEALTH_PORT || 3001), '0.0.0.0', () => {
    logSuccess('PING', `Health server :${process.env.PORT || 3001}`);
  });

  setInterval(() => {
    const uptime = formatUptime(Date.now() - global.botStartTime);
    process.stdout.write(chalk.gray(`[UPTIME] ${uptime}\n`));
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.get(url, res => logInfo('PING', `${url} → ${res.statusCode}`));
        req.on('error', () => {});
        req.setTimeout(8000, () => req.destroy());
      } catch {}
    }
  }, 4 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════
//   TELEGRAM BOT
// ═══════════════════════════════════════════════════════════
const bot = new Telegraf(settings.TELEGRAM_TOKEN);

// ── /start ────────────────────────────────────────────────────
bot.start(async (ctx) => {
  registerUser(ctx.from.id, ctx.from.first_name);
  const allUsers   = Object.keys(getAllUsers()).length;
  const myPairs    = getUserPairs(ctx.from.id);
  const activeMine = myPairs.filter(p => activeSockets.has(p.sessionId)).length;
  const uptime     = formatUptime(Date.now() - global.botStartTime);
  const premStatus = premData.premOnly ? '🔒 Premium Only' : '🌐 Public';

  const ownerCmds = isOwner(ctx.from.id) ? `
┃❐ /broadcast
┃❐ /listsession
┃❐ /premonly
┃❐ /addprem <id>
┃❐ /delprem <id>
┃❐ /listprem
┃❐ /addowner <id>` : '';

  const text =
`❐  ⌜𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 ⌟  ❐
┃➥ owner : ${settings.OWNER_NAME || 'diego'}
┃➥ user : ${ctx.from.first_name}
┃➥ uptime : ${uptime}
┃➥ Status : ${premStatus}
┃➥ speed : fast
┃➥ active sessions : ${activeMine}/${myPairs.length}
┃➥ Prefix : /
┃➥ all users : ${allUsers}
┗❐

❐  ⌜ 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦⌟  ❐
┃❐ /pair
┃❐ /delpair
┃❐ /listpaired
┃❐ /reportissue <msg>${ownerCmds}
┗❐`;

  const btns = Markup.inlineKeyboard([
    [
      Markup.button.url('🔵 Channel', settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1'),
      Markup.button.url('🟢 Group',   settings.REQUIRED_GROUP_LINK   || 'https://t.me/teleempirepentagon'),
    ],
    [
      Markup.button.callback('📱 How to pair', 'pair_help'),
      Markup.button.callback('📋 My sessions', 'my_sessions'),
    ],
  ]);

  try {
    await ctx.replyWithPhoto({ url: settings.DEFAULT_MENU_IMG }, { caption: text, parse_mode: 'Markdown', ...btns });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...btns });
  }
});

bot.action('pair_help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `📱 *How to Pair*\n\nSend:\n\`/pair 254704955033\`\n\nReplace with your WA number with country code, no +\n\n🇰🇪 Kenya: 254XXXXXXXXX\n🇳🇬 Nigeria: 234XXXXXXXXX\n🇺🇸 USA: 1XXXXXXXXXX`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('◀️ Back', 'back_start')]]),
    }
  );
});

bot.action('my_sessions', async (ctx) => {
  await ctx.answerCbQuery();
  const pairs = getUserPairs(String(ctx.from.id));
  if (!pairs.length) {
    return ctx.reply('📱 *My Sessions*\n\nNo sessions yet.\nUse /pair <number> to link a WhatsApp number.', { parse_mode: 'Markdown' });
  }
  const list = pairs.map((p, i) =>
    `${i+1}. +${p.waNum} ${activeSockets.has(p.sessionId) ? '🟢 Online' : '🔴 Offline'}`
  ).join('\n');
  await ctx.reply(`📱 *My Sessions (${pairs.length})*\n\n${list}`, { parse_mode: 'Markdown' });
});

bot.action('back_start', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Use /start to see the main menu.');
});

// ═══════════════════════════════════════════════════════════
//   PREMIUM COMMANDS  (owner / addowner only)
// ═══════════════════════════════════════════════════════════

// /premonly  – toggle premium-only mode
bot.command('premonly', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  premData.premOnly = !premData.premOnly;
  savePrem();
  await ctx.reply(premData.premOnly
    ? '🔒 *Premium-only mode ON* – only premium users & owners can pair.'
    : '🌐 *Premium-only mode OFF* – all users can pair.',
    { parse_mode: 'Markdown' });
});

// /addprem <telegram_id>  – grant premium
bot.command('addprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /addprem <telegram_id>');
  if (premData.premUsers.includes(target)) return ctx.reply(`ℹ️ ${target} is already premium.`);
  premData.premUsers.push(target);
  savePrem();
  await ctx.reply(`✅ Added *${target}* as premium user.`, { parse_mode: 'Markdown' });
});

// /delprem <telegram_id>  – revoke premium
bot.command('delprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /delprem <telegram_id>');
  const idx = premData.premUsers.indexOf(target);
  if (idx === -1) return ctx.reply(`ℹ️ ${target} is not premium.`);
  premData.premUsers.splice(idx, 1);
  savePrem();
  await ctx.reply(`🗑 Removed *${target}* from premium.`, { parse_mode: 'Markdown' });
});

// /listprem  – list premium users & owners
bot.command('listprem', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const mode    = premData.premOnly ? '🔒 Premium-only ON' : '🌐 Premium-only OFF';
  const owners  = [String(settings.OWNER_TELEGRAM_ID), ...premData.owners].join('\n') || 'none';
  const prems   = premData.premUsers.join('\n') || 'none';
  await ctx.reply(
    `*Premium Status*\n${mode}\n\n*Owners:*\n${owners}\n\n*Premium Users:*\n${prems}`,
    { parse_mode: 'Markdown' }
  );
});

// /addowner <telegram_id>  – promote to sub-owner (main owner only)
bot.command('addowner', async (ctx) => {
  if (String(ctx.from.id) !== String(settings.OWNER_TELEGRAM_ID)) return ctx.reply('❌ Main owner only.');
  const target = ctx.message.text.split(/\s+/)[1];
  if (!target) return ctx.reply('Usage: /addowner <telegram_id>');
  if (premData.owners.includes(target)) return ctx.reply(`ℹ️ ${target} is already an owner.`);
  premData.owners.push(target);
  savePrem();
  await ctx.reply(`✅ Promoted *${target}* to owner.`, { parse_mode: 'Markdown' });
});

// ── /pair <number> – unlimited per user ──────────────────────
bot.command('pair', async (ctx) => {
  registerUser(ctx.from.id, ctx.from.first_name);

  // Premium gate
  if (!canUseBot(ctx.from.id)) {
    return ctx.reply('🔒 *Bot is in premium-only mode.*\nContact the owner to get access.', { parse_mode: 'Markdown' });
  }

  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone || phone.length < 7) {
    return ctx.reply('Usage: `/pair 254716951223`', { parse_mode: 'Markdown' });
  }

  const uid       = String(ctx.from.id);
  const sessionId = `wa_${uid}_${phone}`;

  if (activeSockets.has(sessionId)) {
    return ctx.reply(`✅ +${phone} already connected!\nUse /delpair ${phone} to disconnect.`);
  }
  if (sessionExists(sessionId)) {
    await ctx.reply(`♻️ Reconnecting +${phone}...`);
    await startWhatsApp(sessionId, ctx.chat.id, null, uid);
    return;
  }

  await ctx.reply(`🔄 Pairing *+${phone}*...`, { parse_mode: 'Markdown' });
  await startWhatsApp(sessionId, ctx.chat.id, phone, uid);
});

// ── /delpair <number> – instant no confirmation ───────────────
bot.command('delpair', async (ctx) => {
  const phone = ctx.message.text.split(/\s+/)[1]?.replace(/\D/g, '');
  if (!phone) return ctx.reply('Usage: /delpair 254716951223');

  const uid       = String(ctx.from.id);
  const sessionId = `wa_${uid}_${phone}`;

  const sock = activeSockets.get(sessionId);
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.ws?.close(); }   catch {}
    activeSockets.delete(sessionId);
  }

  notifiedConnected.delete(sessionId);
  removePair(uid, sessionId);
  const ok = deleteSession(sessionId);
  deleteSessionFromGitHub(sessionId).catch(() => {});
  await ctx.reply(ok
    ? `🗑 +${phone} deleted. Use /pair ${phone} to reconnect.`
    : `ℹ️ No session found for +${phone}.`
  );
});

// ── /listpaired ───────────────────────────────────────────────
bot.command('listpaired', async (ctx) => {
  const pairs = getUserPairs(String(ctx.from.id));
  if (!pairs.length) return ctx.reply('No paired numbers. Use /pair <number>');
  const list = pairs.map((p, i) => `${i+1}. +${p.waNum} ${activeSockets.has(p.sessionId) ? '🟢' : '🔴'}`).join('\n');
  await ctx.reply(`📱 *Your numbers (${pairs.length}):*\n\n${list}`, { parse_mode: 'Markdown' });
});

// ── /listsession (owner) ──────────────────────────────────────
bot.command('listsession', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  const list = listSessions();
  if (!list.length) return ctx.reply('No sessions.');
  const text = list.map((s, i) => `${i+1}. \`${s}\` ${activeSockets.has(s) ? '🟢' : '🔴'}`).join('\n');
  await ctx.reply(`📋 *Sessions (${list.length})*\n\n${text}`, { parse_mode: 'Markdown' });
});

// ═══════════════════════════════════════════════════════════
//   BROADCAST  –  supports text, photo, video, audio,
//                 document, sticker, animation, voice,
//                 inline buttons (via | syntax in caption)
//
//   Flow:
//     1. Owner sends /broadcast
//     2. Bot asks "Send your broadcast message now"
//     3. Owner sends ANY message type (optionally with caption)
//     4. Bot forwards it to all users
//
//   Inline button syntax (add to caption/text):
//     [Button Label | https://link.com]
//     [Btn1 | url1] [Btn2 | url2]   ← same row
//     [Btn3 | url3]                  ← new row
//
// ═══════════════════════════════════════════════════════════

// Tracks owners waiting to send their broadcast message
const broadcastPending = new Set();

// Parse [Label | URL] button syntax from text/caption
function parseBroadcastButtons(text) {
  if (!text) return { clean: text || '', markup: null };
  const btnRegex = /\[([^\]|]+)\|([^\]]+)\]/g;
  const rows = [];
  let currentRow = [];
  let lastIndex = 0;
  let clean = text;
  let match;

  // Collect all button matches
  const matches = [];
  while ((match = btnRegex.exec(text)) !== null) matches.push(match);

  if (!matches.length) return { clean: text, markup: null };

  // Build rows – buttons on the same line go in same row
  // We detect same-line by checking if there's a newline between consecutive matches
  for (let i = 0; i < matches.length; i++) {
    const m      = matches[i];
    const label  = m[1].trim();
    const url    = m[2].trim();
    const before = i === 0 ? text.slice(0, m.index) : text.slice(matches[i-1].index + matches[i-1][0].length, m.index);
    if (i > 0 && before.includes('\n')) { if (currentRow.length) rows.push(currentRow); currentRow = []; }
    currentRow.push(Markup.button.url(label, url));
  }
  if (currentRow.length) rows.push(currentRow);

  // Strip button syntax from clean text
  clean = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '').replace(/\n{3,}/g, '\n\n').trim();

  return { clean, markup: rows.length ? Markup.inlineKeyboard(rows) : null };
}

// Send one broadcast unit to a single uid
async function sendBroadcastToUser(uid, msg) {
  const tg      = bot.telegram;
  const rawText = msg.text || msg.caption || '';
  const { clean, markup } = parseBroadcastButtons(rawText);
  const extra   = { parse_mode: 'Markdown', ...(markup || {}) };

  if (msg.sticker)    return tg.sendSticker(uid, msg.sticker.file_id, markup ? { reply_markup: markup.reply_markup } : {});
  if (msg.animation)  return tg.sendAnimation(uid, msg.animation.file_id, { caption: clean, ...extra });
  if (msg.video_note) return tg.sendVideoNote(uid, msg.video_note.file_id);
  if (msg.voice)      return tg.sendVoice(uid, msg.voice.file_id, { caption: clean, ...extra });
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1];
    return tg.sendPhoto(uid, photo.file_id, { caption: clean, ...extra });
  }
  if (msg.video)    return tg.sendVideo(uid, msg.video.file_id, { caption: clean, ...extra });
  if (msg.audio)    return tg.sendAudio(uid, msg.audio.file_id, { caption: clean, ...extra });
  if (msg.document) return tg.sendDocument(uid, msg.document.file_id, { caption: clean, ...extra });
  if (msg.text)     return tg.sendMessage(uid, clean || msg.text, extra);
  // Fallback: forward as-is
  return tg.forwardMessage(uid, msg.chat.id, msg.message_id);
}

bot.command('broadcast', async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.reply('❌ Owner only.');
  broadcastPending.add(String(ctx.from.id));
  await ctx.reply(
    `📢 *Broadcast Setup*\n\nNow send the message you want to broadcast.\nSupported: text, photo, video, audio, document, sticker, voice, animation.\n\n*Optional inline buttons* – add to caption/text:\n\`[Button Label | https://url.com]\`\n\nSend /cancel to abort.`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('cancel', async (ctx) => {
  if (broadcastPending.has(String(ctx.from.id))) {
    broadcastPending.delete(String(ctx.from.id));
    return ctx.reply('❌ Broadcast cancelled.');
  }
  return ctx.reply('Nothing to cancel.');
});

// Intercept the actual broadcast message from owner
bot.on('message', async (ctx, next) => {
  const oid = String(ctx.from?.id);
  if (!broadcastPending.has(oid)) return next();
  broadcastPending.delete(oid);

  const users    = getAllUsers();
  const uids     = Object.keys(users);
  const progress = await ctx.reply(`📤 Broadcasting to ${uids.length} users...`);
  let sent = 0, failed = 0;

  for (const uid of uids) {
    try {
      await sendBroadcastToUser(uid, ctx.message);
      sent++;
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 80)); // ~12/sec, safe for Telegram limits
  }

  await bot.telegram.editMessageText(
    ctx.chat.id, progress.message_id, null,
    `✅ *Broadcast done!*\n📨 Sent: ${sent}\n❌ Failed: ${failed}`,
    { parse_mode: 'Markdown' }
  );
});

// ── /reportissue ──────────────────────────────────────────────
bot.command('reportissue', async (ctx) => {
  const report = ctx.message.text.replace(/^\/reportissue\s*/, '').trim();
  if (!report) return ctx.reply('/reportissue <problem>');
  try {
    const sent = await bot.telegram.sendMessage(
      settings.OWNER_TELEGRAM_ID,
      `📢 *Issue*\nFrom: ${ctx.from.first_name} (ID: \`${ctx.from.id}\`)\n\n${report}`,
      { parse_mode: 'Markdown' }
    );
    // Persist to disk so late replies after restart still work
    pendingReplies.set(String(sent.message_id), { userId: ctx.from.id, chatId: ctx.chat.id });
    savePendingReplies();
    await ctx.reply('✅ Reported! Owner will reply to you here.');
  } catch { await ctx.reply('❌ Failed to send.'); }
});

// ── Owner replies → forward to reporter (supports media) ─────
// Works even if bot restarted before owner replied — loaded from disk on startup
bot.on('message', async (ctx, next) => {
  if (String(ctx.from?.id) !== String(settings.OWNER_TELEGRAM_ID)) return next();
  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId) return next();
  const pending = pendingReplies.get(String(replyToId));
  if (!pending) return next();
  try {
    const tg  = bot.telegram;
    const uid = pending.userId;
    const m   = ctx.message;
    const cap = m.caption || m.text || '';
    const extra = { caption: `💬 *Reply from owner:*\n\n${cap}`, parse_mode: 'Markdown' };

    if (m.sticker)    await tg.sendSticker(uid, m.sticker.file_id);
    else if (m.animation)  await tg.sendAnimation(uid, m.animation.file_id, extra);
    else if (m.voice)      await tg.sendVoice(uid, m.voice.file_id, extra);
    else if (m.video_note) await tg.sendVideoNote(uid, m.video_note.file_id);
    else if (m.photo) {
      const photo = m.photo[m.photo.length - 1];
      await tg.sendPhoto(uid, photo.file_id, extra);
    }
    else if (m.video)    await tg.sendVideo(uid, m.video.file_id, extra);
    else if (m.audio)    await tg.sendAudio(uid, m.audio.file_id, extra);
    else if (m.document) await tg.sendDocument(uid, m.document.file_id, extra);
    else await tg.sendMessage(uid, `💬 *Reply from owner:*\n\n${m.text || '[message]'}`, { parse_mode: 'Markdown' });

    pendingReplies.delete(String(replyToId));
    savePendingReplies();
    await ctx.reply('✅ Reply sent to user.');
  } catch { await ctx.reply('❌ Could not reach user.'); }
});

// ═══════════════════════════════════════════════════════════
//   WHATSAPP SESSION STARTER
// ═══════════════════════════════════════════════════════════
async function startWhatsApp(sessionId, telegramChatId = null, pairPhone = null, tgUserId = null, pairingCodeCallback = null) {
  const dir = sessionDir(sessionId);
  ensureDir(dir);

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    keepAliveIntervalMs:            15000,
    printQRInTerminal:              false,
    logger:                         pino({ level: 'silent' }),
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser:                        ['Ubuntu', 'Chrome', '120.0.0.0'],
    syncFullHistory:                false,
    markOnlineOnConnect:            false,
    generateHighQualityLinkPreview: false,
  });

  sock.__sessionId = sessionId;
  const _phoneFromSid = sessionId.split('_').pop();
  if (_phoneFromSid && /^\d{7,}$/.test(_phoneFromSid)) sock.__waNum = _phoneFromSid;
  activeSockets.set(sessionId, sock);
  sock.__pairPhone = pairPhone || null;
  sock.ev.on('creds.update', saveCreds);

  // Optional Neon mirror of this session's creds (like the crasher bot),
  // throttled to at most one write per ~15s per number.
  try {
    const neonDb = require('./database/neon');
    if (neonDb.enabled) {
      let lastNeonWrite = 0;
      sock.ev.on('creds.update', async () => {
        const now = Date.now();
        if (now - lastNeonWrite < 15000) return;
        lastNeonWrite = now;
        const n = String(sock.__waNum || sessionId || '').replace(/[^0-9]/g, '');
        if (!n || !/^\d{7,15}$/.test(n) || !state.creds) return;
        neonDb.saveSession(n, state.creds, sessionId).catch(() => {});
      });
    }
  } catch (e) { /* Neon module unavailable — local files only */ }

  // ── Pairing code ──────────────────────────────────────────
  // WhatsApp must generate a fresh one-time code. Do not pass a custom
  // second argument here: it can produce a reused/static code such as
  // TITA-NMD1 that remains stuck on "Logging in…".
  if (!state.creds.registered && pairPhone) {
    setTimeout(async () => {
      try {
        const rawCode = await sock.requestPairingCode(pairPhone, 'TITANMD1');
        const code = rawCode ? (String(rawCode).match(/.{1,4}/g) || [String(rawCode)]).join('-') : rawCode;
        if (!code) throw new Error('WhatsApp returned an empty pairing code.');

        // If a WA-side callback was provided (from the website bridge), use it.
        if (typeof pairingCodeCallback === 'function') {
          await pairingCodeCallback(code);
        } else if (telegramChatId) {
          const msg = `🔑 *Pairing Code for +${pairPhone}*\n\n\`${code}\`\n\nOpen WhatsApp → Linked Devices → Link a device → Link with phone number`;
          await bot.telegram.sendMessage(telegramChatId, msg, { parse_mode: 'Markdown' });
        }
      } catch (e) {
        if (typeof pairingCodeCallback === 'function') Promise.resolve(pairingCodeCallback(null)).catch(() => {});
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `❌ Pairing failed: ${e.message}`).catch(()=>{});
      }
    }, 4000);
  }

  // ── Connection state ──────────────────────────────────────
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      activeSockets.delete(sessionId);
      logSession(sessionId, 'disconnected');
      if (code === DisconnectReason.loggedOut) {
        logWarn(sessionId, 'Logged out – deleting session');
        notifiedConnected.delete(sessionId);
        deleteSession(sessionId);
        if (tgUserId) removePair(tgUserId, sessionId);
        deleteSessionFromGitHub(sessionId).catch(() => {});
        // drop the stored Neon creds too, so a deleted session is not revived on next boot
        try {
          const neonDb = require('./database/neon');
          const gone = String(sock.__waNum || pairPhone || '').replace(/[^0-9]/g, '');
          if (neonDb.enabled && gone && /^\d{7,15}$/.test(gone)) neonDb.removeSession(gone).catch(() => {});
        } catch (e) { /* Neon unavailable */ }
        if (telegramChatId) bot.telegram.sendMessage(telegramChatId, `🚪 +${sock.__waNum||pairPhone} logged out & session deleted.\nUse /pair to reconnect.`).catch(()=>{});
      } else {
        logWarn(sessionId, 'Reconnecting...');
        // Keep the phone number for an unregistered session so a transient
        // socket close does not reconnect without a pairing-code request.
        const reconnectPhone = sock.__pairPhone || null;
        setTimeout(() => startWhatsApp(sessionId, telegramChatId, reconnectPhone, tgUserId).catch(() => {}), 3000);
      }
    }

    if (connection === 'open') {
      const waNum  = numOf(sock.user?.id || '');
      sock.__waNum = waNum;

      if (tgUserId) addPair(tgUserId, sessionId, waNum);
      const c = getWaSettings(waNum);
      if (!c.owner) setWaSetting(waNum, 'owner', waNum);

      logSession(sessionId, 'connected');
      logSuccess(sessionId, `wa.me/${waNum}`);

      if (telegramChatId && !notifiedConnected.has(sessionId)) {
        notifiedConnected.add(sessionId);
        bot.telegram.sendMessage(telegramChatId,
          `✅ *Connected!*\nNumber: wa.me/${waNum}`,
          { parse_mode: 'Markdown' }
        ).catch(()=>{});
      }

      runAutoFollow(sock).catch(()=>{});
    }
  });

  // ── Messages ──────────────────────────────────────────────
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (!m?.message) continue;
      if (m.message.ephemeralMessage) m.message = m.message.ephemeralMessage.message;
      (async () => {
        const chatMeta = { groupName: '' };
        if (m.key.remoteJid?.endsWith('@g.us')) {
          try { const meta = await sock.groupMetadata(m.key.remoteJid); chatMeta.groupName = meta.subject || ''; } catch {}
        }
        await checkAntilink(sock, m);
        await checkAntiMedia(sock, m);
        await handleMessage(sock, m, chatMeta);
      })().catch(e => logError(sessionId, e.message));
    }
  });

  // ── Anti-delete ───────────────────────────────────────────
  sock.ev.on('messages.delete', (update) => {
    if (!update?.keys?.length) return;
    handleAntiDelete(sock, update).catch(()=>{});
  });

  // ── Group participant updates ──────────────────────────────
  sock.ev.on('group-participants.update', (update) => {
    handleGroupParticipantsUpdate(sock, update).catch(()=>{});
  });

  // ── Call events ───────────────────────────────────────────
  sock.ev.on('call', (call) => {
    handleAntiCall(sock, call).catch(()=>{});
  });

  return sock;
}

// ═══════════════════════════════════════════════════════════
//   RELOAD ALL SESSIONS ON STARTUP
// ═══════════════════════════════════════════════════════════
async function reloadSessions() {
  await syncSessionsFromGitHub();

  // Neon-backed auto reconnect (like the crasher worker): sessions whose creds
  // live in the shared database but are missing on this server's disk are
  // written locally and started below — no re-pairing needed after a host move.
  try {
    const neonDb = require('./database/neon');
    if (neonDb.enabled) {
      const rows = await neonDb.listSessions();
      const onDisk = new Set(listSessions());
      let restored = 0;
      for (const row of rows) {
        if (!row || !row.sid || onDisk.has(row.sid) || !row.creds) continue;
        const dir = sessionDir(row.sid);
        ensureDir(dir);
        fs.writeFileSync(path.join(dir, 'creds.json'), JSON.stringify(row.creds));
        onDisk.add(row.sid);
        restored++;
        logInfo('STARTUP', `Restored session from Neon: ${row.sid}`);
      }
      if (restored) logSuccess('STARTUP', `Restored ${restored} session(s) from Neon`);
    }
  } catch (e) {
    logWarn('STARTUP', `Neon session restore skipped: ${e.message}`);
  }

  const list = listSessions();
  logInfo('STARTUP', `Reloading ${list.length} session(s)`);
  const allPairs = getAllPairs();

  list.forEach((sid, i) => {
    let tgUserId = null;
    for (const [uid, pairs] of Object.entries(allPairs)) {
      if (pairs.find(p => p.sessionId === sid)) { tgUserId = uid; break; }
    }
    notifiedConnected.add(sid);
    setTimeout(() => startWhatsApp(sid, null, null, tgUserId).catch(e => logError(sid, e.message)), i * 1200);
  });
}

// ── Neon pairbridge poller ────────────────────────────────────────
// The website drops a pairing request into the shared Neon database
// (titan_pair_requests); this loop claims it, performs the pairing and
// writes the code back — same pattern as the crasher worker. A heartbeat
// row keeps the dashboard's ONLINE/paired stats fresh.
async function startNeonBridge() {
  const neonDb = require('./database/neon');
  if (!neonDb.enabled) {
    logWarn('NEON', 'DATABASE_URL missing — Neon pairing bridge disabled');
    return;
  }
  logSuccess('NEON', 'Pairing bridge started (heartbeat + request poll every 5s)');
  const tick = async () => {
    try {
      const req = await neonDb.claimPendingPair();
      if (req) {
        const phone = String(req.phone).replace(/[^0-9]/g, '');
        logInfo('NEON', `Pair request #${req.id} for +${phone}`);
        if (!phone || !/^\d{7,15}$/.test(phone)) {
          await neonDb.completePair(req.id, { error: 'Invalid phone number.' });
        } else {
          const existing = await neonDb.getSessionByNumero(phone);
          if (existing && existing.creds && existing.creds.registered) {
            await neonDb.completePair(req.id, { error: 'Number is already paired. Disconnect it first.' });
          } else {
            const sid = `web_${phone}_${Date.now()}`;
            logInfo('NEON', `Starting web session ${sid}`);
            startWhatsApp(sid, null, phone, null, async (code) => {
              if (code) await neonDb.completePair(req.id, { code, sid });
              else await neonDb.completePair(req.id, { error: 'Pairing code request failed or timed out.', sid });
            }).catch(async (e) => {
              await neonDb.completePair(req.id, { error: String((e && e.message) || e), sid });
            });
          }
        }
      }
    } catch (e) {
      logError('NEON', e.message);
    }
    try {
      await neonDb.heartbeat(true, { premiumMode: Boolean(premData && premData.premOnly), botName: settings.BOT_NAME });
    } catch (e) { /* ignore */ }
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 3000);
}

// ═══════════════════════════════════════════════════════════
//   WEBSITE PAIRING BRIDGE
// ═══════════════════════════════════════════════════════════
const bridgeApp = express();
bridgeApp.use(cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'x-api-secret', 'x-admin-password'] }));
bridgeApp.use(express.json());

const bridgePool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});
const bridgeSecret = process.env.API_SECRET || 'titan10';
global.bridgePairingCodes = global.bridgePairingCodes || new Map();
global.bridgePendingByPhone = global.bridgePendingByPhone || new Map();
global.bridgeActiveSessions = global.bridgeActiveSessions || new Map();

function requireBridgeSecret(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const supplied = req.headers['x-api-secret'] || req.body?.password;
  if (supplied !== bridgeSecret) return res.status(401).json({ error: 'Incorrect API secret.' });
  next();
}

async function ensureBridgeTable() {
  if (!process.env.DATABASE_URL) return;
  try {
    await bridgePool.query(`CREATE TABLE IF NOT EXISTS wa_sessions_titan (
      phone TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      connected_at BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    )`);
    console.log('[Bridge] Neon table wa_sessions_titan ready.');
  } catch (err) {
    console.error('[Bridge] Neon initialization failed:', err.message);
  }
}
ensureBridgeTable();

bridgeApp.use('/api', requireBridgeSecret);
bridgeApp.get('/api/status', (_req, res) => {
  res.json({
    status: 'online',
    bot: 'TITAN ANIME MD',
    serverId: process.env.SERVER_ID || 'titan_md_server_01',
    uptime: process.uptime(),
    activeSessions: global.bridgeActiveSessions.size,
    accessMode: adminState.mode,
  });
});

bridgeApp.get('/api/admin/state', (_req, res) => {
  res.json({
    mode: adminState.mode,
    keyCount: adminState.keys.length,
    keys: adminState.keys.slice(0, 25),
    owner: '+254 141 929411',
    channel: 'https://whatsapp.com/channel/0029VbCvjhNAojYkkUSURU3K',
    updatedAt: adminState.updatedAt,
  });
});

bridgeApp.post('/api/admin/mode', (req, res) => {
  const mode = req.body?.mode === 'premium' ? 'premium' : req.body?.mode === 'free' ? 'free' : null;
  if (!mode) return res.status(400).json({ error: 'Mode must be free or premium.' });
  adminState.mode = mode;
  premData.premOnly = mode === 'premium';
  savePrem();
  saveAdminState();
  return res.json({ ok: true, mode: adminState.mode, premiumOnly: premData.premOnly });
});

bridgeApp.post('/api/admin/keys', (_req, res) => {
  const key = generateActivationKey();
  return res.status(201).json({ ok: true, key, mode: adminState.mode });
});

bridgeApp.get('/api/sessions', (_req, res) => {
  res.json({ sessions: Array.from(global.bridgeActiveSessions.values()) });
});

bridgeApp.post('/api/connect', async (req, res) => {
  const phone = String(req.body?.phone || req.body?.whatsappPhone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number format.' });
  }
  if (typeof global._startWhatsApp !== 'function') {
    return res.status(503).json({ error: 'WhatsApp starter is not ready.' });
  }

  // Cancel an earlier request for the same number. This prevents a stale
  // socket from keeping WhatsApp in a permanent "Logging in…" state.
  const previousSessionId = global.bridgePendingByPhone.get(phone);
  if (previousSessionId) {
    global.bridgePairingCodes.delete(previousSessionId);
    global.bridgePendingByPhone.delete(phone);
    const previousSocket = activeSockets.get(previousSessionId);
    try { previousSocket?.ws?.close(); } catch {}
    activeSockets.delete(previousSessionId);
  }

  const sessionId = `web_${phone}_${Date.now()}`;
  let finishTimeout;
  const codePromise = new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(finishTimeout);
      if (global.bridgePendingByPhone.get(phone) === sessionId) global.bridgePendingByPhone.delete(phone);
      global.bridgePairingCodes.delete(sessionId);
      resolve(value || null);
    };
    finishTimeout = setTimeout(() => finish(null), 20000);
    global.bridgePairingCodes.set(sessionId, { resolve: finish, phone });
  });
  global.bridgePendingByPhone.set(phone, sessionId);

  try {
    Promise.resolve(global._startWhatsApp(sessionId, null, phone, null, (code) => {
        const pending = global.bridgePairingCodes.get(sessionId);
        if (pending && code) pending.resolve(String(code));
    })).catch((err) => {
      const pending = global.bridgePairingCodes.get(sessionId);
      if (pending) {
        pending.resolve(null);
        global.bridgePairingCodes.delete(sessionId);
      }
      console.error('[Bridge] Pairing start failed:', err.message);
    });

    const code = await codePromise;
    if (!code) {
      const pendingSocket = activeSockets.get(sessionId);
      try { pendingSocket?.ws?.close(); } catch {}
      activeSockets.delete(sessionId);
      return res.status(504).json({ error: 'Timed out waiting for pairing code. Please retry once; the old request was cleared.' });
    }

    global.bridgeActiveSessions.set(phone, { phone, sessionId, createdAt: Date.now() });
    if (process.env.DATABASE_URL) {
      await bridgePool.query(
        `INSERT INTO wa_sessions_titan (phone, session_id, connected_at, metadata)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (phone) DO UPDATE SET session_id = EXCLUDED.session_id, connected_at = EXCLUDED.connected_at, metadata = EXCLUDED.metadata`,
        [phone, sessionId, Date.now(), JSON.stringify({ bot: 'titan' })]
      ).catch((err) => console.error('[Bridge] Session metadata save failed:', err.message));
    }
    return res.json({ success: true, code, sessionId });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Pairing failed.' });
  }
});

bridgeApp.post('/api/delsession', async (req, res) => {
  const phone = String(req.body?.phone || '').replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Phone required.' });
  global.bridgeActiveSessions.delete(phone);
  if (process.env.DATABASE_URL) {
    await bridgePool.query('DELETE FROM wa_sessions_titan WHERE phone = $1', [phone]).catch(() => {});
  }
  return res.json({ ok: true });
});

const bridgePort = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
bridgeApp.listen(bridgePort, '0.0.0.0', () => {
  console.log(`[Bridge] TITAN ANIME MD API listening on ${bridgePort}`);
});

// ═══════════════════════════════════════════════════════════
//   LAUNCH
// ═══════════════════════════════════════════════════════════
async function launch() {
  process.stdout.write(chalk.magentaBright(`
╔════════════════════════════════════╗
║        𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫  v${settings.BOT_VERSION}          ║
║    Telegram × WhatsApp Bot         ║
╚════════════════════════════════════╝\n`));

  // Expose startWhatsApp globally so WA .pair command can start new sessions
  global._startWhatsApp = (...args) => startWhatsApp(...args);

  logInfo('PREMIUM', `Mode: ${premData.premOnly ? 'Premium-only' : 'Public'} | Owners: ${[settings.OWNER_TELEGRAM_ID, ...premData.owners].length} | Prem users: ${premData.premUsers.length}`);
  logInfo('REPLIES', `Loaded ${pendingReplies.size} pending reply(ies) from disk`);

  startPingLoop();
  startSessionWatcher();
  await reloadSessions();
  startNeonBridge();
  bot.launch({ dropPendingUpdates: true });
  logSuccess('TELEGRAM', 'Bot running');

  process.once('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });
}

launch().catch(e => { logError('FATAL', e.message); process.exit(1); });