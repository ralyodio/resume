const crypto = require('crypto');
function cleanText(s=''){ return String(s||'').replace(/\s+/g,' ').trim(); }
function stripHtml(s=''){ return cleanText(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"')); }
function slugify(s=''){ return cleanText(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function hashString(s=''){ return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0,16); }
function textIncludesAny(text, words){ const t=String(text||'').toLowerCase(); return words.some(w => t.includes(String(w).toLowerCase())); }
function parseSinceDays(s='7d'){ if (typeof s === 'number') return s; const m=String(s).match(/(\d+)\s*d/i); return m?Number(m[1]):7; }
function isIsoDate(s){ return typeof s === 'string' && !Number.isNaN(Date.parse(s)); }
function toIsoDate(value){ if (!value) return new Date().toISOString(); const d = value instanceof Date ? value : new Date(value); if (Number.isNaN(d.getTime())) return new Date().toISOString(); return d.toISOString(); }
function canonicalUrl(u=''){ try { const url=new URL(u); url.hash=''; ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','referrer'].forEach(k=>url.searchParams.delete(k)); return url.toString().replace(/\/$/,''); } catch { return String(u||'').trim(); } }
module.exports={cleanText,stripHtml,slugify,hashString,textIncludesAny,parseSinceDays,isIsoDate,toIsoDate,canonicalUrl};
