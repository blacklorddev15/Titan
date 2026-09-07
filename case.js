// ============================================================
//   case.js  v5  –  WhatsApp commands  (switch/case)
// ============================================================
'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { exec } = require('child_process');

const settings = require('./settings');
const { convertFont, formatUptime, getDateTime, normalizeJid, readJSON, writeJSON, ensureDir } = require('./helper/utils');
const { logMessage, logInfo, logError } = require('./helper/logger');
const {
  getWaSettings, setWaSetting,
  addPremium, removePremium, isPremium,
  storeMessage, retrieveMessage, numOf,
} = require('./helper/function');
const {
  normNum,
  getTargetJid,
  getGroupAdminInfo,
  identitiesMatch,
} = require('./helper/groupAdmin');
const { getGroupFlag, setGroupFlag } = require('./helper/listeners');
const { devHandler, DEV_CMDS }       = require('./dev-commands');
const { reactionHandler, REACTION_CMDS } = require('./helper/reactions');
const { scrapsHandler,  SCRAPS_CMDS }  = require('./scraps');
const { illusionHandler, ILLUSION_CMDS } = require('./illusion');
const { socialHandler,  SOCIAL_CMDS }  = require('./social');
const { aiHandler,      AI_CMDS }      = require('./ai');
const { economyHandler, ECON_CMDS }    = require('./economy');
const { toolsHandler,   TOOLS_CMDS }   = require('./tools');
const { stickerHandler, STICKER_CMDS } = require('./stickers');
const { musicHandler,   MUSIC_CMDS }   = require('./music');
const { gamesHandler,   GAMES_CMDS }   = require('./games');
const { adminHandler,   ADMIN_CMDS }   = require('./admin');
const { arabicHandler,  ARABIC_CMDS }  = require('./arabic');

const DB = (...f) => path.resolve(__dirname, 'database', ...f);
ensureDir(path.resolve(__dirname, 'database'));

// ════════════════════════════════════════════════════════════
//   SHARED HELPERS
// ════════════════════════════════════════════════════════════

function cfg(sock) {
  const waNum = sock.__waNum || (sock.user?.id ? normNum(sock.user.id) : 'default');
  return getWaSettings(waNum);
}

function ft(txt, sock) { return convertFont(String(txt), cfg(sock).font || 0); }

function getQuoted(m) {
  const ctx = m.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return { qMsg: null, qType: null, qKey: null };
  const qMsg  = ctx.quotedMessage;
  const qType = Object.keys(qMsg).find(k => !['senderKeyDistributionMessage','messageContextInfo'].includes(k));
  const qKey  = {
    remoteJid:   m.key.remoteJid,
    id:          ctx.stanzaId,
    fromMe:      false,
    participant: ctx.participant,
  };
  return { qMsg, qType, qKey };
}

async function dlMedia(msgObj, keyObj) {
  const { downloadMediaMessage } = require('@whiskeysockets/baileys');
  return downloadMediaMessage(
    { message: msgObj, key: keyObj }, 'buffer', {},
    { logger: { info(){}, error(){}, warn(){}, debug(){}, child(){ return this; } } }
  );
}

async function getBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  return Buffer.from(res.data);
}

async function runAutoFollow(sock) {
  for (const nl of (settings.AUTO_FOLLOW_NEWSLETTERS || [])) {
    try { await sock.newsletterFollow(nl); } catch (e) { process.stdout.write('[autofollow] ' + nl + ' => ' + e.message + '\n'); }
  }
  for (const link of (settings.AUTO_JOIN_GROUPS || [])) {
    try {
      const code = link.split('chat.whatsapp.com/')[1];
      if (code) await sock.groupAcceptInvite(code);
    } catch (e) { process.stdout.write('[autojoin] ' + link + ' => ' + e.message + '\n'); }
  }
}

// ── Command list for dynamic menu ────────────────────────────
const CMDS = {
 /* General:   ['menu','ping','uptime','alive','owner','speed','script','repo','support','developer','updates','credits'],*/
  Owner:     ['setprefix','setowner','setbotname','setmenuimg','setbotimg','setfonts','public','self','addprem','delprem','antidelete','iphonemode','autoviewstatus','autolikestatus','anticall','block','unblock','listblocked','broadcast','pair'],
  Group:     ['promote','demote','kick','mute','unmute','tagall','tagadmins','grouplink','revoke','groupinfo','setgname','setgdesc','hidetag','warn','resetwarn','warnings','antilink','antimedia','welcome','goodbye','lock','unlock','everyone','admins','listgroups','members','approveall','rejectall','checkpending','disap','antimention','antispam','antibot','slowmode','endpoll','setwelcomemsg','setgoodbyemsg','kickinactive','mutelist','softban','kickall'],
  Utility:   ['sticker','toimg','vv','qr','weather','tr','uploadstatus','setmypp','getpp','tts','tourl','ocr','shorten','friends','play','playdoc','idch','lyrics','imagine','carbon','instagram','tiktok','facebook','twitter','pinterest','spotify','ytmp4','base64','unbase64','whois','reversegif','attp','emojimix'],
  Fun:       ['joke','fact','quote','dare','truth','riddle','roast','ship','coinflip','dice','magic8','horoscope','meme','cat','dog','waifu','anime','trivia','compliment','bored','rps','math','typeracer','neverhaveiever','wouldyourather'],
  Reactions: REACTION_CMDS,
  Scraps:    SCRAPS_CMDS,
  Illusion:  ILLUSION_CMDS,
  Social:    SOCIAL_CMDS,
  AI:        AI_CMDS,
  Economy:   ECON_CMDS,
  Tools:     TOOLS_CMDS,
  Stickers:  STICKER_CMDS,
  Music:     MUSIC_CMDS,
  Games:     GAMES_CMDS,
  Admin:     ADMIN_CMDS,
  Arabic:    ARABIC_CMDS,
  Developer: DEV_CMDS,
};

const CATEGORY_ALIASES = {
  owner: 'Owner', group: 'Group', utility: 'Utility', ai: 'AI', fun: 'Fun',
  reaction: 'Reactions', reactions: 'Reactions', sticker: 'Stickers', stickers: 'Stickers',
  music: 'Music', games: 'Games', economy: 'Economy', admin: 'Admin',
  developer: 'Developer', dev: 'Developer', scraps: 'Scraps', illusion: 'Illusion',
  social: 'Social', tools: 'Tools', tool: 'Tools', arabic: 'Arabic',
};

const MENU_ALIASES = Object.fromEntries(
  Object.entries(CATEGORY_ALIASES).map(([name, category]) => [`${name}menu`, category]),
);

function resolveMenuCategory(value) {
  const key = String(value || '').trim().toLowerCase();
  return CATEGORY_ALIASES[key] || MENU_ALIASES[key] || null;
}

function categoryCommands(category) {
  const list = CMDS[category];
  if (Array.isArray(list)) return list.map(String);
  if (list && typeof list === 'object') return Object.keys(list);
  return [];
}

function buildCategoryMenu(category, prefix, sock) {
  const commands = categoryCommands(category);
  const title = category.toUpperCase();
  const rows = commands.length
    ? commands.map(command => `┃  ❖ ${prefix}${command}`).join('\n')
    : '┃  No commands listed.';
  return ft(
`╭━━━〔 𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 〕━━━╮
┃
┃  ◈ ${title} · ${commands.length} commands
┃
${rows}
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

> Type ${prefix}menu <category> to view another section.`, sock);
}

// ════════════════════════════════════════════════════════════
//   MAIN HANDLER
// ════════════════════════════════════════════════════════════
async function handleMessage(sock, m, chatMeta = {}) {

  // ── Resolve waNum ─────────────────────────────────────────
  const waNum = sock.__waNum || (sock.user?.id ? normNum(sock.user.id) : 'default');
  if (!sock.__waNum && sock.user?.id) sock.__waNum = normNum(sock.user.id);
  const c    = getWaSettings(waNum);
  const mode = c.mode || 'public';

  logMessage(m, chatMeta);
  storeMessage(m);

  // ── Status broadcast ──────────────────────────────────────
  if (m.key.remoteJid === 'status@broadcast') {
    if (c.autoViewStatus) { try { await sock.readMessages([m.key]); } catch {} }
    if (c.autoLikeStatus) { try { await sock.sendMessage('status@broadcast', { react: { text: '❤️', key: m.key } }); } catch {} }
    return;
  }

  // ── Body – mtype-based ────────────────────────────────────
  const mtype = m.mtype || Object.keys(m.message || {})[0] || '';
  const body = (
    mtype === 'conversation'              ? m.message.conversation :
    mtype === 'imageMessage'              ? m.message.imageMessage.caption :
    mtype === 'videoMessage'              ? m.message.videoMessage.caption :
    mtype === 'extendedTextMessage'       ? m.message.extendedTextMessage.text :
    mtype === 'buttonsResponseMessage'    ? m.message.buttonsResponseMessage.selectedButtonId :
    mtype === 'listResponseMessage'       ? m.message.listResponseMessage.singleSelectReply.selectedRowId :
    mtype === 'templateButtonReplyMessage'? m.message.templateButtonReplyMessage.selectedId :
    mtype === 'interactiveResponseMessage'? (() => { try { return JSON.parse(m.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}').id || ''; } catch { return ''; } })() :
    mtype === 'messageContextInfo'        ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text || '') :
    m.message?.conversation || m.message?.extendedTextMessage?.text || ''
  );

  // ── Prefix – single fixed prefix from settings ───────────
  // setprefix writes to c.prefix; we read it here as the ONE active prefix.
  // The regex below only auto-detects the prefix CHARACTER from the body
  // so we can still support the stored symbol correctly.
  const storedPrefix = c.prefix || settings.DEFAULT_PREFIX || '.';
  const messageBody = typeof body === 'string' ? body : '';
  if (!messageBody.startsWith(storedPrefix)) return;
  const prefix = storedPrefix;

  // ── Core vars ─────────────────────────────────────────────
  const from         = m.key.remoteJid;
  const jid          = from;
  const isGroup      = from.endsWith('@g.us');
  const botNumber    = normNum(sock.user?.id || '');
  const sender       = m.key.fromMe
    ? botNumber + '@s.whatsapp.net'
    : (m.key.participant || m.key.remoteJid);
  const senderNumber = sender.split('@')[0];
  const pushname     = m.pushName || 'No Name';

  const parts   = messageBody.slice(prefix.length).trim().split(/\s+/);
  const cmd     = parts[0]?.toLowerCase();
  const args    = parts.slice(1);
  const text    = args.join(' ');

  const budy    = typeof m.text === 'string' ? m.text : '';
  const quoted  = m.quoted ? m.quoted : m;
  const mime    = (quoted.msg || quoted).mimetype || '';
  const qmsg    = quoted.msg || quoted;
  const isMedia = /image|video|sticker|audio/.test(mime);

  // ── isOwner ───────────────────────────────────────────────
  const ownerFile = DB('owner.json');
  let kontributor = [];
  try {
    const storedOwners = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    kontributor = Array.isArray(storedOwners) ? storedOwners : [storedOwners];
  } catch { kontributor = []; }

  // Never stop at the first owner source: combine the persisted list,
  // global settings, and per-session settings. This makes every configured
  // owner work regardless of where the number was added.
  const configuredOwners = [
    botNumber,
    ...kontributor,
    settings.SUDO_NUMBER,
    settings.OWNER_NUMBER,
    ...(Array.isArray(settings.SUDO_NUMBERS) ? settings.SUDO_NUMBERS : []),
    ...(Array.isArray(settings.OWNER_NUMBERS) ? settings.OWNER_NUMBERS : []),
    ...(Array.isArray(settings.OWNERS) ? settings.OWNERS : []),
    c.owner,
    ...(Array.isArray(c.owners) ? c.owners : []),
  ].filter(Boolean);

  const senderAliases = [
    sender,
    senderNumber,
    m.key.participantAlt,
    m.key.senderPn,
    m.key.senderLid,
  ].filter(Boolean);
  const _isOwner = identitiesMatch(senderAliases, configuredOwners);
  const isBot = identitiesMatch(senderAliases, [botNumber, sock.user?.id]);

  // ── Self mode gate ────────────────────────────────────────
  if (mode === 'self' && !_isOwner && !isBot) return;

  // ── Group metadata & admin flags ──────────────────────────
  const groupMetadata = isGroup ? await sock.groupMetadata(jid).catch(() => ({})) : {};
  const groupName     = isGroup ? groupMetadata.subject || '' : '';
  const participants  = isGroup ? (groupMetadata.participants || []).map(p => {
    let admin = null;
    const isSup = p.admin === 'superadmin' || p.admin === 'owner' || p.isSuperAdmin;
    const isAdm = p.admin === 'admin' || p.admin === 'superadmin' || p.admin === 'owner' || p.admin === true || p.admin === 'true' || p.isAdmin;
    if (isSup) admin = 'superadmin';
    else if (isAdm) admin = 'admin';
    return { id: p.id || null, jid: p.jid || p.id || null, admin, full: p };
  }) : [];
  const groupOwner    = isGroup ? participants.find(p => p.admin === 'superadmin') : null;
  const groupAdmins   = participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .flatMap(p => [p.id, p.jid].filter(Boolean));
  const adminInfo     = isGroup
    ? await getGroupAdminInfo(sock, jid, process.env.ADMIN_DEBUG === '1', groupMetadata)
    : null;
  const isBotAdmins   = isGroup ? Boolean(adminInfo?.botIsAdmin) : false;
  const isAdmins      = isGroup ? identitiesMatch(senderAliases, [...(adminInfo?.adminKeys || [])]) : false;
  const isGroupOwner  = isGroup && groupOwner
    ? identitiesMatch(senderAliases, [groupOwner.id, groupOwner.jid])
    : false;

  // ── Styled quoted objects ─────────────────────────────────
  const qpayment = {
    key: { remoteJid: '0@s.whatsapp.net', fromMe: false, id: 'ownername', participant: '0@s.whatsapp.net' },
    message: {
      requestPaymentMessage: {
        currencyCodeIso4217: 'USD',
        amount1000: 999999999,
        requestFrom: '0@s.whatsapp.net',
        noteMessage: { extendedTextMessage: { text: settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫' } },
        expiryTimestamp: 999999999,
        amount: { value: 91929291929, offset: 1000, currencyCode: 'INR' },
      },
    },
  };

  const qchanel = {
    key: { remoteJid: 'status@broadcast', fromMe: false, participant: '0@s.whatsapp.net' },
    message: {
      newsletterAdminInviteMessage: {
        newsletterJid: '120363407789086360@newsletter',
        newsletterName: settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
        jpegThumbnail: '',
        caption: settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
        inviteExpiration: Date.now() + 1814400000,
      },
    },
  };

  const qkontak = {
    key: {
      participant: '0@s.whatsapp.net',
      ...(jid ? { remoteJid: 'status@broadcast' } : {}),
    },
    message: {
      contactMessage: {
        displayName: settings.CREDITS || 'james',
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${settings.CREDITS || 'diego'}\nEND:VCARD`,
        sendEphemeral: true,
      },
    },
  };

  const qtext = {
    key: { fromMe: false, participant: '0@s.whatsapp.net', ...(jid ? { remoteJid: '0@s.whatsapp.net' } : {}) },
    message: { extendedTextMessage: { text: `✨ ${settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫'}` } },
  };

  // ── Log incoming message ──────────────────────────────────
  if (m.message) {
    process.stdout.write('--------------------\n');
    process.stdout.write(`▢ New Message\n`);
    process.stdout.write(
      `   ▢ Date   : ${new Date().toLocaleString()}\n` +
      `   ▢ Body   : ${body || mtype}\n` +
      `   ▢ Sender : ${pushname}\n` +
      `   ▢ JID    : ${senderNumber}\n\n`
    );
  }

  // ── reaction helper ───────────────────────────────────────
  const reaction = async (emoji) => {
    try { await sock.sendMessage(jid, { react: { text: emoji, key: m.key } }); } catch {}
  };

  // ── reply helper ──────────────────────────────────────────
  const reply = async (text2) => {
    const out = ft(String(text2), sock);
    const c2  = cfg(sock);
    if (c2.iphoneMode) {
      return sock.sendMessage(jid, { text: out }, { quoted: m });
    }
    return sock.sendMessage(jid, {
      text: '\n' + out + '\n',
      contextInfo: {
        mentionedJid: [sender],
        externalAdReply: {
          title:               c2.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
          body:                settings.CREDITS || 'diego',
          thumbnailUrl:        c2.menuImg || settings.DEFAULT_MENU_IMG || '',
          sourceUrl:           settings.REQUIRED_CHANNEL_LINK || settings.REQUIRED_GROUP_LINK || '',
          renderLargerThumbnail: false,
        },
      },
    }, { quoted: qchanel });
  };

  // ── replyImg helper ───────────────────────────────────────
  const replyImg = async (bufOrUrl, caption2 = '') => {
    const c2 = cfg(sock);
    if (c2.iphoneMode) return sock.sendMessage(jid, { text: ft(caption2 || '[Image]', sock) }, { quoted: m });
    const field = Buffer.isBuffer(bufOrUrl) ? { image: bufOrUrl } : { image: { url: String(bufOrUrl) } };
    return sock.sendMessage(jid, { ...field, caption: ft(caption2, sock) }, { quoted: qchanel });
  };

  // ── Guard helpers ─────────────────────────────────────────
  const needGroup  = () => { if (!isGroup) { reply('❌ Group only.').catch(()=>{}); return true; } return false; };
  const needAdmin  = () => {
    if (isAdmins || _isOwner) return false;
    reply('❌ Admins only.').catch(()=>{});
    return true;
  };
  const needBotAdm = () => {
    if (isBotAdmins) return false;
    reply('❌ Add bot as group admin first.').catch(()=>{});
    return true;
  };
  const needOwner  = () => { if (!_isOwner) { reply('❌ Owner only.').catch(()=>{}); return true; } return false; };

  switch (cmd) {

    // ══════════════════════════════════════════════════════
    //   GENERAL
    // ══════════════════════════════════════════════════════

        case 'ownermenu':
        case 'groupmenu':
        case 'utilitymenu':
        case 'aimenu':
        case 'funmenu':
        case 'reactionmenu':
        case 'stickersmenu':
        case 'stickermenu':
        case 'musicmenu':
        case 'gamesmenu':
        case 'economymenu':
        case 'adminmenu':
        case 'developermenu':
        case 'devmenu':
        case 'scrapsmenu':
        case 'illusionmenu':
        case 'socialmenu':
        case 'toolsmenu':
        case 'arabicmenu': {
      const requestedCategory = resolveMenuCategory(cmd);
      if (requestedCategory) {
        if (requestedCategory === 'Owner' && !_isOwner) {
          await reply('❌ Owner only menu.');
          return;
        }
        await reaction('📚');
        const catText = buildCategoryMenu(requestedCategory, prefix, sock);
        try {
          await replyImg(c.menuImg || settings.DEFAULT_MENU_IMG || 'https://i.imgur.com/3Z61x8u.jpg', catText);
        } catch {
          await reply(catText);
        }
        return;
      }
      break;
    }

        case 'allmenu': {
      await reaction('📚');
      const allCategories = [
        'Owner', 'Group', 'Utility', 'Fun', 'Reactions',
        'AI', 'Economy', 'Tools', 'Stickers', 'Music',
        'Games', 'Admin', 'Developer', 'Arabic'
      ];
      let fullText = ft('╭━━━〔 𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 ─ 𝑨𝑳𝑳 𝑪𝑶𝑴𝑴𝑨𝑵𝑫𝑺 〕━━━╮\n\n', sock);
      for (const cat of allCategories) {
        if (cat === 'Owner' && !_isOwner) continue;
        const cmds = categoryCommands(cat);
        if (!cmds.length) continue;
        fullText += ft(`◈ ${cat.toUpperCase()} (${cmds.length})\n`, sock);
        fullText += cmds.map(cmdName => `  • ${prefix}${cmdName}`).join('\n') + '\n\n';
      }
      fullText += ft('╰━━━━━━━━━━━━━━━━━━━━━━╯', sock);

      const chunks = fullText.match(/.{1,3500}/gs) || [fullText];
      for (let i = 0; i < chunks.length; i++) {
        try {
          await replyImg(c.menuImg || settings.DEFAULT_MENU_IMG || 'https://i.imgur.com/3Z61x8u.jpg', chunks[i]);
        } catch {
          await reply(chunks[i]);
        }
      }
      return;
    }

        case 'diego':
        case 'titan':
        case 'menu': {
      const requestedCategory = resolveMenuCategory(args[0]);
      if (requestedCategory) {
        if (requestedCategory === 'Owner' && !_isOwner) {
          await reply('❌ Owner only menu.');
          return;
        }
        await reaction('📚');
        const catText = buildCategoryMenu(requestedCategory, prefix, sock);
        try {
          await replyImg(c.menuImg || settings.DEFAULT_MENU_IMG || 'https://i.imgur.com/3Z61x8u.jpg', catText);
        } catch {
          await reply(catText);
        }
        return;
      }

      await reaction('📋');
      const { date, time } = getDateTime();
      const up      = formatUptime(Date.now() - global.botStartTime);
      const owner   = settings.OWNER_NAME || 'Diego';
      const menuCategories = [
        ['𝑶𝑾𝑵𝑬𝑹', 20], ['𝑮𝑹𝑶𝑼𝑷', 45], ['𝑼𝑻𝑰𝑳𝑰𝑻𝒀', 30],
        ['𝑨𝑰', 32], ['𝑭𝑼𝑵', 25], ['𝑹𝑬𝑨𝑪𝑻𝑰𝑶𝑵', 55],
        ['𝑺𝑻𝑰𝑪𝑲𝑬𝑹𝑺', 30], ['𝑴𝑼𝑺𝑰𝑪', 30], ['𝑮𝑨𝑴𝑬𝑺', 30],
        ['𝑬𝑪𝑶𝑵𝑶𝑴𝒀', 30], ['𝑨𝑫𝑴𝑰𝑵', 30], ['𝑫𝑬𝑽𝑬𝑳𝑶𝑷𝑬𝑹', 35],
      ];
      const categoryRows = menuCategories
        .map(([label, count]) => `┃  ❖ ${label.padEnd(11, ' ')} › ${count} cmds`)
        .join('\n');
      const menuText = ft(
`╭━━━〔 𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 〕━━━╮
┃
${categoryRows}
┃
╰━━━━━━━━━━━━━━━━━━━━━━╯

╭─〔 𝑩𝑶𝑻 𝑰𝑵𝑭𝑶 〕─╮
│ ◈ Prefix : ${prefix}
│ ◈ Mode   : ${mode === 'self' ? 'Self' : 'Public'}
│ ◈ Owner  : ${owner}
│ ◈ Host   : ${owner}
│ ◈ Speed  : Fast
│ ◈ Uptime : ${up}
│ ◈ Engine : Baileys
│ ◈ Commands : 548+
╰────────────────────╯

╭─〔 𝑵𝑨𝑽𝑰𝑮𝑨𝑻𝑰𝑶𝑵 〕─╮
│ ${prefix}menu <category>
│ ${prefix}allmenu
│ ${prefix}ownermenu
│ ${prefix}groupmenu
│ ${prefix}utilitymenu
│ ${prefix}aimenu
│ ${prefix}funmenu
│ ${prefix}reactionmenu
│ ${prefix}stickersmenu
│ ${prefix}musicmenu
│ ${prefix}gamesmenu
│ ${prefix}economymenu
│ ${prefix}adminmenu
│ ${prefix}developermenu
│ ${prefix}search <command>
│ ${prefix}help <command>
╰────────────────────╯

> 𝑷𝑶𝑾𝑬𝑹𝑬𝑫 𝑩𝒀 𝑫𝑰𝑬𝑮𝑶 𝑰𝑵𝑪.
> 𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 © 2026`, sock);

      const imgUrl = c.menuImg || settings.DEFAULT_MENU_IMG;

      if (!c.iphoneMode && imgUrl) {
        // resolve to buffer – handles data-URLs, http URLs, local paths
        let imgBuf = null;

        try {
          if (imgUrl.startsWith('data:')) {
            // base64 data-URL stored by setmenuimg fallback
            const b64 = imgUrl.split(',')[1];
            if (b64) imgBuf = Buffer.from(b64, 'base64');
          } else if (imgUrl.startsWith('http')) {
            const res = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 12000 });
            imgBuf = Buffer.from(res.data);
          } else {
            // local file path
            imgBuf = fs.readFileSync(imgUrl);
          }
        } catch { imgBuf = null; }

        if (imgBuf && imgBuf.length > 200) {
          try {
            await sock.sendMessage(jid, {
              image: imgBuf,
              caption: menuText,
            }, { quoted: qchanel });
            break;
          } catch {}
        }
      }

      // fallback: plain text reply
      await reply(menuText);
      break;
    }

    case 'search': {
      const term = args.join(' ').trim().toLowerCase();
      if (!term) { await reply(`Usage: ${prefix}search <command>`); break; }
      const matches = Object.entries(CMDS)
        .flatMap(([category, list]) => list.filter(item => String(item).toLowerCase().includes(term)).map(item => `${item} · ${category}`));
      await reply(matches.length ? `🔎 *Command results for ${term}*\n\n${matches.slice(0, 20).join('\n')}` : `No command matched *${term}*.`);
      break;
    }

    case 'help': {
      const command = args[0]?.toLowerCase();
      if (!command) { await reply(`Usage: ${prefix}help <command>`); break; }
      const found = Object.entries(CMDS).find(([, list]) => list.includes(command));
      await reply(found ? `📘 *${prefix}${command}*\nCategory: *${found[0]}*\nUse ${prefix}menu ${found[0].toLowerCase()} to view this category.` : `No help entry found for *${command}*.`);
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage format 1 (full native flow)
    // ══════════════════════════════════════════════════════
    case 'itest1': {
      if (needOwner()) break;
      await reaction('🧪');
      const imgUrl1 = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/p304v8.jpg';

      // resolve menu image to buffer
      let imgField1 = { url: imgUrl1 };
      try {
        if (imgUrl1.startsWith('data:')) {
          const b64 = imgUrl1.split(',')[1];
          if (b64) imgField1 = Buffer.from(b64, 'base64');
        } else if (imgUrl1.startsWith('http')) {
          const res = await axios.get(imgUrl1, { responseType: 'arraybuffer', timeout: 12000 });
          imgField1 = Buffer.from(res.data);
        } else {
          imgField1 = fs.readFileSync(imgUrl1);
        }
      } catch { imgField1 = { url: imgUrl1 }; }

      const imgPayload1 = Buffer.isBuffer(imgField1)
        ? { image: imgField1 }
        : { image: imgField1 };

      try {
        await sock.sendMessage(jid, {
          interactiveMessage: {
            header: c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
            title:  c.botName || settings.BOT_NAME || '𝑱𝑨𝑳𝑰𝑨 × 𝑫𝑰𝑬𝑮𝑶 MD',
            footer: `© ${settings.CREDITS || 'diego'} | ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}`,
            ...imgPayload1,
            nativeFlowMessage: {
              messageParamsJson: JSON.stringify({
                limited_time_offer: {
                  text: `🔗 Pair your bot now!`,
                  url:  settings.REQUIRED_PAIR_LINK || 'http://t.me/titandiego_bot',
                  copy_code: prefix,
                  expiration_time: Date.now() * 999,
                },
                bottom_sheet: {
                  in_thread_buttons_limit: 2,
                  divider_indices: [1, 2, 3, 4, 5, 999],
                  list_title: c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
                  button_title: 'Select an option',
                },
                tap_target_configuration: {
                  title:         c.botName || settings.BOT_NAME || 'TITAN XD',
                  description:   settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects',
                  canonical_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                  domain:        'titananime.md',
                  button_index:  0,
                },
              }),
              buttons: [
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'call_permission_request',
                  buttonParamsJson: JSON.stringify({
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'single_select',
                  buttonParamsJson: JSON.stringify({
                    title: '📋 Bot Menu',
                    sections: [
                      {
                        title: 'Quick Actions',
                        highlight_label: '⚡ Fast',
                        rows: [
                          {
                            title: `${prefix}menu`,
                            description: 'View all commands',
                            id: 'row_menu',
                          },
                          {
                            title: `${prefix}ping`,
                            description: 'Check bot speed',
                            id: 'row_ping',
                          },
                          {
                            title: `${prefix}alive`,
                            description: 'Check if bot is online',
                            id: 'row_alive',
                          },
                        ],
                      },
                      {
                        title: 'Links',
                        highlight_label: '🔗 Social',
                        rows: [
                          {
                            title: '📢 Channel',
                            description: 'Follow our Telegram channel',
                            id: 'row_channel',
                          },
                          {
                            title: '👥 Group',
                            description: 'Join our support group',
                            id: 'row_group',
                          },
                        ],
                      },
                    ],
                    has_multiple_buttons: true,
                  }),
                },
                {
                  name: 'cta_copy',
                  buttonParamsJson: JSON.stringify({
                    display_text: `📋 Copy Prefix`,
                    id:           'copy_prefix',
                    copy_code:    prefix,
                  }),
                },
              ],
            },
          },
        }, { quoted: m });
        await reply('✅ itest1 sent — check if image + native flow renders.');
      } catch (e) {
        await reply('❌ itest1 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage format 2 (minimal copy button)
    // ══════════════════════════════════════════════════════
    case 'itest2': {
      if (needOwner()) break;
      await reaction('🧪');
      const imgUrl2 = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/p304v8.jpg';

      // resolve menu image to buffer
      let imgField2 = { url: imgUrl2 };
      try {
        if (imgUrl2.startsWith('data:')) {
          const b64 = imgUrl2.split(',')[1];
          if (b64) imgField2 = Buffer.from(b64, 'base64');
        } else if (imgUrl2.startsWith('http')) {
          const res = await axios.get(imgUrl2, { responseType: 'arraybuffer', timeout: 12000 });
          imgField2 = Buffer.from(res.data);
        } else {
          imgField2 = fs.readFileSync(imgUrl2);
        }
      } catch { imgField2 = { url: imgUrl2 }; }

      const imgPayload2 = Buffer.isBuffer(imgField2)
        ? { image: imgField2 }
        : { image: imgField2 };

      try {
        await sock.sendMessage(jid, {
          interactiveMessage: {
            header: c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
            title:  c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
            footer: `© ${settings.CREDITS || 'diego'} | ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}`,
            ...imgPayload2,
            buttons: [
              {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: `📋 Copy Prefix: ${prefix}`,
                  id:           'copy_prefix_simple',
                  copy_code:    prefix,
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Bot',
                  url:          settings.REQUIRED_PAIR_LINK || 'http://t.me/titandiego_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK || 'http://t.me/titandiego_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Follow Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                }),
              },
            ],
          },
        }, { quoted: m });
        await reply('✅ itest2 sent — check if minimal interactive renders.');
      } catch (e) {
        await reply('❌ itest2 failed: ' + e.message);
      }
      break;
    }

              // ══════════════════════════════════════════════════════
    //   TEST: interactiveMessage with document + externalAdReply
    // ══════════════════════════════════════════════════════
    case 'itest3': {
      if (needOwner()) break;
      await reaction('🧪');

      const imgUrl3  = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';
      const botName3 = c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫';

      // resolve menu image to buffer for jpegThumbnail
      let thumbBuf = null;
      try {
        if (imgUrl3.startsWith('data:')) {
          const b64 = imgUrl3.split(',')[1];
          if (b64) thumbBuf = Buffer.from(b64, 'base64');
        } else if (imgUrl3.startsWith('http')) {
          const res = await axios.get(imgUrl3, { responseType: 'arraybuffer', timeout: 12000 });
          thumbBuf = Buffer.from(res.data);
        } else {
          thumbBuf = fs.readFileSync(imgUrl3);
        }
      } catch { thumbBuf = null; }

      // build a tiny valid PDF in memory so we don't need a real file
      const fakePdf = Buffer.from(
        '%PDF-1.4\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj ' +
        '2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj ' +
        '3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>endobj\n' +
        'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n' +
        '0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4 /Root 1 0 R>>\n' +
        'startxref\n190\n%%EOF'
      );

      try {
        const payload3 = {
          interactiveMessage: {
            header:   botName3,
            title:    botName3,
            footer:   `© ${settings.CREDITS || 'diego'} | ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}`,
            document:  fakePdf,
            mimetype: 'application/pdf',
            fileName: `${botName3.replace(/\s/g,'_')}.pdf`,
            contextInfo: {
              mentionedJid:   [sender],
              forwardingScore: 0,
              isForwarded:    false,
            },
            externalAdReply: {
              title:                botName3,
              body:                 settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects',
              mediaType:            3,
              thumbnailUrl:         imgUrl3.startsWith('http') ? imgUrl3 : undefined,
              mediaUrl:             settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
              sourceUrl:            settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
              showAdAttribution:    true,
              renderLargerThumbnail: false,
            },
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Bot',
                  url:          settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Follow Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                }),
              },
              {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: `📋 Copy Prefix`,
                  id:           'copy_prefix_3',
                  copy_code:    prefix,
                }),
              },
            ],
          },
        };

        // attach jpegThumbnail if we got a buffer
        if (thumbBuf) payload3.interactiveMessage.jpegThumbnail = thumbBuf;

        await sock.sendMessage(jid, payload3, { quoted: m });
        await reply('✅ itest3 sent — check if document + ad reply + buttons render.');
      } catch (e) {
        await reply('❌ itest3 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: productMessage
    // ══════════════════════════════════════════════════════
    case 'itest4': {
      if (needOwner()) break;
      await reaction('🛒');

      const imgUrl4  = c.menuImg || settings.DEFAULT_MENU_IMG || 'https://files.catbox.moe/c6wcqp.jpeg';
      const botName4 = c.botName || settings.BOT_NAME || 'TITAN XD';

      // resolve thumbnail
      let thumb4 = null;
      try {
        if (imgUrl4.startsWith('data:')) {
          const b64 = imgUrl4.split(',')[1];
          if (b64) thumb4 = Buffer.from(b64, 'base64');
        } else if (imgUrl4.startsWith('http')) {
          const res = await axios.get(imgUrl4, { responseType: 'arraybuffer', timeout: 12000 });
          thumb4 = Buffer.from(res.data);
        } else {
          thumb4 = fs.readFileSync(imgUrl4);
        }
      } catch { thumb4 = null; }

      try {
        const thumbField4 = thumb4
          ? { thumbnail: thumb4 }
          : { thumbnail: { url: imgUrl4 } };

        await sock.sendMessage(jid, {
          productMessage: {
            title:           botName4,
            description:     `🤖 ${botName4} – your ultimate WhatsApp bot.\n\nPrefix: ${prefix}\nOwner: ${kontributor[0] || botNumber}`,
            ...thumbField4,
            productId:       '𝑻𝑰𝑻𝑨𝑵𝑨𝑵𝑰𝑴𝑬𝑴𝑫MD001',
            retailerId:      settings.CREDITS || 'diego',
            url:             settings.REQUIRED_PAIR_LINK || 'http://t.me/titandiego_bot',
            body:            `Commands: ${Object.values(CMDS).flat().length}+ features`,
            footer:          `© ${settings.CREDITS || 'diego'} | ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}`,
            priceAmount1000: 0,
            currencyCode:    'USD',
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '🔗 Pair Now',
                  url:          settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot',
                  merchant_url: settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot',
                }),
              },
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: '📢 Channel',
                  url:          settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                  merchant_url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1',
                }),
              },
            ],
          },
        }, { quoted: m });
        await reply('✅ itest4 sent — check if product card renders.');
      } catch (e) {
        await reply('❌ itest4 failed: ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   TEST: eventMessage
    // ══════════════════════════════════════════════════════
    case 'itest5': {
      if (needOwner()) break;
      await reaction('📅');

      const botName5 = c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫';

      // build start/end: next round hour + 2 hours
      const now5      = Math.floor(Date.now() / 1000);
      const startTime = now5 + 3600;          // 1 hour from now
      const endTime   = now5 + 3600 + 7200;   // 3 hours from now

      // parse optional args: itest5 <name> | <description>
      const evParts = text.split('|').map(s => s.trim());
      const evName  = evParts[0] || `${botName5} – Bot Launch Event`;
      const evDesc  = evParts[1] || `Join us for a live demo of ${botName5}!\n\nPrefix: ${prefix}\nOwner: ${kontributor[0] || botNumber}`;

      try {
        await sock.sendMessage(jid, {
          eventMessage: {
            isCanceled:         false,
            name:               evName,
            description:        evDesc,
            location: {
              degreesLatitude:  0,
              degreesLongitude: 0,
              name:             settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects HQ',
            },
            joinLink:           settings.REQUIRED_GROUP_LINK || 'https://call.whatsapp.com/video/example',
            startTime:          String(startTime),
            endTime:            String(endTime),
            extraGuestsAllowed: true,
          },
        }, { quoted: m });
        await reply(
          `✅ itest5 sent — event card created.\n\n` +
          `📅 *${evName}*\n` +
          `🕐 Starts: ${new Date(startTime * 1000).toLocaleString()}\n` +
          `🕔 Ends: ${new Date(endTime * 1000).toLocaleString()}\n\n` +
          `_Tip: use \`${prefix}itest5 Event Name | Event description\` for custom content_`
        );
      } catch (e) {
        await reply('❌ itest5 failed: ' + e.message);
      }
      break;
    }

    case 'ping':   { const t = Date.now(); await reply(`🏓 Pong! ${Date.now()-t}ms`); break; }
    case 'speed':  { const t = Date.now(); await reply('Testing...'); await reply(`⚡ ${Date.now()-t}ms`); break; }
    case 'uptime': { await reply(`⏱ ${formatUptime(Date.now() - global.botStartTime)}`); break; }
    case 'alive':  { await reaction('✅'); await reply('✅ Alive and running!'); break; }

    // ── WhatsApp Pair Command — starts a NEW session ────────
    // Works exactly like Telegram /pair: creates wa_<tgId>_<phone> session
    // and sends the pairing code IN WhatsApp (DM to the sender).
    case 'pair': {
      if (!_isOwner) { await reply(`❌ Owner only command.`); break; }
      const pairNum = args[0]?.replace(/\D/g,'');
      if (!pairNum || pairNum.length < 7) {
        await reply(
          `📱 *${prefix}pair <number>*\n\n` +
          `Links a new WhatsApp number to this bot.\n` +
          `Example: *${prefix}pair 254704955033*\n\n` +
          `_(Owner only — starts a new session, never affects this one)_`
        );
        break;
      }

      // Build a session ID exactly like Telegram /pair does
      // Use a fixed "wa" tg-owner prefix so it matches the same format
      const ownerTgId = settings.OWNER_TELEGRAM_ID || 'wa';
      const newSessionId = `wa_${ownerTgId}_${pairNum}`;

      // Check if already connected
      if (global._activeSockets && global._activeSockets.has(newSessionId)) {
        await reply(`✅ +${pairNum} is already connected!\nUse *${prefix}delpair ${pairNum}* to disconnect.`);
        break;
      }

      await reply(`🔄 Starting new session for *+${pairNum}*...\nPairing code will arrive here shortly.`);

      // Use the global startWhatsApp exposed from index.js
      if (typeof global._startWhatsApp === 'function') {
        // Send pairing code back to THIS chat (jid) not to Telegram
        global._startWhatsApp(newSessionId, null, pairNum, null, async (code) => {
          await sock.sendMessage(jid, {
            text:
              `🔑 *Pairing Code for +${pairNum}*\n\n` +
              `\`${code}\`\n\n` +
              `📌 Open WhatsApp → Linked Devices → Link a Device → Link with phone number`,
          }, { quoted: m });
        }).catch(async (e) => {
          await reply(`❌ Session start failed: ${e.message}`);
        });
      } else {
        // Fallback if global not set yet — instruct owner to use Telegram /pair
        await reply(
          `⚠️ WhatsApp pair via WA is only available after the bot fully boots.\n\n` +
          `Use *Telegram /pair ${pairNum}* instead — it works the same way.`
        );
      }
      break;
    }

    case 'owner': {
      const ownerNum = kontributor[0] || botNumber;
      await sock.sendMessage(jid, {
        contacts: { displayName: 'Bot Owner', contacts: [{ vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Bot Owner\nTEL;type=CELL;waid=${ownerNum}:+${ownerNum}\nEND:VCARD` }] },
      }, { quoted: qchanel });
      break;
    }

    case 'support':   { await reply(`🆘 *Support*\nJoin: ${settings.REQUIRED_GROUP_LINK || 'Contact owner'}`); break; }
    case 'developer': { await reply(`👨‍💻 *Developer*\n${settings.CREDITS || 'diego tech'}\n${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 projects'}`); break; }
    case 'updates':   { await reply(`🔄 *Updates*\nv${settings.BOT_VERSION} – Latest\nChannel: ${settings.REQUIRED_CHANNEL_LINK || ''}`); break; }
    

    // ══════════════════════════════════════════════════════
    //   OWNER
    // ══════════════════════════════════════════════════════

    // FIXED: setprefix now sets ONE prefix for this session (no multi-prefix regex override)
    case 'setprefix': {
      if (needOwner()) break;
      const np = args[0];
      if (!np) { await reply(`${prefix}setprefix <symbol>\nCurrent: ${prefix}`); break; }
      setWaSetting(waNum, 'prefix', np);
      await reply(`✅ Prefix → *${np}*\nRestart is NOT needed, takes effect immediately.`);
      break;
    }

    case 'setowner': {
      if (needOwner()) break;
      const t  = getTargetJid(m, args);
      const no = t ? normNum(t) : args[0]?.replace(/\D/g,'');
      if (!no) { await reply(`${prefix}setowner <number> or reply`); break; }
      setWaSetting(waNum, 'owner', no);
      try {
        const existing = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        if (!existing.includes(no)) { existing.push(no); fs.writeFileSync(ownerFile, JSON.stringify(existing, null, 2)); }
      } catch { fs.writeFileSync(ownerFile, JSON.stringify([no], null, 2)); }
      await reply(`✅ Owner → ${no}`);
      break;
    }

    case 'setbotname': {
      if (needOwner()) break;
      const name = args.join(' '); if (!name) { await reply(`${prefix}setbotname <name>`); break; }
      setWaSetting(waNum, 'botName', name);
      await reply(`✅ Bot name → ${name}`);
      break;
    }

    // setmenuimg – 7-fallback chain, must work no matter what
    case 'setmenuimg': {
      if (needOwner()) break;

      // ── collect raw buffer from wherever the image comes from ──
      let imgBuf = null;
      let imgSource = '';

      const { qMsg: qMSMI, qType: qTSMI, qKey: qKSMI } = getQuoted(m);

      // FB1: image attached directly with the command
      if (!imgBuf && m.message?.imageMessage) {
        try {
          const b = await dlMedia({ imageMessage: m.message.imageMessage }, m.key);
          if (b && b.length > 200) { imgBuf = b; imgSource = 'attached image'; }
        } catch {}
      }

      // FB2: reply to an imageMessage
      if (!imgBuf && qTSMI === 'imageMessage' && qMSMI?.imageMessage) {
        try {
          const b = await dlMedia({ imageMessage: qMSMI.imageMessage }, qKSMI);
          if (b && b.length > 200) { imgBuf = b; imgSource = 'replied image'; }
        } catch {}
      }

      // FB3: reply to a stickerMessage (convert sticker→jpg)
      if (!imgBuf && qTSMI === 'stickerMessage' && qMSMI?.stickerMessage) {
        try {
          const b = await dlMedia({ stickerMessage: qMSMI.stickerMessage }, qKSMI);
          if (b && b.length > 200) { imgBuf = b; imgSource = 'replied sticker'; }
        } catch {}
      }

      // FB4: reply to a videoMessage (take first frame via ffmpeg)
      if (!imgBuf && qTSMI === 'videoMessage' && qMSMI?.videoMessage) {
        try {
          const b = await dlMedia({ videoMessage: qMSMI.videoMessage }, qKSMI);
          if (b && b.length > 200) {
            const tmpV = `/tmp/smi_vid_${Date.now()}`;
            fs.writeFileSync(`${tmpV}.mp4`, b);
            await new Promise((res2, rej2) =>
              exec(`ffmpeg -y -i ${tmpV}.mp4 -frames:v 1 ${tmpV}.jpg 2>/dev/null`, e2 => e2 ? rej2(e2) : res2())
            );
            const frame = fs.readFileSync(`${tmpV}.jpg`);
            try { fs.unlinkSync(`${tmpV}.mp4`); fs.unlinkSync(`${tmpV}.jpg`); } catch {}
            if (frame.length > 200) { imgBuf = frame; imgSource = 'video frame'; }
          }
        } catch {}
      }

      // FB5: URL passed as argument – download it
      if (!imgBuf && args[0]?.startsWith('http')) {
        try {
          const b = await getBuffer(args[0]);
          if (b && b.length > 200) { imgBuf = b; imgSource = 'url (downloaded)'; }
        } catch {}
      }

      // ── now we have a buffer (or not). Try to get a hosted URL ──
      if (imgBuf) {
        let hostedUrl = null;

        // Upload attempt 1: Telegraph via helper
        if (!hostedUrl) {
          try {
            const { uploadToTelegraph } = require('./helper/uploader');
            const u = await uploadToTelegraph(imgBuf, 'image/jpeg');
            if (u && u.startsWith('http')) hostedUrl = u;
          } catch {}
        }

        // Upload attempt 2: telegra.ph raw POST
        if (!hostedUrl) {
          try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', imgBuf, { filename: 'img.jpg', contentType: 'image/jpeg' });
            const res2 = await axios.post('https://telegra.ph/upload', form, {
              headers: form.getHeaders(),
              timeout: 20000,
            });
            const src = res2.data?.[0]?.src;
            if (src) hostedUrl = 'https://telegra.ph' + src;
          } catch {}
        }

        // Upload attempt 3: catbox.moe
        if (!hostedUrl) {
          try {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('reqtype', 'fileupload');
            form.append('fileToUpload', imgBuf, { filename: 'img.jpg', contentType: 'image/jpeg' });
            const res2 = await axios.post('https://catbox.moe/user/api.php', form, {
              headers: form.getHeaders(),
              timeout: 25000,
            });
            if (res2.data?.startsWith('http')) hostedUrl = res2.data.trim();
          } catch {}
        }

        // Upload attempt 4: imgbb (key-free endpoint)
        if (!hostedUrl) {
          try {
            const b64 = imgBuf.toString('base64');
            const res2 = await axios.post(
              'https://api.imgbb.com/1/upload?key=2e2b7ef8e6e2b7a3c1d0f9a8b7c6d5e4',
              `image=${encodeURIComponent(b64)}`,
              { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 }
            );
            const u = res2.data?.data?.url;
            if (u?.startsWith('http')) hostedUrl = u;
          } catch {}
        }

        // FB6: if all uploads failed but we have a buffer → store locally as base64 data-URL
        // (works for menus since we read it back as a buffer anyway)
        if (!hostedUrl) {
          try {
            const b64 = imgBuf.toString('base64');
            hostedUrl = `data:image/jpeg;base64,${b64}`;
          } catch {}
        }

        if (hostedUrl) {
          setWaSetting(waNum, 'menuImg', hostedUrl);
          const isDataUrl = hostedUrl.startsWith('data:');
          await reply(`✅ Menu image set from *${imgSource}*.${isDataUrl ? '\n_Stored locally (all upload hosts failed)._' : `\n🔗 ${hostedUrl}`}`);
        } else {
          await reply('❌ Got image buffer but could not store it. Check your uploader helper.');
        }
        break;
      }

      // FB7: URL passed as argument – use it directly without downloading (last resort)
      if (args[0]?.startsWith('http')) {
        setWaSetting(waNum, 'menuImg', args[0]);
        await reply(`✅ Menu image URL saved directly: ${args[0]}`);
        break;
      }

      await reply(
        `❌ No image found. Try:\n` +
        `• Send an image + *${prefix}setmenuimg* as caption\n` +
        `• Reply to any image/sticker/video with *${prefix}setmenuimg*\n` +
        `• *${prefix}setmenuimg <direct image url>*`
      );
      break;
    }

    case 'setbotimg': {
      if (needOwner()) break;
      const { qMsg, qType, qKey } = getQuoted(m);
      const ownImg = m.message?.imageMessage;
      let buf = null;
      try {
        if (ownImg) {
          buf = await dlMedia({ imageMessage: ownImg }, m.key);
        } else if (qType === 'imageMessage') {
          buf = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
        } else if (args[0]?.startsWith('http')) {
          buf = await getBuffer(args[0]);
        } else {
          await reply(`Reply to an image OR ${prefix}setbotimg <url>`);
          break;
        }
        if (!buf || buf.length < 100) throw new Error('Image buffer is empty');
        let finalBuf = buf;
        try {
          const sharp = require('sharp');
          finalBuf = await sharp(buf).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
        } catch { finalBuf = buf; }
        await sock.updateProfilePicture(sock.user.id, finalBuf);
        await reply('✅ Bot picture updated.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'setfonts': {
      if (needOwner()) break;
      const fi = parseInt(args[0], 10);
      if (isNaN(fi) || fi < 0 || fi > 12) {
        await reply('0=Normal 1=Script 2=Italic 3=BoldItalic 4=Bold 5=Sans 6=SansItalic 7=SansBoldItalic 8=SansBold 9=Fraktur 10=BoldFraktur 11=DoubleStruck 12=Mono\n.setfonts <0-12>');
        break;
      }
      setWaSetting(waNum, 'font', fi);
      await reply(`✅ Font → style ${fi}`);
      break;
    }

    case 'public': { if (needOwner()) break; setWaSetting(waNum, 'mode', 'public'); await reply('✅ Mode → public'); break; }
    case 'self':   { if (needOwner()) break; setWaSetting(waNum, 'mode', 'self');   await reply('✅ Mode → self');   break; }

    case 'addprem': {
      if (needOwner()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('Reply or pass number.'); break; }
      await reply(addPremium(t) ? `✅ @${normNum(t)} → premium` : 'Already premium.');
      break;
    }

    case 'delprem': {
      if (needOwner()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('Reply or pass number.'); break; }
      await reply(removePremium(t) ? `✅ @${normNum(t)} removed` : 'Not premium.');
      break;
    }

    case 'antidelete': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antidelete on/off`); break; }
      setWaSetting(waNum, 'antidelete', v === 'on');
      await reply(`✅ AntiDelete → ${v}`);
      break;
    }

    case 'anticall': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}anticall on/off`); break; }
      setWaSetting(waNum, 'anticall', v === 'on');
      await reply(`✅ AntiCall → ${v}`);
      break;
    }

    case 'iphonemode': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}iphonemode on/off`); break; }
      setWaSetting(waNum, 'iphoneMode', v === 'on');
      await reply(`✅ iPhone mode → ${v}`);
      break;
    }

    case 'autoviewstatus': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}autoviewstatus on/off`); break; }
      setWaSetting(waNum, 'autoViewStatus', v === 'on');
      await reply(`✅ Auto view status → ${v}`);
      break;
    }

    case 'autolikestatus': {
      if (needOwner()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}autolikestatus on/off`); break; }
      setWaSetting(waNum, 'autoLikeStatus', v === 'on');
      await reply(`✅ Auto like status → ${v}`);
      break;
    }

    case 'block': {
      if (needOwner()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('Reply or pass number.'); break; }
      await sock.updateBlockStatus(t, 'block');
      await reply(`✅ @${normNum(t)} blocked.`);
      break;
    }

    case 'unblock': {
      if (needOwner()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('Reply or pass number.'); break; }
      await sock.updateBlockStatus(t, 'unblock');
      await reply(`✅ @${normNum(t)} unblocked.`);
      break;
    }

    case 'listblocked': {
      if (needOwner()) break;
      try {
        const priv = await sock.fetchPrivacySettings();
        const blocklist = priv?.blockedContacts || [];
        if (!blocklist.length) { await reply('No blocked contacts.'); break; }
        await reply(`🚫 *Blocked (${blocklist.length}):*\n${blocklist.map(j => `• +${normNum(j)}`).join('\n')}`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'broadcast': {
      if (needOwner()) break;
      const msg = args.join(' ');
      if (!msg) { await reply(`${prefix}broadcast <message>`); break; }
      try {
        const contacts = await sock.getContacts?.() || [];
        let sent = 0;
        for (const c2 of contacts) {
          if (!c2.id?.endsWith('@s.whatsapp.net')) continue;
          try { await sock.sendMessage(c2.id, { text: msg }); sent++; await new Promise(r => setTimeout(r, 300)); } catch {}
        }
        await reply(`✅ Broadcast sent to ${sent} contacts.`);
      } catch { await reply('❌ Broadcast failed.'); }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   GROUP – EXISTING
    // ══════════════════════════════════════════════════════

    case 'promote': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      await sock.groupParticipantsUpdate(jid, [t], 'promote');
      await reply(`✅ @${normNum(t)} promoted.`);
      break;
    }

    case 'demote': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to an admin.'); break; }
      await sock.groupParticipantsUpdate(jid, [t], 'demote');
      await reply(`✅ @${normNum(t)} demoted.`);
      break;
    }

    case 'kick': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      await sock.groupParticipantsUpdate(jid, [t], 'remove');
      await reply(`✅ @${normNum(t)} kicked.`);
      break;
    }

    case 'mute': {
      if (needGroup() || needAdmin()) break;
      await sock.groupSettingUpdate(jid, 'announcement');
      await reply('🔇 Group muted. Only admins can send messages.');
      break;
    }

    case 'unmute': {
      if (needGroup() || needAdmin()) break;
      await sock.groupSettingUpdate(jid, 'not_announcement');
      await reply('🔊 Group unmuted. Everyone can send messages.');
      break;
    }

    case 'lock': {
      if (needGroup() || needAdmin()) break;
      await sock.groupSettingUpdate(jid, 'locked');
      await reply('🔒 Group info locked to admins.');
      break;
    }

    case 'unlock': {
      if (needGroup() || needAdmin()) break;
      await sock.groupSettingUpdate(jid, 'unlocked');
      await reply('🔓 Group info open to all.');
      break;
    }

    case 'tagall':
    case 'everyone': {
      if (needGroup() || needAdmin()) break;
      const mentions = participants.map(p => p.id || p.jid).filter(Boolean);
      const txt = text || '📢 Attention everyone!';
      await sock.sendMessage(jid, { text: `${txt}\n${mentions.map(x => `@${normNum(x)}`).join(' ')}`, mentions }, { quoted: qchanel });
      break;
    }

    case 'tagadmins':
    case 'admins': {
      if (needGroup()) break;
      if (!groupAdmins.length) { await reply('No admins found.'); break; }
      const txt = text || '📢 Admins!';
      await sock.sendMessage(jid, {
        text: `${txt}\n${groupAdmins.map(x => `@${normNum(x)}`).join(' ')}`,
        mentions: groupAdmins,
      }, { quoted: qchanel });
      break;
    }

    case 'grouplink':
    case 'invitelink': {
      if (needGroup() || needAdmin()) break;
      const code = await sock.groupInviteCode(jid);
      await reply(`🔗 https://chat.whatsapp.com/${code}`);
      break;
    }

    case 'revoke': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      await sock.groupRevokeInvite(jid);
      await reply('✅ Invite link revoked. Old link no longer works.');
      break;
    }

    case 'groupinfo': {
      if (needGroup()) break;
      const adminNames = participants
        .filter(p => p.admin)
        .map(p => p.full?.notify || p.full?.name || `+${normNum(p.jid || p.id)}`)
        .join(', ') || 'None';
      await reply(
        `📋 *${groupName}*\n\nDescription: ${groupMetadata.desc || 'None'}\nMembers: ${participants.length}\nAdmins: ${adminNames}\nOwner: +${normNum(groupOwner)}\nCreated: ${new Date((groupMetadata.creation||0)*1000).toLocaleString()}`
      );
      break;
    }

    case 'members': {
      if (needGroup()) break;
      const list = participants.map((p,i) => `${i+1}. +${normNum(p.jid||p.id)} ${p.admin === 'superadmin' ? '👑' : p.admin ? '🛡' : ''}`).join('\n');
      await reply(`👥 *Members (${participants.length})*\n\n${list}`);
      break;
    }

    case 'setgname': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const name = args.join(' '); if (!name) { await reply(`${prefix}setgname <name>`); break; }
      await sock.groupUpdateSubject(jid, name);
      await reply(`✅ Group name → ${name}`);
      break;
    }

    case 'setgdesc': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const desc = args.join(' '); if (!desc) { await reply(`${prefix}setgdesc <description>`); break; }
      await sock.groupUpdateDescription(jid, desc);
      await reply('✅ Description updated.');
      break;
    }

    case 'hidetag': {
      if (needGroup() || needAdmin()) break;
      const mentions2 = participants.map(p => p.id || p.jid).filter(Boolean);
      await sock.sendMessage(jid, { text: text || ' ', mentions: mentions2 });
      break;
    }

    case 'warn': {
      if (needGroup() || needAdmin()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      const wFile = DB('warnings.json');
      const data  = readJSON(wFile, {});
      const key2  = `${jid}|${normNum(t)}`;
      data[key2]  = (data[key2] || 0) + 1;
      writeJSON(wFile, data);
      const count = data[key2];
      let extra = '';
      if (count >= 3) {
        extra = '\n⛔ *3 warnings reached! Kicking...*';
        try { await sock.groupParticipantsUpdate(jid, [t], 'remove'); } catch {}
        delete data[key2];
        writeJSON(wFile, data);
      }
      await reply(`⚠️ @${normNum(t)} warned (${Math.min(count,3)}/3).${extra}`);
      break;
    }

    case 'resetwarn': {
      if (needGroup() || needAdmin()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      const wFile = DB('warnings.json');
      const data  = readJSON(wFile, {});
      delete data[`${jid}|${normNum(t)}`];
      writeJSON(wFile, data);
      await reply(`✅ @${normNum(t)} warnings reset.`);
      break;
    }

    case 'warnings': {
      if (needGroup()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      const count = (readJSON(DB('warnings.json'), {})[`${jid}|${normNum(t)}`] || 0);
      await reply(`⚠️ @${normNum(t)} has ${count}/3 warnings.`);
      break;
    }

    case 'antilink': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antilink on/off`); break; }
      setGroupFlag('antilink.json', jid, v === 'on');
      await reply(`✅ AntiLink → ${v}`);
      break;
    }

    case 'antimedia': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antimedia on/off`); break; }
      setGroupFlag('antimedia.json', jid, v === 'on');
      await reply(`✅ AntiMedia → ${v}`);
      break;
    }

    case 'welcome': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}welcome on/off`); break; }
      setGroupFlag('welcome.json', jid, v === 'on');
      await reply(`✅ Welcome messages → ${v}`);
      break;
    }

    case 'goodbye': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}goodbye on/off`); break; }
      setGroupFlag('goodbye.json', jid, v === 'on');
      await reply(`✅ Goodbye messages → ${v}`);
      break;
    }

    case 'listgroups': {
      if (needOwner()) break;
      try {
        const groups = await sock.groupFetchAllParticipating();
        const list   = Object.values(groups).map((g,i) => `${i+1}. ${g.subject} (${g.participants?.length||0} members)`).join('\n');
        await reply(`📋 *Groups (${Object.keys(groups).length})*\n\n${list || 'None'}`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'friends': {
      try {
        const contacts = await sock.getContacts?.() || [];
        const dms = contacts.filter(c2 => c2.id?.endsWith('@s.whatsapp.net')).slice(0, 50);
        if (!dms.length) { await reply('No contacts found.'); break; }
        const list = dms.map((c2, i) => `${i+1}. ${c2.name || c2.notify || `+${normNum(c2.id)}`}`).join('\n');
        await reply(`👥 *Friends/Contacts (${dms.length})*\n\n${list}`);
      } catch { await reply('❌ Could not fetch contacts.'); }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   GROUP – NEW COMMANDS
    // ══════════════════════════════════════════════════════

    // Approve all join requests
    case 'approveall': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      await reaction('✅');
      try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) { await reply('📭 No pending join requests.'); break; }
        const jids = pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(jid, jids, 'approve');
        await reply(`✅ Approved *${jids.length}* pending request(s).`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // Check pending join requests
    case 'checkpending': {
      if (needGroup() || needAdmin()) break;
      try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) { await reply('📭 No pending join requests.'); break; }
        const list = pending.map((p, i) => `${i+1}. +${normNum(p.jid)}`).join('\n');
        await reply(`📋 *Pending Requests (${pending.length})*\n\n${list}`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // Reject all join requests
    case 'rejectall': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      await reaction('❌');
      try {
        const pending = await sock.groupRequestParticipantsList(jid);
        if (!pending?.length) { await reply('📭 No pending join requests.'); break; }
        const jids = pending.map(p => p.jid);
        await sock.groupRequestParticipantsUpdate(jid, jids, 'reject');
        await reply(`🚫 Rejected *${jids.length}* pending request(s).`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // Disapprove / remove member
    case 'disap': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      let tRaw = getTargetJid(m, args);
      // also accept raw number in args
      if (!tRaw && args[0]) {
        const cleaned = args[0].replace(/[^0-9]/g, '');
        if (cleaned.length >= 7) tRaw = cleaned + '@s.whatsapp.net';
      }
      if (!tRaw) { await reply(`❌ Reply to a member or: ${prefix}disap <number>`); break; }
      // normalise to full JID for admin check
      const tFull = tRaw.includes('@') ? tRaw : normNum(tRaw) + '@s.whatsapp.net';
      const adminNorms = groupAdmins.map(a => (a.includes('@') ? a : a + '@s.whatsapp.net'));
      if (adminNorms.includes(tFull)) { await reply('❌ Cannot remove an admin.'); break; }
      try {
        await sock.groupParticipantsUpdate(jid, [tFull], 'remove');
        await reply(`🚫 @${normNum(tFull)} has been disapproved and removed.`);
      } catch (e) { await reply('❌ disap failed: ' + e.message); }
      break;
    }

    // Anti-mention (protect members from mass mentions / mention spam)
    case 'antimention': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antimention on/off`); break; }
      setGroupFlag('antimention.json', jid, v === 'on');
      await reply(`✅ AntiMention → ${v}\n_Members who mass-mention will be warned._`);
      break;
    }

    // Anti-spam (too many messages in short time → warn/kick)
    case 'antispam': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antispam on/off`); break; }
      setGroupFlag('antispam.json', jid, v === 'on');
      await reply(`✅ AntiSpam → ${v}\n_Members sending >5 msgs in 5s will be warned._`);
      break;
    }

    // Anti-bot (blocks other bot commands from non-owners)
    case 'antibot': {
      if (needGroup() || needAdmin()) break;
      const v = args[0]?.toLowerCase();
      if (!['on','off'].includes(v)) { await reply(`${prefix}antibot on/off`); break; }
      setGroupFlag('antibot.json', jid, v === 'on');
      await reply(`✅ AntiBot → ${v}\n_Bot commands from non-admin members will be deleted._`);
      break;
    }

    // Slow mode – set message cooldown
    case 'slowmode': {
      if (needGroup() || needAdmin()) break;
      const secs = parseInt(args[0]);
      if (!args[0] || args[0] === 'off') {
        const sm = readJSON(DB('slowmode.json'), {});
        delete sm[jid];
        writeJSON(DB('slowmode.json'), sm);
        await reply('✅ Slow mode disabled.');
        break;
      }
      if (isNaN(secs) || secs < 1 || secs > 3600) { await reply(`${prefix}slowmode <seconds 1-3600> | off`); break; }
      const sm = readJSON(DB('slowmode.json'), {});
      sm[jid] = secs;
      writeJSON(DB('slowmode.json'), sm);
      await reply(`⏱ Slow mode → *${secs}s* between messages per member.`);
      break;
    }

    // Soft-ban: mute a specific member (remove then re-add – they can't send until re-added)
    case 'softban': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      const t = getTargetJid(m, args); if (!t) { await reply('❌ Reply to a member.'); break; }
      if (groupAdmins.includes(t)) { await reply('❌ Cannot soft-ban an admin.'); break; }
      try {
        await sock.groupParticipantsUpdate(jid, [t], 'remove');
        await new Promise(r => setTimeout(r, 2000));
        await sock.groupParticipantsUpdate(jid, [t], 'add');
        await reply(`🔇 @${normNum(t)} soft-banned (removed & re-added, messages reset).`);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // Kick all non-admins
    case 'kickall': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      if (!_isOwner) { await reply('❌ Owner only.'); break; }
      const nonAdmins = participants.filter(p => !p.admin).map(p => p.jid || p.id).filter(Boolean);
      if (!nonAdmins.length) { await reply('No non-admin members to kick.'); break; }
      await reply(`⚠️ Kicking *${nonAdmins.length}* members...`);
      let done = 0;
      for (const t of nonAdmins) {
        try { await sock.groupParticipantsUpdate(jid, [t], 'remove'); done++; await new Promise(r => setTimeout(r, 500)); } catch {}
      }
      await reply(`✅ Kicked *${done}/${nonAdmins.length}* members.`);
      break;
    }

    // Set custom welcome message
    case 'setwelcomemsg': {
      if (needGroup() || needAdmin()) break;
      const msg = args.join(' ');
      if (!msg) { await reply(`${prefix}setwelcomemsg <message>\nUse {name} for member name, {group} for group name.`); break; }
      const wm = readJSON(DB('welcomemsgs.json'), {});
      wm[jid] = msg;
      writeJSON(DB('welcomemsgs.json'), wm);
      await reply(`✅ Welcome message set:\n${msg}`);
      break;
    }

    // Set custom goodbye message
    case 'setgoodbyemsg': {
      if (needGroup() || needAdmin()) break;
      const msg = args.join(' ');
      if (!msg) { await reply(`${prefix}setgoodbyemsg <message>\nUse {name} for member name, {group} for group name.`); break; }
      const gm = readJSON(DB('goodbyemsgs.json'), {});
      gm[jid] = msg;
      writeJSON(DB('goodbyemsgs.json'), gm);
      await reply(`✅ Goodbye message set:\n${msg}`);
      break;
    }

    // Mute list – see who has been muted via softban
    case 'mutelist': {
      if (needGroup() || needAdmin()) break;
      const ml = readJSON(DB('mutedmembers.json'), {});
      const list2 = (ml[jid] || []);
      if (!list2.length) { await reply('No muted members.'); break; }
      await reply(`🔇 *Muted Members (${list2.length})*\n${list2.map((j2,i) => `${i+1}. +${normNum(j2)}`).join('\n')}`);
      break;
    }

    // Kick inactive members (no messages in X days tracked via DB)
    case 'kickinactive': {
      if (needGroup() || needAdmin() || needBotAdm()) break;
      if (!_isOwner) { await reply('❌ Owner only.'); break; }
      const days = parseInt(args[0]) || 7;
      const actFile = DB('activity.json');
      const act = readJSON(actFile, {});
      const cutoff = Date.now() - days * 86400000;
      const inactive = participants
        .filter(p => !p.admin)
        .map(p => p.jid || p.id)
        .filter(pjid => {
          const key3 = `${jid}|${normNum(pjid)}`;
          return !act[key3] || act[key3] < cutoff;
        });
      if (!inactive.length) { await reply(`✅ No inactive members (>${days} days) found.`); break; }
      await reply(`⚠️ Kicking *${inactive.length}* members inactive for >${days} days...`);
      let done2 = 0;
      for (const t of inactive) {
        try { await sock.groupParticipantsUpdate(jid, [t], 'remove'); done2++; await new Promise(r => setTimeout(r, 500)); } catch {}
      }
      await reply(`✅ Kicked *${done2}* inactive members.`);
      break;
    }

    // ══════════════════════════════════════════════════════
    //   UTILITY – EXISTING
    // ══════════════════════════════════════════════════════

    case 'sticker': {
      await reaction('🎨');
      const { qMsg, qType, qKey } = getQuoted(m);
      const imgMsg = m.message?.imageMessage || (qType === 'imageMessage' ? qMsg?.imageMessage : null);
      const vidMsg = m.message?.videoMessage  || (qType === 'videoMessage' ? qMsg?.videoMessage  : null);
      const stickerSrc = imgMsg ? { imageMessage: imgMsg } : vidMsg ? { videoMessage: vidMsg } : null;
      const stickerKey = imgMsg
        ? (m.message?.imageMessage ? m.key : qKey)
        : m.message?.videoMessage ? m.key : qKey;
      if (!stickerSrc) { await reply(`Reply to an image or video with ${prefix}sticker`); break; }
      try {
        const buf = await dlMedia(stickerSrc, stickerKey);
        const tmp = `/tmp/stk_${Date.now()}`;
        fs.writeFileSync(`${tmp}.in`, buf);
        await new Promise((res, rej) =>
          exec(`ffmpeg -y -i ${tmp}.in -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" -loop 0 ${tmp}.webp 2>/dev/null`, e => e ? rej(e) : res())
        );
        const webp = fs.readFileSync(`${tmp}.webp`);
        await sock.sendMessage(jid, { sticker: webp }, { quoted: qchanel });
        try { fs.unlinkSync(`${tmp}.in`); fs.unlinkSync(`${tmp}.webp`); } catch {}
      } catch { await reply('❌ Sticker failed. Make sure ffmpeg is installed.'); }
      break;
    }

    case 'toimg': {
      const { qMsg, qType, qKey } = getQuoted(m);
      const sm = m.message?.stickerMessage || (qType === 'stickerMessage' ? qMsg?.stickerMessage : null);
      if (!sm) { await reply('Reply to a sticker.'); break; }
      const srcKey = m.message?.stickerMessage ? m.key : qKey;
      try {
        const buf = await dlMedia({ stickerMessage: sm }, srcKey);
        await replyImg(buf, '🖼 Sticker → Image');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'vv': {
      const { qMsg, qType, qKey } = getQuoted(m);
      if (!qMsg) { await reply('Reply to a view-once message.'); break; }
      let inner = qMsg;
      for (const w of ['viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension']) {
        if (inner[w]?.message) { inner = inner[w].message; break; }
      }
      const voImg = inner.imageMessage;
      const voVid = inner.videoMessage;
      if (!voImg && !voVid) { await reply('Not a view-once message.'); break; }
      try {
        const src = voImg ? { imageMessage: voImg } : { videoMessage: voVid };
        const buf = await dlMedia(src, qKey);
        if (voImg) await replyImg(buf, '👁 Revealed');
        else if (!cfg(sock).iphoneMode) await sock.sendMessage(jid, { video: buf, caption: '👁 Revealed' }, { quoted: qchanel });
        else await reply('👁 View Once revealed [video]');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'qr': {
      if (!text) { await reply(`${prefix}qr <text>`); break; }
      await replyImg(`https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`, `🔲 QR: ${text}`);
      break;
    }

    case 'weather': {
      const city = text; if (!city) { await reply(`${prefix}weather <city>`); break; }
      try {
        const r = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=4&m`, { timeout: 8000 });
        await reply(`🌤 *${city}*\n${r.data}`);
      } catch { await reply('❌ Weather fetch failed.'); }
      break;
    }

    case 'tr': {
      const lang = args[0]; const txt2 = args.slice(1).join(' ');
      if (!lang || !txt2) { await reply(`${prefix}tr <lang> <text>\nExample: ${prefix}tr es Hello World`); break; }
      try {
        const r = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(txt2)}&langpair=en|${lang}`, { timeout: 8000 });
        await reply(`🌐 (${lang}) ${r.data.responseData.translatedText}`);
      } catch { await reply('❌ Translation failed.'); }
      break;
    }

    case 'uploadstatus': {
      if (needOwner()) break;
      const { qMsg, qType, qKey } = getQuoted(m);
      try {
        if (qType === 'imageMessage') {
          const buf = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
          await sock.sendMessage('status@broadcast', { image: buf, caption: qMsg.imageMessage?.caption || '' });
        } else if (qType === 'videoMessage') {
          const buf = await dlMedia({ videoMessage: qMsg.videoMessage }, qKey);
          await sock.sendMessage('status@broadcast', { video: buf, caption: qMsg.videoMessage?.caption || '' });
        } else {
          const t2 = text || qMsg?.conversation || qMsg?.extendedTextMessage?.text || '';
          if (!t2) { await reply('Provide text or reply to media.'); break; }
          await sock.sendMessage('status@broadcast', { text: t2 }, { backgroundColor: '#128C7E', font: 3 });
        }
        await reply('✅ Status uploaded.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'setmypp': {
      const { qMsg, qType, qKey } = getQuoted(m);
      const ownImg = m.message?.imageMessage;
      let buf = null;
      try {
        if (ownImg) {
          buf = await dlMedia({ imageMessage: ownImg }, m.key);
        } else if (qType === 'imageMessage') {
          buf = await dlMedia({ imageMessage: qMsg.imageMessage }, qKey);
        } else if (args[0]?.startsWith('http')) {
          buf = await getBuffer(args[0]);
        } else { await reply(`Reply to an image or ${prefix}setmypp <url>`); break; }
        if (!buf || buf.length < 100) throw new Error('Image buffer empty');
        let finalBuf = buf;
        try {
          const sharp = require('sharp');
          finalBuf = await sharp(buf).resize(640, 640, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
        } catch { finalBuf = buf; }
        await sock.updateProfilePicture(jid, finalBuf);
        await reply('✅ Profile picture updated.');
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    case 'getpp': {
      const t = getTargetJid(m, args);
      const target = t || `${botNumber}@s.whatsapp.net`;
      try {
        const ppUrl = await sock.profilePictureUrl(target, 'image');
        const r = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 10000 });
        await replyImg(Buffer.from(r.data), `🖼 +${normNum(target)}`);
      } catch { await reply('❌ No profile picture or privacy restricted.'); }
      break;
    }

    case 'tts': {
      if (!text) { await reply(`${prefix}tts <text>`); break; }
      if (text.length >= 300) { await reply('❌ Max 300 characters.'); break; }
      await reply('⏳ Generating voice...');
      try {
        const { data } = await axios.post(
          'https://tiktok-tts.weilnet.workers.dev/api/generation',
          { text, voice: 'id_001' },
          { timeout: 15000 }
        );
        if (!data?.data) throw new Error('No audio returned');
        await sock.sendMessage(jid, {
          audio: Buffer.from(data.data, 'base64'),
          mimetype: 'audio/mp4',
        }, { quoted: qchanel });
      } catch (e) { await reply('❌ TTS failed: ' + e.message); }
      break;
    }

    case 'ocr': {
      const { qMsg, qType, qKey } = getQuoted(m);
      const imgMsg = m.message?.imageMessage || (qType === 'imageMessage' ? qMsg?.imageMessage : null);
      if (!imgMsg) { await reply('Reply to an image.'); break; }
      try {
        const srcKey = m.message?.imageMessage ? m.key : qKey;
        const buf    = await dlMedia({ imageMessage: imgMsg }, srcKey);
        const b64    = buf.toString('base64');
        const r      = await axios.post('https://api.ocr.space/parse/image',
          `base64Image=data:image/jpeg;base64,${b64}&language=eng`,
          { headers: { apikey: 'helloworld', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );
        const txt2 = r.data?.ParsedResults?.[0]?.ParsedText || 'No text found.';
        await reply(`📝 OCR:\n${txt2}`);
      } catch { await reply('❌ OCR failed.'); }
      break;
    }

    case 'shorten': {
      const url = args[0];
      if (!url?.startsWith('http')) { await reply(`${prefix}shorten <url>`); break; }
      try {
        const r = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { timeout: 8000 });
        await reply(`🔗 ${r.data}`);
      } catch { await reply('❌ Failed.'); }
      break;
    }

    case 'tourl': {
      await reaction('📄');
      const { qMsg: qMsgTU, qType: qTypeTU, qKey: qKeyTU } = getQuoted(m);
      const MEDIA_TYPES = ['imageMessage','videoMessage','stickerMessage','audioMessage','documentMessage'];
      const mediaTypeTU = MEDIA_TYPES.find(t2 => qMsgTU?.[t2]);
      if (!qMsgTU || !mediaTypeTU) {
        await reply(`❌ Reply to an image, video, sticker, or audio with ${prefix}tourl`);
        break;
      }
      try {
        const buf = await dlMedia(qMsgTU, qKeyTU);
        if (!buf) throw new Error('Media download failed');
        const { uploadToTelegraph } = require('./helper/uploader');
        const mimeMap = {
          imageMessage: 'image/jpeg',
          videoMessage: 'video/mp4',
          stickerMessage: 'image/webp',
          audioMessage: 'audio/mp4',
          documentMessage: qMsgTU.documentMessage?.mimetype || 'application/octet-stream',
        };
        const link = await uploadToTelegraph(buf, mimeMap[mediaTypeTU]);
        if (!link) throw new Error('Upload failed');

        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        const msg = await generateWAMessageFromContent(jid, {
          viewOnceMessage: {
            message: {
              interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body: proto.Message.InteractiveMessage.Body.fromObject({
                  text: `✅ Converted to link!\nExpires: Never\n\n${link}`,
                }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: '' }),
                header: proto.Message.InteractiveMessage.Header.fromObject({
                  title: '[ ! ] INFORMATION',
                  subtitle: '',
                  hasMediaAttachment: false,
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                  buttons: [{
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({ display_text: 'Copy Link!', copy_code: link }),
                  }],
                }),
                contextInfo: { mentionedJid: [sender] },
              }),
            },
          },
        }, { quoted: qchanel });
        await sock.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
      } catch (e) {
        logError('tourl', e.message);
        await reply('❌ ' + e.message);
      }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   PLAY – FIXED (multi-API fallback chain)
    // ══════════════════════════════════════════════════════

    case 'play': {
  const query = text;
  if (!query) { await reply(`🎵 *${prefix}play <song name>*\nExample: ${prefix}play Faded`); break; }
  await reaction('🎵');
  await reply('🎵 Searching song...');
  try {
    const { data } = await axios.get(
      `https://api.drexapp.space/downloader/ytplayv2?q=${encodeURIComponent(query)}`,
      { timeout: 30000 }
    );
    if (!data.status || !data.result?.downloadURL) {
      await reply('❌ Failed to fetch audio');
      break;
    }
    const res = data.result;
    await sock.sendMessage(jid, {
      text: `🎵 *${res.title}*\n\n⬇️ Downloading audio...`
    }, { quoted: m });
    await sock.sendMessage(jid, {
      audio: { url: res.downloadURL },
      mimetype: 'audio/mpeg',
      fileName: `${res.title}.mp3`
    }, { quoted: m });
  } catch (err) {
    console.error('PLAY Error:', err);
    await reply('❌ Error downloading audio');
  }
  break;
}

    case 'playdoc': {
      const query2 = text;
      if (!query2) { await reply(`🎵 ${prefix}playdoc <song name>`); break; }
      await reaction('⬇️');
      try {
        const yts = require('yt-search');
        const search = await yts(query2);
        const video = search.videos?.[0] || search.all?.[0];
        if (!video) throw new Error('No results found');
        const { data } = await axios.get(
          `https://api.privatezia.biz.id/api/downloader/ytmp3?url=${encodeURIComponent(video.url)}`,
          { timeout: 20000 }
        );
        if (!data?.status) throw new Error('API failed');
        const dlUrl = data.result?.downloadUrl || data.url;
        if (!dlUrl) throw new Error('No download URL');
        await reply(`⬇️ Downloading *${video.title}*...`);
        const dlRes = await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const buf   = Buffer.from(dlRes.data);
        const fname = video.title.replace(/[^\w\s]/g, '').trim() + '.mp3';
        await sock.sendMessage(jid, {
          document: buf,
          mimetype: 'audio/mpeg',
          caption:  ft(`🎵 ${video.title}\n© ${settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫'}`, sock),
          fileName: fname,
        }, { quoted: qchanel });
      } catch (e) { await reply('❌ Failed: ' + e.message); }
      break;
    }

    // ── YouTube Video Download ────────────────────────────
    case 'ytmp4': {
      if (!text) { await reply(`${prefix}ytmp4 <YouTube link or title>`); break; }
      await reaction('🎬');
      await reply('⏳ Processing video...');
      try {
        const yts = require('yt-search');
        const isUrl = text.includes('youtu');
        let videoUrl = text;
        let videoTitle = 'video';
        if (!isUrl) {
          const search = await yts(text);
          const v = search.videos?.[0];
          if (!v) throw new Error('No results');
          videoUrl = v.url;
          videoTitle = v.title;
        }
        const { data } = await axios.get(
          `https://api.privatezia.biz.id/api/downloader/ytmp4?url=${encodeURIComponent(videoUrl)}`,
          { timeout: 25000 }
        );
        const dlUrl = data?.result?.downloadUrl || data?.url;
        if (!dlUrl) throw new Error('No video URL');
        await sock.sendMessage(jid, {
          video: { url: dlUrl },
          caption: ft(`🎬 ${videoTitle}`, sock),
          fileName: videoTitle.replace(/[^\w\s]/g,'').trim() + '.mp4',
        }, { quoted: qchanel });
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // ── Lyrics ───────────────────────────────────────────
    case 'lyrics': {
      if (!text) { await reply(`${prefix}lyrics <song name>`); break; }
      await reaction('🎤');
      try {
        const { data } = await axios.get(
          `https://some-random-api.com/lyrics?title=${encodeURIComponent(text)}`,
          { timeout: 10000 }
        );
        if (!data?.lyrics) throw new Error('Not found');
        const lrc = data.lyrics.length > 3000 ? data.lyrics.slice(0, 3000) + '...' : data.lyrics;
        await reply(`🎤 *${data.title}*\n👤 ${data.author}\n\n${lrc}`);
      } catch { await reply('❌ Lyrics not found. Try a different song title.'); }
      break;
    }

    // ── Instagram downloader ──────────────────────────────
    case 'instagram':
    case 'ig': {
      const igUrl = args[0];
      if (!igUrl?.includes('instagram.com')) { await reply(`${prefix}instagram <post/reel url>`); break; }
      await reaction('📸');
      try {
        const { data } = await axios.get(
          `https://api.ootaizumi.web.id/downloader/instagram?url=${encodeURIComponent(igUrl)}`,
          { timeout: 20000 }
        );
        if (!data?.status || !data.result?.url) throw new Error('Failed');
        const r = data.result;
        if (r.type === 'video') {
          await sock.sendMessage(jid, { video: { url: r.url }, caption: ft(r.caption || '📸 Instagram', sock) }, { quoted: qchanel });
        } else {
          await replyImg(r.url, r.caption?.slice(0,200) || '📸 Instagram');
        }
      } catch (e) { await reply('❌ Instagram download failed: ' + e.message); }
      break;
    }

    // ── TikTok downloader ────────────────────────────────
    case 'tiktok':
    case 'tt': {
      const ttUrl = args[0];
      if (!ttUrl?.includes('tiktok.com')) { await reply(`${prefix}tiktok <tiktok video url>`); break; }
      await reaction('🎵');
      try {
        const { data } = await axios.get(
          `https://api.ootaizumi.web.id/downloader/tiktok?url=${encodeURIComponent(ttUrl)}`,
          { timeout: 20000 }
        );
        if (!data?.status || !data.result?.video) throw new Error('Failed');
        const r = data.result;
        await sock.sendMessage(jid, { video: { url: r.video }, caption: ft(r.title || '🎵 TikTok', sock) }, { quoted: qchanel });
      } catch (e) { await reply('❌ TikTok download failed: ' + e.message); }
      break;
    }

    // ── Facebook downloader ──────────────────────────────
    case 'facebook':
    case 'fb': {
      const fbUrl = args[0];
      if (!fbUrl?.includes('facebook.com') && !fbUrl?.includes('fb.watch')) { await reply(`${prefix}facebook <facebook video url>`); break; }
      await reaction('📘');
      try {
        const { data } = await axios.get(
          `https://api.ootaizumi.web.id/downloader/facebook?url=${encodeURIComponent(fbUrl)}`,
          { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        const videoUrl = r?.sd || r?.hd || r?.video;
        if (!videoUrl) throw new Error('No video URL');
        await sock.sendMessage(jid, { video: { url: videoUrl }, caption: ft('📘 Facebook', sock) }, { quoted: qchanel });
      } catch (e) { await reply('❌ Facebook download failed: ' + e.message); }
      break;
    }

    // ── Twitter/X downloader ─────────────────────────────
    case 'twitter':
    case 'x': {
      const twUrl = args[0];
      if (!twUrl?.includes('twitter.com') && !twUrl?.includes('x.com')) { await reply(`${prefix}twitter <tweet/video url>`); break; }
      await reaction('🐦');
      try {
        const { data } = await axios.get(
          `https://api.ootaizumi.web.id/downloader/twitter?url=${encodeURIComponent(twUrl)}`,
          { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        const videoUrl = r?.video || r?.url;
        if (!videoUrl) throw new Error('No URL');
        await sock.sendMessage(jid, { video: { url: videoUrl }, caption: ft('🐦 Twitter/X', sock) }, { quoted: qchanel });
      } catch (e) { await reply('❌ Twitter download failed: ' + e.message); }
      break;
    }

    // ── Pinterest downloader ──────────────────────────────
    case 'pinterest': {
      const pinUrl = args[0];
      if (!pinUrl?.includes('pinterest')) { await reply(`${prefix}pinterest <pinterest url>`); break; }
      await reaction('📌');
      try {
        const { data } = await axios.get(
          `https://api.ootaizumi.web.id/downloader/pinterest?url=${encodeURIComponent(pinUrl)}`,
          { timeout: 20000 }
        );
        if (!data?.status) throw new Error('Failed');
        const r = data.result;
        if (r?.video) {
          await sock.sendMessage(jid, { video: { url: r.video }, caption: '📌 Pinterest' }, { quoted: qchanel });
        } else if (r?.image) {
          await replyImg(r.image, '📌 Pinterest');
        } else throw new Error('No media found');
      } catch (e) { await reply('❌ Pinterest download failed: ' + e.message); }
      break;
    }

    // ── Spotify track info ────────────────────────────────
    case 'spotify': {
      if (!text) { await reply(`${prefix}spotify <track name>`); break; }
      await reaction('🎧');
      try {
        const { data } = await axios.get(
          `https://some-random-api.com/others/spotify?q=${encodeURIComponent(text)}`,
          { timeout: 10000 }
        );
        if (!data?.title) throw new Error('Not found');
        const bar = `▓`.repeat(Math.floor((data.duration_ms/100)/60000 * 20)).padEnd(20,'░');
        await replyImg(
          data.album_art,
          `🎧 *${data.title}*\n👤 ${data.artists?.join(', ') || 'Unknown'}\n💿 ${data.album}\n⏱ ${Math.floor(data.duration_ms/60000)}:${String(Math.floor((data.duration_ms%60000)/1000)).padStart(2,'0')}\n\n[${bar}]`
        );
      } catch { await reply('❌ Spotify track not found.'); }
      break;
    }

    // ── Base64 encode/decode ──────────────────────────────
    case 'base64': {
      if (!text) { await reply(`${prefix}base64 <text>`); break; }
      await reply(`📦 *Base64 Encoded:*\n${Buffer.from(text).toString('base64')}`);
      break;
    }

    case 'unbase64': {
      if (!text) { await reply(`${prefix}unbase64 <base64 string>`); break; }
      try {
        const decoded = Buffer.from(text, 'base64').toString('utf8');
        await reply(`📦 *Decoded:*\n${decoded}`);
      } catch { await reply('❌ Invalid base64 string.'); }
      break;
    }

    // ── Whois / number info ──────────────────────────────
    case 'whois': {
      const t = getTargetJid(m, args);
      if (!t) { await reply(`${prefix}whois @mention`); break; }
      try {
        const ppUrl = await sock.profilePictureUrl(t, 'image').catch(() => null);
        const pp = ppUrl ? ppUrl : 'No profile picture';
        const isOnWa = await sock.onWhatsApp(t).catch(() => []);
        const status = isOnWa?.[0]?.exists ? '✅ On WhatsApp' : '❌ Not on WhatsApp';
        const info = `👤 *+${normNum(t)}*\n\n${status}\nPP: ${pp}`;
        if (ppUrl) await replyImg(ppUrl, info);
        else await reply(info);
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // ── Reverse GIF ──────────────────────────────────────
    case 'reversegif': {
      const { qMsg: qMRG, qType: qTRG, qKey: qKRG } = getQuoted(m);
      const gifMsg = m.message?.videoMessage || (qTRG === 'videoMessage' ? qMRG?.videoMessage : null);
      if (!gifMsg) { await reply('Reply to a GIF/video.'); break; }
      await reaction('🔁');
      try {
        const srcKey = m.message?.videoMessage ? m.key : qKRG;
        const buf = await dlMedia({ videoMessage: gifMsg }, srcKey);
        const tmp = `/tmp/rgif_${Date.now()}`;
        fs.writeFileSync(`${tmp}.mp4`, buf);
        await new Promise((res, rej) =>
          exec(`ffmpeg -y -i ${tmp}.mp4 -vf reverse -af areverse ${tmp}_rev.mp4 2>/dev/null`, e => e ? rej(e) : res())
        );
        const revBuf = fs.readFileSync(`${tmp}_rev.mp4`);
        await sock.sendMessage(jid, { video: revBuf, gifPlayback: true, caption: '🔁 Reversed GIF' }, { quoted: qchanel });
        try { fs.unlinkSync(`${tmp}.mp4`); fs.unlinkSync(`${tmp}_rev.mp4`); } catch {}
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // ── Animated text sticker (attp) ─────────────────────
    case 'attp': {
      if (!text) { await reply(`${prefix}attp <text>`); break; }
      await reaction('✨');
      try {
        const { data } = await axios.get(
          `https://api.siputzx.my.id/api/sticker/attp?text=${encodeURIComponent(text)}`,
          { responseType: 'arraybuffer', timeout: 15000 }
        );
        const buf = Buffer.from(data);
        await sock.sendMessage(jid, { sticker: buf }, { quoted: qchanel });
      } catch (e) { await reply('❌ attp failed: ' + e.message); }
      break;
    }

    // ── Emoji mixer ─────────────────────────────────────
    case 'emojimix': {
      if (args.length < 2) { await reply(`${prefix}emojimix <emoji1> <emoji2>\nExample: ${prefix}emojimix 😀 🔥`); break; }
      try {
        const e1 = encodeURIComponent(args[0]);
        const e2 = encodeURIComponent(args[1]);
        const url = `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/${e1}/${e1}_${e2}.png`;
        await replyImg(url, `${args[0]} + ${args[1]}`);
      } catch { await reply('❌ Emoji mix not found.'); }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   SCRIPT / REPO – with 2 open buttons
    // ══════════════════════════════════════════════════════
/*
    case 'script':
    case 'repo': {
      await reaction('🔗');
      const upSec = Math.floor(process.uptime());
      const d = Math.floor(upSec / 86400);
      const h = Math.floor((upSec % 86400) / 3600);
      const mn = Math.floor((upSec % 3600) / 60);
      const s = upSec % 60;
      const runtime = `${d}d ${h}h ${mn}m ${s}s`;

      const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = require('@whiskeysockets/baileys');

      // Try to attach menu image as thumbnail
      const menuImgUrl = c.menuImg || settings.DEFAULT_MENU_IMG;
      let imgField = {};
      if (menuImgUrl) {
        try {
          const imgBuf = await getBuffer(menuImgUrl);
          imgField = await prepareWAMessageMedia({ image: imgBuf }, { upload: sock.waUploadToServer });
        } catch {}
      }

      const repoText = ft(
`╭─ ⌬ 𝗕𝗼𝘁 𝗜𝗻𝗳𝗼 ⌬
│ • Name    : ${c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫'}
│ • Owner   : ${kontributor[0] || botNumber}
│ • Version  : ${settings.BOT_VERSION || '1.0'}
│ • Prefix   : ${prefix}
│ • Runtime  : ${runtime}
╰─────────────`, sock);

      const pairUrl    = settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot';
      const channelUrl = settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1';

      try {
        const msg = await generateWAMessageFromContent(jid, {
          ephemeralMessage: {
            message: {
              messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
              interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body:   proto.Message.InteractiveMessage.Body.fromObject({ text: repoText }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: `© ${settings.CREDITS || 'diego'}` }),
                header: proto.Message.InteractiveMessage.Header.fromObject({
                  title: c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
                  hasMediaAttachment: !!imgField.imageMessage,
                  ...imgField,
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                  buttons: [
                    {
                      name: 'cta_url',
                      buttonParamsJson: JSON.stringify({
                        display_text: '🔗 Pair Bot',
                        url: pairUrl,
                        merchant_url: pairUrl,
                      }),
                    },
                    {
                      name: 'cta_url',
                      buttonParamsJson: JSON.stringify({
                        display_text: '📢 Follow Channel',
                        url: channelUrl,
                        merchant_url: channelUrl,
                      }),
                    },
                  ],
                }),
                contextInfo: {},
              }),
            },
          },
        }, { quoted: qchanel });
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
      } catch {
        // Fallback to plain reply if interactive fails
        await reply(repoText + `\n\n🔗 Pair: ${pairUrl}\n📢 Channel: ${channelUrl}`);
      }
      break;
    }*/

    case 'idch':
    case 'cekidch': {
      const chLink = args[0];
      if (!chLink) { await reply(`Usage: ${prefix}idch <channel link>`); break; }
      if (!chLink.includes('https://whatsapp.com/channel/')) {
        await reply('❌ Must be a valid WhatsApp channel link');
        break;
      }
      try {
        const inviteCode = chLink.split('https://whatsapp.com/channel/')[1];
        const res = await sock.newsletterMetadata('invite', inviteCode);
        const verified = res.verification === 'VERIFIED' ? 'Yes ✅' : 'No ❌';
        const teks = ft(
`📢 *Channel Info*

🆔 ID: ${res.id}
📛 Name: ${res.name}
👥 Followers: ${res.subscribers}
🔘 Status: ${res.state}
✅ Verified: ${verified}`, sock);

        const { generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
        const msg = await generateWAMessageFromContent(jid, {
          viewOnceMessage: {
            message: {
              messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
              interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body:   proto.Message.InteractiveMessage.Body.fromObject({ text: teks }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: 'by 𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫' }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                  buttons: [{
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({ display_text: 'Copy ID', copy_code: res.id }),
                  }],
                }),
              }),
            },
          },
        }, { quoted: qchanel });
        await sock.relayMessage(msg.key.remoteJid, msg.message, { messageId: msg.key.id });
      } catch (e) { await reply('❌ ' + e.message); }
      break;
    }

    // ══════════════════════════════════════════════════════
    //   FUN – EXISTING
    // ══════════════════════════════════════════════════════

    case 'joke': {
      try { const r = await axios.get('https://official-joke-api.appspot.com/random_joke',{timeout:6000}); await reply(`😂 ${r.data.setup}\n\n${r.data.punchline}`); }
      catch { await reply('❌ No jokes.'); }
      break;
    }
    case 'fact': {
      try { const r = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en',{timeout:6000}); await reply(`💡 ${r.data.text}`); }
      catch { await reply('❌ No facts.'); }
      break;
    }
    case 'quote': {
      try { const r = await axios.get('https://zenquotes.io/api/random',{timeout:6000}); await reply(`🌟 "${r.data[0].q}"\n– ${r.data[0].a}`); }
      catch { await reply('❌ No quotes.'); }
      break;
    }
    case 'dare': {
      const d=['Tell your most embarrassing secret.','Do 20 push-ups now.','Text your crush right now.','Sing a song aloud.','Change your status to something silly for 1hr.','Send a voice note of you barking.','Do your best celebrity impression.'];
      await reply(`🔥 Dare: ${d[Math.floor(Math.random()*d.length)]}`);
      break;
    }
    case 'truth': {
      const t2=['Whats your biggest regret?','Have you ever lied to your best friend?','What is your guilty pleasure?','Who is your secret crush?','What embarrassing thing have you done?','What is a secret you have never told anyone?','Who do you secretly dislike in this group?'];
      await reply(`💬 Truth: ${t2[Math.floor(Math.random()*t2.length)]}`);
      break;
    }
    case 'riddle': {
      const r=[{q:'What has keys but no locks?',a:'A keyboard'},{q:'What gets wetter as it dries?',a:'A towel'},{q:'I speak without a mouth. What am I?',a:'An echo'},{q:'The more you take the more you leave behind.',a:'Footsteps'},{q:'What has hands but cant clap?',a:'A clock'},{q:'I have cities, but no houses live there.',a:'A map'}];
      const pick=r[Math.floor(Math.random()*r.length)];
      await reply(`🧩 *Riddle:* ${pick.q}\n\n_Answer: ${pick.a}_`);
      break;
    }
    case 'roast': {
      const r=['You are the human equivalent of a participation trophy.','If brains were gas, you would not have enough to power an ants motorcycle.','You are not stupid; you just have bad luck thinking.','You bring everyone so much joy when you leave the room.','You are proof that evolution can go in reverse.'];
      const t2=getTargetJid(m,args); const name=t2?`@${normNum(t2)}`:'you'; const mentions=t2?[t2]:[];
      await sock.sendMessage(jid,{text:ft(`🔥 ${r[Math.floor(Math.random()*r.length)].replace('You',name)}`,sock),mentions},{quoted:qchanel});
      break;
    }
    case 'ship': {
      const t1=sender; const t2=getTargetJid(m,args);
      const pct=Math.floor(Math.random()*101); const bar='█'.repeat(Math.floor(pct/10))+'░'.repeat(10-Math.floor(pct/10));
      await reply(`💘 Ship Meter\n\n@${normNum(t1)} ❤️ ${t2?'@'+normNum(t2):'???'}\n\n[${bar}] ${pct}%`);
      break;
    }
    case 'coinflip': { await reply(`🪙 ${Math.random()>0.5?'Heads!':'Tails!'}`); break; }
    case 'dice': { const sides=parseInt(args[0])||6; await reply(`🎲 d${sides}: *${Math.floor(Math.random()*sides)+1}*`); break; }
    case 'magic8': {
      const a=['Yes, definitely!','Without a doubt.','Outlook good.','My sources say no.','Cannot predict now.','Don\'t count on it.','Signs point to yes.','Very doubtful.','It is certain.','Ask again later.'];
      await reply(`🎱 ${a[Math.floor(Math.random()*a.length)]}`);
      break;
    }
    case 'horoscope': {
      const signs=['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
      const sign=args[0]?.toLowerCase();
      if(!signs.includes(sign)){await reply(`${prefix}horoscope <sign>\nSigns: ${signs.join(', ')}`);break;}
      try{const r=await axios.post(`https://aztro.sameerkumar.website/?sign=${sign}&day=today`,{},{timeout:8000});await reply(`⭐ *${sign.toUpperCase()}*\n\n${r.data.description}\n\n🍀 Lucky # ${r.data.lucky_number}\n💜 Mood: ${r.data.mood}`);}
      catch{await reply('❌ Failed.');}
      break;
    }
    case 'meme': {
      try{const r=await axios.get('https://meme-api.com/gimme',{timeout:8000});await replyImg(r.data.url,`😂 ${r.data.title}`);}
      catch{await reply('❌ No memes.');}
      break;
    }
    case 'cat': {
      try{const r=await axios.get('https://api.thecatapi.com/v1/images/search',{timeout:8000});await replyImg(r.data[0].url,'🐱 Meow!');}
      catch{await reply('❌ No cats.');}
      break;
    }
    case 'dog': {
      try{const r=await axios.get('https://dog.ceo/api/breeds/image/random',{timeout:8000});await replyImg(r.data.message,'🐶 Woof!');}
      catch{await reply('❌ No dogs.');}
      break;
    }
    case 'waifu': {
      try{const r=await axios.get('https://api.waifu.pics/sfw/waifu',{timeout:8000});await replyImg(r.data.url,'🌸 Waifu!');}
      catch{await reply('❌ No waifu.');}
      break;
    }
    case 'anime': {
      try{const r=await axios.get('https://api.jikan.moe/v4/random/anime',{timeout:8000});const a=r.data.data;await replyImg(a.images?.jpg?.image_url,`🎌 *${a.title}*\nEpisodes: ${a.episodes||'?'}\nScore: ${a.score||'?'}\n${(a.synopsis||'').slice(0,200)}`);}
      catch{await reply('❌ Failed.');}
      break;
    }
    case 'trivia': {
      try{
        const r=await axios.get('https://opentdb.com/api.php?amount=1&type=multiple',{timeout:8000});
        const q=r.data.results[0];
        const ans=[...q.incorrect_answers,q.correct_answer].sort(()=>Math.random()-0.5);
        await reply(`❓ *${q.question.replace(/&quot;/g,'"').replace(/&#039;/g,"'")}*\n\n${ans.map((a,i)=>`${i+1}. ${a}`).join('\n')}\n\n_Answer: ${q.correct_answer}_`);
      }catch{await reply('❌ No trivia.');}
      break;
    }
    case 'compliment': {
      const c2=['You are absolutely brilliant!','Your smile brightens everyone\'s day.','You are stronger than you think.','Your kindness is rare and beautiful.','You make the world a better place!','You have an amazing energy!'];
      const t2=getTargetJid(m,args); const name=t2?`@${normNum(t2)}`:'you'; const mentions=t2?[t2]:[];
      await sock.sendMessage(jid,{text:ft(`💐 ${c2[Math.floor(Math.random()*c2.length)].replace('You',name)}`,sock),mentions},{quoted:qchanel});
      break;
    }
    case 'bored': {
      try{const r=await axios.get('https://www.boredapi.com/api/activity/',{timeout:6000});await reply(`🎯 ${r.data.activity}\nType: ${r.data.type} | Participants: ${r.data.participants}`);}
      catch{await reply('❌ Failed.');}
      break;
    }

    // ── NEW FUN COMMANDS ──────────────────────────────────

    // Rock Paper Scissors
    case 'rps': {
      const choices = ['🪨 Rock','📄 Paper','✂️ Scissors'];
      const valid = ['rock','paper','scissors','r','p','s'];
      const map = {r:'rock',p:'paper',s:'scissors'};
      const raw = args[0]?.toLowerCase();
      const pick = map[raw] || raw;
      if (!['rock','paper','scissors'].includes(pick)) {
        await reply(`${prefix}rps rock/paper/scissors`); break;
      }
      const botPick = ['rock','paper','scissors'][Math.floor(Math.random()*3)];
      const wins = {rock:'scissors',paper:'rock',scissors:'paper'};
      const result = pick === botPick ? '🤝 Draw!' : wins[pick] === botPick ? '🏆 You win!' : '😈 Bot wins!';
      await reply(`Your choice: ${pick}\nBot choice: ${botPick}\n\n${result}`);
      break;
    }

    // Math quiz
    case 'math': {
      const ops = ['+','-','×'];
      const op = ops[Math.floor(Math.random()*ops.length)];
      const a2 = Math.floor(Math.random()*50)+1;
      const b2 = Math.floor(Math.random()*50)+1;
      const ans2 = op==='+' ? a2+b2 : op==='-' ? a2-b2 : a2*b2;
      if (!text) {
        const mathQ = readJSON(DB('mathq.json'), {});
        mathQ[jid] = { ans: ans2, ts: Date.now() };
        writeJSON(DB('mathq.json'), mathQ);
        await reply(`🧮 Quick Math!\n\n*${a2} ${op} ${b2} = ?*\n\nReply with the answer (30s to answer)`);
        break;
      }
      // Check answer
      const mathQ = readJSON(DB('mathq.json'), {});
      const q2 = mathQ[jid];
      if (!q2 || Date.now() - q2.ts > 30000) { await reply('❌ No active math question or time expired.'); break; }
      const userAns = parseInt(text.trim());
      if (userAns === q2.ans) {
        delete mathQ[jid];
        writeJSON(DB('mathq.json'), mathQ);
        await reply(`✅ Correct! The answer was *${q2.ans}* 🎉`);
      } else {
        await reply(`❌ Wrong! The correct answer was *${q2.ans}*`);
      }
      break;
    }

    // Never have I ever
    case 'neverhaveiever': {
      const nhi=[
        'Never have I ever lied to get out of trouble.',
        'Never have I ever eaten food off the floor.',
        'Never have I ever googled myself.',
        'Never have I ever faked being sick.',
        'Never have I ever cried at a movie.',
        'Never have I ever broken a bone.',
        'Never have I ever stayed awake for 24+ hours.',
      ];
      await reply(`🙈 ${nhi[Math.floor(Math.random()*nhi.length)]}\n\n_React 🖐 if you HAVE, 👇 if you HAVEN'T_`);
      break;
    }

    // Would you rather
    case 'wouldyourather': {
      const wyr=[
        ['be able to fly','be invisible'],
        ['speak every language','play every instrument'],
        ['have no internet for a month','no phone for a month'],
        ['always be hot','always be cold'],
        ['know the future','change the past'],
        ['be famous for a day','be unknown forever'],
      ];
      const pick2 = wyr[Math.floor(Math.random()*wyr.length)];
      await reply(`🤔 *Would you rather...*\n\n🅰️ ${pick2[0]}\n\n— OR —\n\n🅱️ ${pick2[1]}\n\n_Reply A or B!_`);
      break;
    }

    // ══════════════════════════════════════════════════════
    //   CREDITS – multi-card developer carousel
    // ══════════════════════════════════════════════════════
   /* case 'credits':
    case 'diego': {
      await reaction('🌟');
      try {
        const {
          generateWAMessageFromContent,
          prepareWAMessageMedia,
          proto,
        } = require('@whiskeysockets/baileys');

        // ── Helper: download + upload image for a card header ──
        const makeImgField = async (url) => {
          try {
            const buf = await getBuffer(url);
            return await prepareWAMessageMedia({ image: buf }, { upload: sock.waUploadToServer });
          } catch { return {}; }
        };

        // ── Card definitions ──
        // Each card: { img, title, body, buttons[] }
        const cardDefs = [
          {
            img:   'https://files.catbox.moe/p304v8.jpg',
            title: '𝑻𝑰𝑻𝑨𝑵',
            body: [
              '• horny dev',
              '• married',
              '• rude',
              '• arrested for being sexy',
              '• JavaScript coder',
              '• efootball player',
              '• chelsea fan',
              '• UoN student',
              '• Proud Luo',
            ].join('\n'),
            buttons: [
              { display_text: '📱 WhatsApp',    url: 'https://wa.me/254716951223' },
              { display_text: '✈️ Telegram',    url: 'https://t.me/lorddiego08' },
              { display_text: '📢 TG Channel',  url: 'https://t.me/+jh4yhoD_XQs2MThk' },
              { display_text: '📣 WA Channel',  url: '' },
            ],
          },
          {
            img:   'https://t.me/diegochannel1',
            title: 'sir munyao',
            body: [
              '• fullstack developer',
              '• anime creator',
              '• proud kamba',
              '• Naxeex games player',
              '• mini militia player',
            ].join('\n'),
            buttons: [
              { display_text: '📱 WhatsApp',   url: `https://wa.me/${kontributor[0] || settings.SUDO_NUMBER || '254716 951223'}` },
              { display_text: '✈️ Telegram',   url: 'https://lorddiego08' },
              { display_text: '📢 TG Channel', url: 'https://t.me/diegochannel1' },
              { display_text: '👥 TG Group',   url: 'https://t.me/lorddiego08' },
            ],
          },
          {
            img:   'https://files.catbox.moe/p304v8.jpg',
            title: '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
            body: [
              `• Powered by @whiskeysockets/baileys`,
              `• Version: ${settings.BOT_VERSION || '1.0'}`,
              `• Prefix: ${prefix}`,
              `• Library: Node.js`,
              `• Company: ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}`,
              `• Made with ❤️ by the team`,
            ].join('\n'),
            buttons: [
              { display_text: '🔗 Pair Bot',      url: settings.REQUIRED_PAIR_LINK    || 'http://t.me/titandiego_bot' },
              { display_text: '📢 Follow Channel', url: settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1' },
              { display_text: '👥 Support Group',  url: settings.REQUIRED_GROUP_LINK   || 'https://t.me/teleempirepentagon' },
            ],
          },
          {
            img:   'https://files.catbox.moe/p304v8.jpg',
            title: '*X factor ᴅᴇᴠ* ',
            body: [
              '• ғᴏᴜɴᴅᴇʀ ᴏғ x factor ᴛᴇᴄʜ',
              '• ʙᴀʀᴄᴀ ғᴀɴ',
              '• ʙᴏᴛ ᴅᴇᴠ',
              '• ᴄᴜᴛᴇsᴛ 😂😂',
            ].join('\n'),
            buttons: [
              { display_text: '📱 WhatsApp', url: 'https://wa.me/254705004770' },
              { display_text: '✈️ Telegram', url: 't.me/xfactoedevis' },
         { display_text: '✈️ Whatsapp channel', url: '' },
            ],
          },
{
            img:   'https://files.catbox.moe/p304v8.jpg',
            title: 'LORD DIEGO DENNIS',
            body: [
              '• NOX HOSTING ☁️ | founder',
              '• PRIMEEE TECH | owner',
              '• BOT/SITE WEB developer',
              '• JUST A CHILL BOY 💳',
            ].join('\n'),
            buttons:  [
              { display_text: 'FREEPANEL BOT', url: '' },
              { display_text: 'CHANNEL', url: '' },
            
            { display_text: ' WhatsApp CONTACT', url: 'https://wa.me/254769332095' },
              { display_text: '✈️ TG-CONTACT', url: 'https://t.me/botempire_wa' },
            ],
          },
          {
            img:   'https://files.catbox.moe/p304v8.jpg',
            title: 'black lord',
            body: [
              '• Next.js pro',
              '• samsung bot owner',
              '• proud kenyan',
              '• Single But married',
              '• Bugger mpole',
            ].join('\n'),
            buttons: [
              { display_text: '📱 WhatsApp',   url: `https://wa.me/${kontributor[0] || settings.SUDO_NUMBER || '254700303658'}` },
              { display_text: '✈️ Telegram',   url: 'https://t.me/lorddiego08' },
              { display_text: '📢 TG Channel', url: 'https://t.me/diegochannel1' },
              { display_text: '👥 TG Group',   url: 'https://t.me/blacklord' },
            ],
          },
          
        ];

        // ── Build all card image fields in parallel ──
        const imgFields = await Promise.all(cardDefs.map(cd => makeImgField(cd.img)));

        // ── Build proto cards ──
        const cards = cardDefs.map((cd, i) => ({
          header: proto.Message.InteractiveMessage.Header.fromObject({
            title: cd.title,
            hasMediaAttachment: !!imgFields[i]?.imageMessage,
            ...(imgFields[i] || {}),
          }),
          body: proto.Message.InteractiveMessage.Body.fromObject({ text: cd.body }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
            buttons: cd.buttons.map(b => ({
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({ display_text: b.display_text, url: b.url, merchant_url: b.url }),
            })),
          }),
        }));

        const creditMsg = await generateWAMessageFromContent(jid, {
          ephemeralMessage: {
            message: {
              messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
              interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                body:    proto.Message.InteractiveMessage.Body.fromObject({ text: ` *${c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫'} — Developer Credits*` }),
                footer:  proto.Message.InteractiveMessage.Footer.fromObject({ text: `© ${settings.CREDITS || 'diego'} • ${settings.COMPANY || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫 Projects'}` }),
                header:  proto.Message.InteractiveMessage.Header.fromObject({ title: '', hasMediaAttachment: false }),
                contextInfo: {},
                carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({ cards }),
              }),
            },
          },
        }, { quoted: qchanel });

        await sock.relayMessage(jid, creditMsg.message, { messageId: creditMsg.key.id });
      } catch (e) {
        // plain fallback
        await reply(
          `🌟 *${c.botName || settings.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫'} — Credits*\n\n` +
          `👨‍💻 *x factor* — JavaScript dev, ku student, Proud Luo\n` +
          `👨‍💻 *lord diego* — Fullstack dev, titan anime md creator, Proud kamba\n\n` +
          `📢 Channel: ${settings.REQUIRED_CHANNEL_LINK || 'https://t.me/diegochannel1'}\n` +
          `🔗 Pair: ${settings.REQUIRED_PAIR_LINK || 'http://t.me/titandiego_bot'}`
        );
      }
      break;
    }
*/
    default: {
      const h = { reply, replyImg, ft, cfg, dlMedia, reaction, normNum, getQuoted, isOwner: _isOwner };
      if (await reactionHandler(sock, m, cmd, args, h)) break;
      if (await scrapsHandler(sock, m, cmd, args, h))   break;
      if (await illusionHandler(sock, m, cmd, args, h)) break;
      if (await socialHandler(sock, m, cmd, args, h))   break;
      if (await aiHandler(sock, m, cmd, args, h))       break;
      if (await economyHandler(sock, m, cmd, args, h))  break;
      if (await toolsHandler(sock, m, cmd, args, h))    break;
      if (await stickerHandler(sock, m, cmd, args, h))  break;
      if (await musicHandler(sock, m, cmd, args, h))    break;
      if (await gamesHandler(sock, m, cmd, args, h))    break;
      if (await adminHandler(sock, m, cmd, args, h))    break;
      if (await arabicHandler(sock, m, cmd, args, h))   break;
      await devHandler(sock, m, cmd, args, h);
      break;
    }
  }
}

module.exports = { handleMessage, runAutoFollow, CMDS };
