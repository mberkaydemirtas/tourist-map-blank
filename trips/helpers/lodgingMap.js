// helpers/lodgingMap.js
 export function staysToLodgings(stays = []) {
   const addDaysISO = (s, n) => { const d = new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
   const nightsBetween = (s, e) => { const out=[]; if(!s||!e||s>=e) return out; let cur=s; while(cur<e){ out.push(cur); cur=addDaysISO(cur,1);} return out; };
   const out = [];
   (stays||[]).forEach((s, i) => {
     if (!s?.startDate || !s?.endDate || !s?.place?.location) return;
     const { lat } = s.place.location;
     const lon = s.place.location.lng ?? s.place.location.lon;
     if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
     for (const date of nightsBetween(s.startDate, s.endDate)) {
       out.push({
         id: s.id || `lodg:${i}:${date}`,
         name: s.place.name || 'Lodging',
         address: s.place.address || '',
         date,
         location: { lat, lon },
       });
     }
   });
   return out;
}