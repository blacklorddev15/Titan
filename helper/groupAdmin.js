// ============================================================
//   helper/groupAdmin.js – reliable WhatsApp admin/owner identity helpers
// ============================================================
'use strict';

let chalk;
try {
  chalk = require('chalk');
} catch {
  const plain = (value) => String(value);
  chalk = { cyan: plain, gray: plain, yellow: plain, green: plain, red: plain };
}

/**
 * Normalize a WhatsApp JID or phone-like value to digits.
 * Device suffixes and domains are removed, while LID values remain
 * matchable through their exact base identity when no phone alias exists.
 */
function normNum(value) {
  if (!value) return '';
  const s = String(value).trim();
  const noDomain = s.includes('@') ? s.split('@')[0] : s;
  const noDevice = noDomain.includes(':') ? noDomain.split(':')[0] : noDomain;
  return noDevice.replace(/\D/g, '');
}

function identityKeys(...values) {
  const keys = new Set();
  for (const value of values.flat(Infinity)) {
    if (value === undefined || value === null || value === '') continue;
    const raw = String(value).trim().toLowerCase();
    if (!raw) continue;

    const at = raw.indexOf('@');
    const domain = at >= 0 ? raw.slice(at + 1).split(':')[0] : '';
    const base = (at >= 0 ? raw.slice(0, at) : raw).split(':')[0];
    if (!base) continue;

    // Exact base/domain identity handles WhatsApp LIDs and normal JIDs.
    keys.add(`base:${base}`);
    if (domain) keys.add(`jid:${base}@${domain}`);

    // Phone aliases and device-qualified JIDs converge here.
    const digits = base.replace(/\D/g, '');
    if (digits) keys.add(`num:${digits}`);
  }
  return keys;
}

function keysIntersect(left, right) {
  for (const key of left) if (right.has(key)) return true;
  return false;
}

function identitiesMatch(leftValues, rightValues) {
  const left = identityKeys(...(Array.isArray(leftValues) ? leftValues : [leftValues]));
  const right = identityKeys(...(Array.isArray(rightValues) ? rightValues : [rightValues]));
  return keysIntersect(left, right);
}

function participantValues(participant) {
  if (!participant) return [];
  return [
    participant.id,
    participant.jid,
    participant.lid,
    participant.pn,
    participant.phoneNumber,
    participant.phone,
  ].filter(Boolean);
}

function senderValues(message) {
  const key = message?.key || {};
  return [
    key.participant,
    key.participantAlt,
    key.senderPn,
    key.senderLid,
    message?.participant,
    message?.sender,
  ].filter(Boolean);
}

function botValues(sock) {
  const user = sock?.user || {};
  return [user.id, user.jid, user.lid, user.pn, user.phoneNumber].filter(Boolean);
}

/**
 * Fetch group admin data. A metadata override avoids a second metadata call
 * when the command handler has already loaded the group participants.
 */
async function getGroupAdminInfo(sock, groupJid, debug = false, metadataOverride = null) {
  try {
    const meta = metadataOverride || await sock.groupMetadata(groupJid);
    const admins = new Set();
    const superAdmins = new Set();
    const adminKeys = new Set();
    const superAdminKeys = new Set();

    for (const participant of meta?.participants || []) {
      const values = participantValues(participant);
      const keys = identityKeys(...values);
      const num = normNum(values[0]);

      const isAdminFlag = participant.admin === 'admin' || participant.admin === 'superadmin' || participant.admin === 'owner' || participant.admin === true || participant.admin === 'true' || participant.isAdmin;
      const isSuperAdminFlag = participant.admin === 'superadmin' || participant.admin === 'owner' || participant.isSuperAdmin;

      if (isSuperAdminFlag) {
        if (num) superAdmins.add(num);
        for (const key of keys) superAdminKeys.add(key);
        for (const key of keys) adminKeys.add(key);
      } else if (isAdminFlag) {
        if (num) admins.add(num);
        for (const key of keys) adminKeys.add(key);
      }
    }

    for (const key of superAdminKeys) adminKeys.add(key);
    for (const num of superAdmins) admins.add(num);

    const botIsAdmin = keysIntersect(identityKeys(...botValues(sock)), adminKeys);

    if (debug) {
      console.log(chalk.cyan('  [ADMIN DEBUG]'));
      console.log(chalk.gray('  bot identities: ') + chalk.yellow(botValues(sock).join(', ')));
      console.log(chalk.gray('  botIsAdmin    : ') + (botIsAdmin ? chalk.green('YES') : chalk.red('NO')));
      console.log(chalk.gray('  admins        : ') + chalk.yellow([...admins].join(', ')));
    }

    return { admins, superAdmins, adminKeys, superAdminKeys, botIsAdmin, meta };
  } catch (error) {
    if (debug) console.log(chalk.red('  [ADMIN DEBUG] getGroupAdminInfo failed: ' + error.message));
    return {
      admins: new Set(),
      superAdmins: new Set(),
      adminKeys: new Set(),
      superAdminKeys: new Set(),
      botIsAdmin: false,
      meta: null,
    };
  }
}

/**
 * Attach reusable sender/bot admin flags to a message. This is kept for
 * adapters and listeners that need the same decision outside case.js.
 */
async function enrichWithAdminStatus(sock, message, metadataOverride = null) {
  message.__senderIsAdmin = false;
  message.__botIsAdmin = false;
  message.__senderNum = normNum(senderValues(message)[0]);

  if (!message.key?.remoteJid?.endsWith('@g.us')) return message;

  const debug = process.env.ADMIN_DEBUG === '1';
  const info = await getGroupAdminInfo(sock, message.key.remoteJid, debug, metadataOverride);
  message.__senderIsAdmin = keysIntersect(identityKeys(...senderValues(message)), info.adminKeys);
  message.__botIsAdmin = info.botIsAdmin;

  if (debug) {
    console.log(chalk.gray('  sender identities: ') + chalk.yellow(senderValues(message).join(', ')));
    console.log(chalk.gray('  senderAdmin     : ') + (message.__senderIsAdmin ? chalk.green('YES') : chalk.red('NO')));
    console.log(chalk.gray('  botAdmin        : ') + (message.__botIsAdmin ? chalk.green('YES') : chalk.red('NO')));
  }

  return message;
}

/** Resolve target JID from quoted reply, mention, or number argument. */
function getTargetJid(message, args) {
  const context = message.message?.extendedTextMessage?.contextInfo;
  const quotedParticipant = context?.participant;
  if (quotedParticipant && !quotedParticipant.endsWith('@g.us')) return quotedParticipant;

  const mentions = context?.mentionedJid;
  if (mentions?.length) return mentions[0];

  const number = String(args?.[0] || '').replace(/\D/g, '');
  if (number.length >= 7) return `${number}@s.whatsapp.net`;
  return null;
}

module.exports = {
  normNum,
  identityKeys,
  identitiesMatch,
  keysIntersect,
  getGroupAdminInfo,
  enrichWithAdminStatus,
  getTargetJid,
};
