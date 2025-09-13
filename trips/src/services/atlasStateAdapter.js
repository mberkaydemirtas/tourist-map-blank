// trips/trips/src/services/atlasStateAdapter.js
// State/il düzeyi atlas okuyucu (TR gibi)

import ALL from '../data/atlas-state/all.json';

const hasNormalize = typeof String.prototype.normalize === 'function';
const stripAccents = (s) =>
  (hasNormalize ? String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : String(s || ''));
const norm = (s) => stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
const safeCmp = (a,b)=> String(a||'').localeCompare(String(b||''), 'tr', {sensitivity:'base'});

function getAll() { return ALL; }

export function listCountriesAdminLevel(){
  const all = getAll();
  const out = [];
  for (const cc of Object.keys(all.countries || {})) {
    const c = all.countries[cc];
    if (c?.level === 'admin') out.push({ code: c.code, name: c.name, level: 'admin' });
  }
  out.sort((a,b)=> safeCmp(a.name,b.name));
  return out;
}

export function getCountryDoc(cc){
  const all = getAll();
  return all.countries?.[String(cc).toUpperCase()] || null;
}

export function listAdmins(cc){
  const doc = getCountryDoc(cc);
  if (!doc?.admins?.length) return [];
  return doc.admins.map(a => ({ code:a.code, name:a.name })).sort((a,b)=> safeCmp(a.name,b.name));
}

export function findAdmin(cc, query){
  const doc = getCountryDoc(cc);
  if (!doc?.admins?.length) return null;
  const q = norm(query);
  return doc.admins.find(a => norm(a.code)===q || norm(a.name)===q) || null;
}

export function getHubsForAdmin(cc, adminCodeOrName){
  const doc = getCountryDoc(cc);
  if (!doc?.admins?.length) return { plane:[], train:[], bus:[] };
  const q = norm(adminCodeOrName);
  const a = doc.admins.find(x => norm(x.code)===q || norm(x.name)===q);
  if (!a?.hubs) return { plane:[], train:[], bus:[] };
  const dedupe = (arr=[])=>{
    const seen = new Set();
    return (arr||[]).filter(x=>{
      const k = `${norm(x.name)}|${Math.round((x.lat??0)*1e6)}|${Math.round((x.lng??0)*1e6)}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((u,v)=> safeCmp(u.name,v.name));
  };
  return {
    plane: dedupe(a.hubs.plane),
    train: dedupe(a.hubs.train),
    bus:   dedupe(a.hubs.bus),
  };
}
