// app/lib/tripsLocal.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import 'react-native-get-random-values';
import { v4 as uuid } from "uuid";

const IDX = "trip:INDEX";
const LAST = "trip:lastSyncAt";

async function readIndex() {
  try { return JSON.parse(await AsyncStorage.getItem(IDX)) || []; }
  catch { return []; }
}
async function writeIndex(idx) { await AsyncStorage.setItem(IDX, JSON.stringify(idx)); }

export async function listTripsLocal() {
  const idx = await readIndex();
  const rows = [];
  for (const it of idx) {
    const raw = await AsyncStorage.getItem(`trip:${it.id}`);
    if (!raw) continue;
    rows.push(JSON.parse(raw));
  }
  return rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getTripLocal(id) {
  const raw = await AsyncStorage.getItem(`trip:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function createTripLocal(seed = {}) {
  const id = seed?._id || uuid();
  const now = new Date().toISOString();
  const trip = {
    _id: id,
    title: seed.title || "My Trip",
    cities: seed.cities || [],
    dateRange: seed.dateRange || { start: null, end: null },
    start: seed.start || null,
    end: seed.end || null,
    lodgings: seed.lodgings || [],
    places: seed.places || [],
    status: seed.status || 'draft',       // 'draft' | 'active' | 'completed'
    wizardStep: Number.isFinite(seed.wizardStep) ? seed.wizardStep : 0,
    version: 0,
    updatedAt: now,
    deleted: !!seed.deleted,
    __dirty: true,
  };
  await AsyncStorage.setItem(`trip:${id}`, JSON.stringify(trip));
  const idx = await readIndex();
  if (!idx.find(x => x.id === id)) {
    idx.push({ id, updatedAt: now, version: 0, deleted: !!seed.deleted });
    await writeIndex(idx);
  }
  return trip;
}

export async function saveTripLocal(trip) {
  const now = new Date().toISOString();
  const next = { ...trip, updatedAt: now, __dirty: true };
  await AsyncStorage.setItem(`trip:${trip._id}`, JSON.stringify(next));
  const idx = await readIndex();
  const i = idx.findIndex(x => x.id === trip._id);
  const row = { id: trip._id, updatedAt: now, version: trip.version, deleted: !!trip.deleted };
  if (i >= 0) idx[i] = row; else idx.push(row);
  await writeIndex(idx);
  return next;
}

 // 👇 küçük, güvenli patch helper (id + patch ver; okuyup birleştirir)
 export async function patchTripLocal(id, patch = {}) {
   const raw = await AsyncStorage.getItem(`trip:${id}`);
   const now = new Date().toISOString();
   const base = raw ? JSON.parse(raw) : { _id: id, version: 0 };
   const next = { ...base, ...patch, updatedAt: now, __dirty: true };
   await AsyncStorage.setItem(`trip:${id}`, JSON.stringify(next));
   const idx = await readIndex();
   const i = idx.findIndex(x => x.id === id);
   const row = { id, updatedAt: now, version: next.version, deleted: !!next.deleted };
   if (i >= 0) idx[i] = row; else idx.push(row);
   await writeIndex(idx);
   return next;
 }
 

export async function markDeleteLocal(id) {
  const raw = await AsyncStorage.getItem(`trip:${id}`);
  if (!raw) return;
  const obj = JSON.parse(raw);
  obj.deleted = true; obj.__dirty = true; obj.updatedAt = new Date().toISOString();
  await AsyncStorage.setItem(`trip:${id}`, JSON.stringify(obj));
  const idx = await readIndex();
  const i = idx.findIndex(x => x.id === id);
  if (i >= 0) { idx[i].deleted = true; idx[i].updatedAt = obj.updatedAt; }
  await writeIndex(idx);
}

export async function getDirtyChanges() {
  const idx = await readIndex();
  const out = [];
  for (const it of idx) {
    const raw = await AsyncStorage.getItem(`trip:${it.id}`);
    if (!raw) continue;
    const obj = JSON.parse(raw);
    if (obj.__dirty) {
      if (obj.deleted) out.push({ type: "delete", id: obj._id });
      else out.push({ type: "upsert", expectedVersion: obj.version, data: stripLocal(obj) });
    }
  }
  return out;
}

function stripLocal(obj) {
  const copy = { ...obj };
  delete copy.__dirty;
  return copy;
}

export async function applyServerRows(rows) {
  const idx = await readIndex();
  const byId = new Map(idx.map(x => [x.id, x]));

  for (const r of (rows || [])) {
    const now = new Date(r.updatedAt || Date.now()).toISOString();
    const withLocal = { ...r, __dirty: false, updatedAt: now };
    await AsyncStorage.setItem(`trip:${r._id}`, JSON.stringify(withLocal));

    const row = { id: r._id, updatedAt: now, version: r.version, deleted: !!r.deleted };
    byId.set(r._id, row);
  }
  await writeIndex(Array.from(byId.values()));
}

export async function getLastSync() { return (await AsyncStorage.getItem(LAST)) || null; }
export async function setLastSync(ts) { await AsyncStorage.setItem(LAST, ts); }
