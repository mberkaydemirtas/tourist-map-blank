// trips/utils/tripDateUtils.js
export const sanitizeIsoDate = (d) => {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^(\d{4,5})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let [_, y, mo, da] = m;
  if (y.length === 5 && y.startsWith('200')) y = '20' + y.slice(3); // 20025 -> 2025
  const yr = +y, mm = +mo, dd = +da;
  if (!(yr>=1900 && yr<=2100)) return null;
  if (!(mm>=1 && mm<=12)) return null;
  if (!(dd>=1 && dd<=31)) return null;
  return `${String(yr).padStart(4,'0')}-${mo}-${da}`;
};

export const addDaysISO = (iso, n) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
};

export const nightsBetween = (start, end) => {
  const out=[]; if(!start||!end||start>=end) return out;
  let cur=start; while(cur<end){ out.push(cur); cur=addDaysISO(cur,1); } return out;
};

export const deriveDateRange = (trip) => {
  const dr = trip?.dateRange || {};
  let start = sanitizeIsoDate(dr.start);
  let end   = sanitizeIsoDate(dr.end);
  if ((!start || !end) && trip?._startEndSingle) {
    start = sanitizeIsoDate(trip._startEndSingle.start?.date) || start;
    end   = sanitizeIsoDate(trip._startEndSingle.end?.date)   || end;
  }
  return { start, end };
};

export const toISODateSafe = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
};
