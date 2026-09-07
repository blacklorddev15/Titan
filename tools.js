// ============================================================
//   tools.js  –  30+ Utility Tool Commands
// ============================================================
'use strict';
const axios = require('axios');
const crypto = require('crypto');

const TOOLS_CMDS = [
  'calculator','bmi','age','timezone','worldtime','countdown','reminder',
  'color2','gradient','palette','fontlist','emoji','emojisearch',
  'qrgenerator','barcode','readqr','vcard',
  'unitconvert','tempconvert','dataconvert','speedconvert',
  'ip2','myip','ping2','traceroute',
  'wordcount','charcount','linecount','diff',
  'jsonformat','csvparse','tableify','markdownpreview',
];

async function toolsHandler(sock, m, cmd, args, helpers) {
  if (!TOOLS_CMDS.includes(cmd)) return false;
  const { reply, ft, cfg } = helpers;
  const jid    = m.key.remoteJid;
  const prefix = cfg(sock).prefix || '.';
  const text   = args.join(' ');

  switch(cmd) {

    case 'calculator': {
      if (!text) { await reply(`🧮 *${prefix}calculator 2+2*5`); break; }
      try {
        const safe = text.replace(/[^0-9+\-*/.()%\s]/g,'');
        // eslint-disable-next-line no-new-func
        const res  = Function('"use strict"; return (' + safe + ')')();
        await reply(ft(`🧮 *Calculator*\n\n${text} = *${res}*`, sock));
      } catch { await reply(`❌ Invalid expression`); }
      break;
    }

    case 'bmi': {
      const parts = text.split(/\s+/);
      const weight = parseFloat(parts[0]);
      const height = parseFloat(parts[1]);
      if (!weight||!height) { await reply(`⚖️ *${prefix}bmi <weight_kg> <height_cm>*\nExample: ${prefix}bmi 70 175`); break; }
      const bmi    = weight / Math.pow(height/100, 2);
      const cat    = bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese';
      await reply(ft(`⚖️ *BMI Calculator*\n\nWeight: ${weight}kg | Height: ${height}cm\nBMI: *${bmi.toFixed(1)}*\nCategory: *${cat}*`, sock));
      break;
    }

    case 'age': {
      if (!text) { await reply(`🎂 *${prefix}age DD/MM/YYYY*`); break; }
      const [d,mo,y] = text.split('/').map(Number);
      const dob  = new Date(y, mo-1, d);
      const now  = new Date();
      const age  = Math.floor((now-dob) / (365.25*24*60*60*1000));
      const next = new Date(now.getFullYear(), mo-1, d);
      if (next < now) next.setFullYear(next.getFullYear()+1);
      const days = Math.ceil((next-now)/(24*60*60*1000));
      await reply(ft(`🎂 *Age Calculator*\n\nAge: *${age} years*\nNext birthday: in ${days} days`, sock));
      break;
    }

    case 'timezone': {
      if (!text) { await reply(`🌍 *${prefix}timezone <city or timezone>*`); break; }
      try {
        const { data } = await axios.get(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(text.replace(' ','_'))}`, { timeout:8000 });
        const dt = new Date(data.datetime);
        await reply(ft(`🌍 *${text}*\n\n🕐 ${dt.toLocaleTimeString()}\n📅 ${dt.toLocaleDateString()}\n⏰ UTC${data.utc_offset}`, sock));
      } catch { await reply(`❌ Timezone not found. Try: Africa/Nairobi, Asia/Tokyo`); }
      break;
    }

    case 'worldtime': {
      const zones = ['America/New_York','Europe/London','Asia/Tokyo','Africa/Nairobi','Australia/Sydney','Asia/Dubai'];
      const times = zones.map(z => {
        try {
          const t = new Date().toLocaleTimeString('en-US', { timeZone:z, hour:'2-digit', minute:'2-digit' });
          return `🌍 ${z.split('/')[1].replace('_',' ')}: ${t}`;
        } catch { return ''; }
      }).filter(Boolean);
      await reply(ft(`🕐 *World Clock*\n\n${times.join('\n')}`, sock));
      break;
    }

    case 'unitconvert': {
      // .unitconvert 100 km miles
      const parts2 = text.split(/\s+/);
      const val = parseFloat(parts2[0]);
      const from = parts2[1]?.toLowerCase();
      const to   = parts2[2]?.toLowerCase();
      if (!val||!from||!to) { await reply(`📏 *${prefix}unitconvert <value> <from> <to>*\nExample: ${prefix}unitconvert 100 km miles`); break; }
      const conversions = {
        'km-miles':0.621371,'miles-km':1.60934,'m-ft':3.28084,'ft-m':0.3048,
        'kg-lbs':2.20462,'lbs-kg':0.453592,'l-gal':0.264172,'gal-l':3.78541,
        'cm-inch':0.393701,'inch-cm':2.54,'m-yards':1.09361,'yards-m':0.9144,
      };
      const key    = `${from}-${to}`;
      const factor = conversions[key];
      if (!factor) { await reply(`❌ Conversion ${from} → ${to} not supported.`); break; }
      await reply(ft(`📏 *Unit Converter*\n\n${val} ${from} = *${(val*factor).toFixed(4)} ${to}*`, sock));
      break;
    }

    case 'tempconvert': {
      const parts3 = text.split(/\s+/);
      const val2 = parseFloat(parts3[0]);
      const from2 = parts3[1]?.toLowerCase();
      const to2   = parts3[2]?.toLowerCase();
      if (isNaN(val2)||!from2||!to2) { await reply(`🌡️ *${prefix}tempconvert <value> <C/F/K> <C/F/K>*`); break; }
      let celsius;
      if (from2==='c') celsius=val2;
      else if (from2==='f') celsius=(val2-32)*5/9;
      else if (from2==='k') celsius=val2-273.15;
      else { await reply(`❌ Unknown unit ${from2}`); break; }
      let result3;
      if (to2==='c') result3=celsius;
      else if (to2==='f') result3=celsius*9/5+32;
      else if (to2==='k') result3=celsius+273.15;
      else { await reply(`❌ Unknown unit ${to2}`); break; }
      await reply(ft(`🌡️ ${val2}°${from2.toUpperCase()} = *${result3.toFixed(2)}°${to2.toUpperCase()}*`, sock));
      break;
    }

    case 'color2': {
      if (!text) { await reply(`🎨 *${prefix}color2 <hex or name>*\nExample: ${prefix}color2 #ff5733`); break; }
      const hex = text.startsWith('#') ? text : '#'+text;
      try {
        const { data } = await axios.get(`https://www.thecolorapi.com/id?hex=${hex.replace('#','')}`, { timeout:8000 });
        await reply(ft(
          `🎨 *Color Info*\n\n` +
          `Hex: ${data.hex?.value}\n` +
          `RGB: ${data.rgb?.value}\n` +
          `HSL: ${data.hsl?.value}\n` +
          `Name: ${data.name?.value}`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'emoji': {
      if (!text) { await reply(`😀 *${prefix}emoji <emoji>*\nGet info about any emoji.`); break; }
      const cp = text.codePointAt(0)?.toString(16).toUpperCase().padStart(4,'0');
      await reply(ft(`😀 *Emoji Info*\n\nEmoji: ${text}\nCodepoint: U+${cp}\nUnicode name: Check unicode.org/charts`, sock));
      break;
    }

    case 'emojisearch': {
      if (!text) { await reply(`🔍 *${prefix}emojisearch <keyword>*`); break; }
      try {
        const { data } = await axios.get(`https://emoji-api.com/emojis?search=${encodeURIComponent(text)}&access_key=free`, { timeout:8000 });
        const list2 = (Array.isArray(data)?data:[]).slice(0,10).map(e=>`${e.character} ${e.unicodeName}`).join('\n');
        await reply(ft(`🔍 *Emojis for "${text}"*\n\n${list2||'None found'}`, sock));
      } catch { await reply(`❌ Emoji search failed`); }
      break;
    }

    case 'qrgenerator': {
      if (!text) { await reply(`📱 *${prefix}qrgenerator <text or URL>*`); break; }
      const url3 = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
      await sock.sendMessage(jid, { image: { url: url3 }, caption: ft(`📱 QR Code: ${text}`, sock) }, { quoted: m });
      break;
    }

    case 'vcard': {
      // .vcard Name | Phone | Email
      const parts4 = text.split('|').map(s=>s.trim());
      if (parts4.length < 2) { await reply(`👤 *${prefix}vcard Name | Phone | Email (optional)*`); break; }
      const [vName, vPhone, vEmail] = parts4;
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${vName}\nTEL;type=CELL:${vPhone}${vEmail?`\nEMAIL:${vEmail}`:''}\nEND:VCARD`;
      await sock.sendMessage(jid, {
        contacts: { displayName: vName, contacts: [{ vcard }] },
      }, { quoted: m });
      break;
    }

    case 'ip2': {
      const ip = args[0];
      if (!ip) { await reply(`🌐 *${prefix}ip2 <IP address>*`); break; }
      try {
        const { data } = await axios.get(`https://ipwho.is/${ip}`, { timeout:8000 });
        await reply(ft(
          `🌐 *IP Info: ${ip}*\n\n` +
          `📍 ${data.city}, ${data.region}, ${data.country}\n` +
          `🏢 ISP: ${data.connection?.isp||'N/A'}\n` +
          `🕐 Timezone: ${data.timezone?.id||'N/A'}\n` +
          `📡 Type: ${data.type||'N/A'}`,
          sock
        ));
      } catch (e) { await reply(`❌ ${e.message}`); }
      break;
    }

    case 'myip': {
      try {
        const { data } = await axios.get('https://api.ipify.org?format=json', { timeout:5000 });
        await reply(ft(`🌐 Bot IP: *${data.ip}*`, sock));
      } catch { await reply(`❌ Failed to get IP`); }
      break;
    }

    case 'ping2': {
      if (!text) { await reply(`📡 *${prefix}ping2 <URL or domain>*`); break; }
      const start = Date.now();
      try {
        await axios.get(text.startsWith('http')?text:`https://${text}`, { timeout:8000 });
        await reply(ft(`📡 *Ping: ${text}*\n\n🟢 Online\n⏱ ${Date.now()-start}ms`, sock));
      } catch {
        await reply(ft(`📡 *Ping: ${text}*\n\n🔴 Offline or unreachable\n⏱ ${Date.now()-start}ms`, sock));
      }
      break;
    }

    case 'wordcount': {
      if (!text) { await reply(`📝 *${prefix}wordcount <text>*`); break; }
      const words = text.trim().split(/\s+/).length;
      const chars = text.length;
      const lines = text.split('\n').length;
      const sentences = (text.match(/[.!?]+/g)||[]).length;
      await reply(ft(`📝 *Text Stats*\n\n📖 Words: ${words}\n🔤 Characters: ${chars}\n📜 Lines: ${lines}\n💬 Sentences: ${sentences}`, sock));
      break;
    }

    case 'charcount': {
      if (!text) { await reply(`🔤 *${prefix}charcount <text>*`); break; }
      const freq = {};
      for (const c of text.toLowerCase()) { if (c.trim()) freq[c]=(freq[c]||0)+1; }
      const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>`"${c}": ${n}`).join(', ');
      await reply(ft(`🔤 Length: ${text.length}\nTop chars: ${top}`, sock));
      break;
    }

    case 'diff': {
      const sep = text.indexOf('\n');
      if (sep===-1) { await reply(`🔀 *${prefix}diff*\nSend two lines to compare:\nLine1\nLine2`); break; }
      const str1 = text.slice(0,sep);
      const str2 = text.slice(sep+1);
      const added   = str2.split(' ').filter(w=>!str1.includes(w));
      const removed = str1.split(' ').filter(w=>!str2.includes(w));
      await reply(ft(`🔀 *Diff*\n\n✅ Added: ${added.join(' ')||'none'}\n❌ Removed: ${removed.join(' ')||'none'}`, sock));
      break;
    }

    case 'jsonformat': {
      if (!text) { await reply(`📋 *${prefix}jsonformat <JSON string>*`); break; }
      try {
        const parsed = JSON.parse(text);
        await reply(ft(`📋 *Formatted JSON*\n\n\`\`\`json\n${JSON.stringify(parsed,null,2).slice(0,3000)}\`\`\``, sock));
      } catch (e) { await reply(`❌ Invalid JSON: ${e.message}`); }
      break;
    }

    case 'tableify': {
      if (!text) { await reply(`📊 *${prefix}tableify* then paste CSV data`); break; }
      const lines2 = text.trim().split('\n');
      const rows   = lines2.map(l=>l.split(',').map(c=>c.trim()));
      const widths = rows[0].map((_,ci)=>Math.max(...rows.map(r=>(r[ci]||'').length)));
      const fmt2   = row => '| ' + row.map((c,ci)=>(c||'').padEnd(widths[ci])).join(' | ') + ' |';
      const sep2   = '|-' + widths.map(w=>'-'.repeat(w)).join('-|-') + '-|';
      const table  = [fmt2(rows[0]), sep2, ...rows.slice(1).map(fmt2)].join('\n');
      await reply(`\`\`\`\n${table.slice(0,3000)}\n\`\`\``);
      break;
    }

    default: return false;
  }
  return true;
}

module.exports = { toolsHandler, TOOLS_CMDS };
