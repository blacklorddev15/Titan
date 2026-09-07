'use strict';
require('dotenv').config();

// Neon fallback: lets the bot use the shared database even without a .env line.
// Prefer setting DATABASE_URL in .env if this repo is public/shared.
if (!process.env.DATABASE_URL && !process.env.NEON_DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://neondb_owner:npg_yX9BFNn4zLpA@ep-aged-dew-axj88swi-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
}

module.exports = {
  DATABASE_URL:       process.env.DATABASE_URL,
  TELEGRAM_TOKEN:     process.env.TELEGRAM_TOKEN    || '',
  OWNER_TELEGRAM_ID:  process.env.OWNER_TELEGRAM_ID || '7567336073',
  OWNER_NAME:         process.env.OWNER_NAME        || 'diego',
  SUDO_NUMBER:        process.env.SUDO_NUMBER       || '254716951223', // extra owner WA number
GITHUB_TOKEN:    process.env.GITHUB_TOKEN || '',
GITHUB_USERNAME: 'diegdevoff',
GITHUB_REPO:     'database',
GITHUB_BRANCH:   'main',
PANEL_URL:       '',   // your Pterodactyl URL for ping
WEBSITE_URL:     '',   // your Render/Vercel URL for ping
  BOT_NAME:    process.env.BOT_NAME || '𝑻𝑰𝑻𝑨𝑵 𝑨𝑵𝑰𝑴𝑬 𝑴𝑫',
  BOT_VERSION: '4.0.0',
  COMPANY:     'diego Incorporative',
  CREDITS:     'diego',

  SESSION_DIR:      './sessions',
  DEFAULT_PREFIX:   '.',
  DEFAULT_MENU_IMG: process.env.MENU_IMG || 'https://i.ibb.co/8grSmvMS/photo-2026-07-27-18-33-24-7667499810093531164.jpg',

  REQUIRED_CHANNEL:      process.env.REQUIRED_CHANNEL      || '@diegochannel1',
  REQUIRED_GROUP:        process.env.REQUIRED_GROUP        || '@teleempirepentagon',
  REQUIRED_CHANNEL_LINK: process.env.REQUIRED_CHANNEL_LINK || '',
  REQUIRED_GROUP_LINK:   process.env.REQUIRED_GROUP_LINK   || '',
  REQUIRED_CHANNEL_ID:   process.env.REQUIRED_CHANNEL_ID   || '',
  REQUIRED_GROUP_ID:     process.env.REQUIRED_GROUP_ID     || '120363411194234474@g.us',

  AUTO_FOLLOW_NEWSLETTERS: [
  '120363407789086360@newsletter',

  ], // add as many as you want
  AUTO_JOIN_GROUPS:        [], // add as many as you want
};
