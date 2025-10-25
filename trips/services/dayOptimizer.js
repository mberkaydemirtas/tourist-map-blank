// trip/services/dayOptimizer.js
// ——— ufak, bağımsız JS yardımcıları ———
const R = 6371e3;
function toRad(x){ return (x*Math.PI)/180; }
function haversine(a,b){
  const φ1=toRad(a.lat), φ2=toRad(b.lat);
  const dφ=toRad(b.lat-a.lat), dλ=toRad(b.lon-a.lon);
  const s = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

function locOf(act){
  const l = act?.place?.location;
  return (l && Number.isFinite(l.lat) && Number.isFinite(l.lon)) ? { lat: l.lat, lon: l.lon } : null;
}

function nearestNeighborOrder(mids, start) {
  const remain = mids.map((_,i)=>i);
  const order = [];
  let cur = start;
  while (remain.length) {
    let best=-1, bestD=Infinity;
    for (let i=0;i<remain.length;i++){
      const cand = mids[remain[i]];
      const d = haversine(cur, cand);
      if (d < bestD) { bestD=d; best=i; }
    }
    const picked = remain.splice(best,1)[0];
    order.push(picked);
    cur = mids[picked];
  }
  return order;
}

function twoOptPath(coords, start, end, maxIter=1200){
  const n = coords.length;
  if (n < 3) return coords.slice();

  const dist = (a,b)=>haversine(a,b);
  const totalLen = (arr)=>{
    let L=0, prev=start;
    for (let i=0;i<arr.length;i++){ L+=dist(prev,arr[i]); prev=arr[i]; }
    return L + dist(prev,end);
  };

  let best = coords.slice();
  let bestLen = totalLen(best);
  let improved = true, iter=0;

  while (improved && iter < maxIter){
    improved = false; iter++;
    for (let i=0;i<n-1;i++){
      for (let k=i+1;k<n;k++){
        const cand = best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        const L = totalLen(cand);
        if (L + 1e-6 < bestLen){
          best = cand; bestLen = L; improved = true;
        }
      }
    }
  }
  return best;
}

/** Gün aktivitelerini, (varsa) start/end sabit kabul ederek sırala */
export function optimizeDayWithAnchors(day, trip, getAnchorsForDayDetailedFn){
  const acts = Array.isArray(day?.activities) ? day.activities.slice() : [];
  if (acts.length <= 1) return acts;

  const { start, end } = getAnchorsForDayDetailedFn(trip, day);
  // Anchor yoksa mevcut sırayı koru
  if (!start && !end) return acts;

  const mids = acts.map(locOf);
  if (mids.some(v=>!v)) return acts;

  // fallback uçlar: tek uç varsa diğerini ilk/son aktivite kabul ederek yol oluştur
  const s = start || mids[0];
  const e = end   || mids[mids.length-1];

  // 1) NN ile kaba sıra
  const nnIdx = nearestNeighborOrder(mids, s);
  const nnActs = nnIdx.map(i => acts[i]);
  const nnCoords = nnIdx.map(i => mids[i]);

  // 2) 2-Opt ile iyileştir
  const improvedCoords = twoOptPath(nnCoords, s, e);

  // coords -> activitiy geri eşleme (anahtar olarak lat/lon kullanıyoruz)
  const key = (p)=>`${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const idxByKey = new Map(mids.map((m,i)=>[key(m), i]));
  const ordered = improvedCoords.map(c => acts[idxByKey.get(key(c))]);

  return ordered;
}
