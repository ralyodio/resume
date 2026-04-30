#!/usr/bin/env node
/* Publish SKILL.md packages to ClawMart via https://www.shopclawmart.com/api/v1/.
   Requires: CLAWMART_API_KEY=cm_live_...
   Usage: CLAWMART_API_KEY=... node clawmart_publish.cjs /tmp/sh1pt-promote-manifests/dice.sh1pt.skill.json
*/
const fs = require('fs');
const path = require('path');
const API = 'https://www.shopclawmart.com/api/v1';
const key = process.env.CLAWMART_API_KEY;
if (!key) { console.error('Missing CLAWMART_API_KEY'); process.exit(2); }
const manifestPath = process.argv[2];
if (!manifestPath) { console.error('Usage: clawmart_publish.cjs <sh1pt.skill.json>'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const skillPath = manifest.skillFile || manifest.skill_file || manifest.file || manifest.path || path.join(path.dirname(manifestPath), 'SKILL.md');
const sourceUrl = manifest.sourceUrl || manifest.source_url || manifest.sourceURL || '';
async function req(method, endpoint, body) {
  const r = await fetch(API + endpoint, {
    method,
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${endpoint} failed ${r.status}: ${text.slice(0,500)}`);
  return data;
}
(async()=>{
  const me = await req('GET','/me');
  const listings = await req('GET','/listings');
  const title = manifest.title || manifest.name;
  const slug = manifest.slug || String(title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const existing = (Array.isArray(listings) ? listings : listings.listings || []).find(l => l.slug === slug || l.name === title);
  const payload = {
    name: title,
    tagline: manifest.tagline || manifest.description || title,
    about: manifest.description || title,
    category: manifest.category || 'Automation',
    capabilities: manifest.tags || ['skills','automation','agents'],
    price: Number(manifest.price || 0),
    productType: 'skill',
    sourceUrl,
  };
  const listing = existing ? await req('PATCH', `/listings/${existing.id}`, payload) : await req('POST','/listings', payload);
  const id = listing.id || listing.listing?.id || existing?.id;
  if (!id) throw new Error('No listing id returned');
  const skillContent = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : await (await fetch(sourceUrl)).text();
  const version = await req('POST', `/listings/${id}/versions`, {
    version: manifest.version || '1.0.0',
    package: Buffer.from(skillContent).toString('base64'),
    filename: 'SKILL.md',
    contentType: 'text/markdown',
    changelog: 'Initial public release',
  });
  console.log(JSON.stringify({ ok:true, user: me.username || me.email || me.id, listing, version }, null, 2));
})();
