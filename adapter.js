'use strict';

const botDir = __dirname;
global.__ROOT__ = botDir;
global.__CORE__ = botDir;

const { handleMessage, runAutoFollow } = require('./case');
const listeners = require('./helper/listeners');

async function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  global.__ROOT__ = botDir;
  global.__CORE__ = botDir;
  try {
    return await fn(...args);
  } catch (error) {
    console.error(`[TITAN-MD] Error: ${error.message}`);
  }
}

module.exports = {
  async initialize(sock) {
    return safeCall(listeners.handleAntiCall, sock);
  },
  async checkAntilink(sock, message) {
    return safeCall(listeners.checkAntilink, sock, message);
  },
  async checkAntiMedia(sock, message) {
    return safeCall(listeners.checkAntiMedia, sock, message);
  },
  async handleMessage(sock, message, chatMeta) {
    return safeCall(handleMessage, sock, message, chatMeta);
  },
  async handleAntiDelete(sock, message) {
    return safeCall(listeners.handleAntiDelete, sock, message);
  },
  async handleGroupParticipantsUpdate(sock, update) {
    return safeCall(listeners.handleGroupParticipantsUpdate, sock, update);
  },
  async handleAntiCall(sock, call) {
    return safeCall(listeners.handleAntiCall, sock, call);
  },
  runAutoFollow: (sock) => safeCall(runAutoFollow, sock),
};
