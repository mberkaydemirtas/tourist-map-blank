// src/shared/types.js
export const now = () => Date.now();
export const makeId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Tip benzeri JSDoc — backend ile uyumlu şema **/

/** @typedef {{place_id?:string, coords?:{latitude:number,longitude:number}, name?:string, address?:string}} PlaceRef */

 /** @typedef {{ id:string, name?:string, place_id?:string, coords?:{latitude:number,longitude:number}, address?:string,
  * startTime?:string, durationMin?:number, notes?:string, category?:string, source?:'manual'|'template'|'ai' }} Stop */

 /** @typedef {{ mode:'plane'|'train'|'bus'|'car'|'walk', arriveTime?:string, departTime?:string, hub?:PlaceRef,
  * mustArriveBeforeMin?:number }} TransportLeg */

 /** @typedef {{ city:string, place:PlaceRef, nights:number, checkIn:string, checkOut:string }} Stay */

 /** @typedef {{ type:'TRANSFER'|'VISIT'|'MEAL'|'CHECKIN'|'CHECKOUT'|'BUFFER', from?:PlaceRef, to?:PlaceRef,
  * mode?:'walk'|'car'|'bus'|'train', etaMin?:number, place?:PlaceRef, start?:string, end?:string, notes?:string,
  * reason?:'arrival'|'security'|'rest', minutes?:number }} DayPlanBlock */

 /** @typedef {{ date:string, anchor:{type:'lodging'|'hub'|'custom', place:PlaceRef, ready_at:string},
  * dayWindow:{start:string,end:string}, blocks:DayPlanBlock[]}} DayPlan */

 /** @typedef {{ id:string, userId?:string, title:string,
  * dateRange?:{start:string,end:string},
  * transport?:{ inbound?:TransportLeg, outbound?:TransportLeg },
  * stays?:Stay[], daily?:DayPlan[], stops?:Stop[], tags?:string[], source:'scratch'|'template'|'ai',
  * createdAt:number, updatedAt:number, version:number, deletedAt?:number|null }} Trip */

export const emptyTrip = (patch = {}) => {
  const t = now();
  return {
    id: makeId(),
    title: 'Yeni Gezi',
    source: 'scratch',
    createdAt: t,
    updatedAt: t,
    version: 1,
    stops: [],
    ...patch,
  };
};

export const formatDate = (ts) => {
  try { return new Date(ts).toLocaleDateString(); } catch { return '-'; }
};

export function toISODate(d) {
  if (typeof d === 'string') return d;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function enumerateDates(startISO, endISO) {
  const res = [];
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    res.push(toISODate(new Date(d)));
  }
  return res;
}
export function timeToMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
export function minutesToTime(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${String(h).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
export function addMinutes(hhmm, delta) {
  return minutesToTime(timeToMinutes(hhmm) + delta);
}
export function inboundBufferByMode(mode) {
  switch (mode) {
    case 'plane': return 90;
    case 'train': return 45;
    case 'bus':   return 45;
    case 'car':   return 20;
    case 'walk':  return 10;
    default:      return 45;
  }
}
export function outboundMustArriveBeforeMin(mode) {
  switch (mode) {
    case 'plane': return 120;
    case 'train': return 45;
    case 'bus':   return 45;
    case 'car':   return 30;
    case 'walk':  return 10;
    default:      return 45;
  }
}

/** Günlük plan iskeleti üretir */
export function buildInitialDailyPlan({ dateRange, transport, stays }) {
  if (!dateRange?.start || !dateRange?.end) return [];
  const dates = enumerateDates(dateRange.start, dateRange.end);

  const lodging = stays?.[0]?.place || { name: 'Konaklama' };
  const checkIn = stays?.[0]?.checkIn || '14:00';
  const checkOut = stays?.[0]?.checkOut || '11:00';

  const defaultStart = '09:00';
  const defaultEnd = '21:00';

  const inMode = transport?.inbound?.mode || 'plane';
  const inArrive = transport?.inbound?.arriveTime || '10:30';
  const readyAt = addMinutes(inArrive, inboundBufferByMode(inMode));

  const outMode = transport?.outbound?.mode || 'plane';
  const outDepart = transport?.outbound?.departTime || '17:30';
  const mustArriveMin = transport?.outbound?.mustArriveBeforeMin ?? outboundMustArriveBeforeMin(outMode);
  const targetArriveAtHub = addMinutes(outDepart, -mustArriveMin);

  const daily = dates.map((date, i) => {
    let anchor = { type: 'lodging', place: lodging, ready_at: defaultStart };
    let dayWindow = { start: defaultStart, end: defaultEnd };
    /** @type {DayPlanBlock[]} */
    const blocks = [];

    if (i === 0) {
      const startTime = maxTime(readyAt, defaultStart);
      anchor = { type: 'lodging', place: lodging, ready_at: startTime };
      dayWindow = { start: startTime, end: defaultEnd };
      blocks.push({ type: 'BUFFER', reason: 'arrival', minutes: inboundBufferByMode(inMode) });
      blocks.push({ type: 'CHECKIN', place: lodging, time: checkIn });
    } else if (i === dates.length - 1) {
      dayWindow = { start: defaultStart, end: minTime(defaultEnd, targetArriveAtHub) };
      anchor = { type: 'lodging', place: lodging, ready_at: defaultStart };
      blocks.push({ type: 'CHECKOUT', place: lodging, time: checkOut });
      blocks.push({ type: 'BUFFER', reason: 'security', minutes: mustArriveMin });
    }

    return { date, anchor, dayWindow, blocks };
  });

  return daily;
}

function maxTime(a, b) { return timeToMinutes(a) > timeToMinutes(b) ? a : b; }
function minTime(a, b) { return timeToMinutes(a) < timeToMinutes(b) ? a : b; }
