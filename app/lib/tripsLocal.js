// app/lib/tripsLocal.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  listTrips,
  getTrip,
  createTrip,
  updateTrip,
  deleteTrip,
  duplicateTrip,
} from '../../trips/shared/tripsRepo';

// === Sync metaverileri (yalnızca senkron için kullanılır) ===
const LAST = 'trip:lastSyncAt';
const SYNC_VMAP_KEY = 'TRIPS_SYNC_VERSION_MAP_V1'; // { [id]: lastSyncedVersion }
const DELETES_KEY   = 'TRIPS_SYNC_DELETES_V1';     // string[] (silinmiş id'ler, henüz servera gönderilmedi)

const STORAGE_KEY = 'TRIPS_V1'; // asyncStorageDriver ile aynı

async function readJson(key, def) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : def; }
  catch { return def; }
}
async function writeJson(key, val) { await AsyncStorage.setItem(key, JSON.stringify(val)); }

// ✅ number timestamp (driver ile uyumlu)
function nowTS() {
  return Date.now();
}

// server’dan gelen updatedAt (Date/ISO/number) → number
function toTs(x) {
  if (x == null) return null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const s = String(x);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// === Eski API: Listele / Oku / Oluştur / Kaydet / Patch / Sil / Kopyala ===
export async function listTripsLocal() {
  return listTrips();
}

export async function getTripLocal(id) {
  return getTrip(id);
}

export async function createTripLocal(seed = {}) {
  const t = await createTrip(seed);
  return t;
}

export async function saveTripLocal(trip) {
  if (!trip?.id) throw new Error('[tripsLocal] saveTripLocal: trip.id missing');
  const updated = await updateTrip(trip.id, { ...trip });
  return updated;
}

export async function patchTripLocal(id, patch = {}) {
  const cur = await getTrip(id);
  if (!cur) throw new Error('[tripsLocal] patchTripLocal: trip not found');
  const updated = await updateTrip(id, { ...cur, ...patch });
  return updated;
}

export async function markDeleteLocal(id) {
  await deleteTrip(id);

  const dels = await readJson(DELETES_KEY, []);
  if (!dels.includes(id)) {
    dels.push(id);
    await writeJson(DELETES_KEY, dels);
  }
}

export async function duplicateTripLocal(id) {
  return duplicateTrip(id);
}

// === Sync yardımcıları ===
export async function getDirtyChanges() {
  const trips = await listTrips();
  const vmap = await readJson(SYNC_VMAP_KEY, {});
  const dels = await readJson(DELETES_KEY, []);

  const out = [];

  for (const id of dels) out.push({ type: 'delete', id });

  for (const t of trips) {
    const lastV = vmap[t.id];
    if (lastV === t.version) continue;

    out.push({
      type: 'upsert',
      expectedVersion: lastV ?? null,
      data: stripLocal(t),
    });
  }

  return out;
}

function stripLocal(obj) {
  return { ...obj };
}

/**
 * ✅ Sunucudan gelen rows’u TRIPS_V1’e uygula
 * - asyncStorageDriver ile uyumlu olacak şekilde updatedAt/createdAt NUMBER tutar
 * - _id → id map eder
 * - deleted → deletedAt map eder
 */
export async function applyServerRows(rows) {
  const itemsRaw = await AsyncStorage.getItem(STORAGE_KEY);
  const items = itemsRaw ? (JSON.parse(itemsRaw) || []) : [];
  const byId = new Map(items.map(x => [x.id, x]));

  const vmap = await readJson(SYNC_VMAP_KEY, {});
  const dels = new Set(await readJson(DELETES_KEY, []));

  for (const r0 of (rows || [])) {
    const id = String(r0?.id || r0?._id || '');
    if (!id) continue;

    // server objesi bazen mongoose lean ile _id/id ikisini de dönebilir
    const r = { ...r0, id };

    const prev = byId.get(id) || {};
    const serverUpdated = toTs(r.updatedAt) ?? nowTS();
    const serverCreated = toTs(r.createdAt) ?? (prev.createdAt ?? serverUpdated);

    // --- deleted handling ---
    if (r.deleted || r.deletedAt) {
      const delAt = toTs(r.deletedAt) ?? serverUpdated ?? nowTS();
      const delRow = {
        ...prev,
        ...r,
        id,
        deletedAt: delAt,
        updatedAt: serverUpdated,
        createdAt: serverCreated,
        version: typeof r.version === 'number' ? r.version : ((prev.version || 1) + 1),
      };
      byId.set(id, delRow);
      vmap[id] = delRow.version;
      dels.delete(id);
      continue;
    }

    // --- upsert ---
    const next = {
      ...prev,
      ...r,
      id,
      updatedAt: serverUpdated,
      createdAt: serverCreated,
    };

    // server deleted=false geldiyse ama lokalde deletedAt varsa temizleyelim (geri açma senaryosu)
    if (next.deletedAt && !r.deleted) {
      // istemiyorsan bunu kaldırabiliriz; şu an “server truth” varsayımıyla temizliyorum
      next.deletedAt = undefined;
    }

    byId.set(id, next);
    if (typeof r.version === 'number') vmap[id] = r.version;
  }

  const merged = Array.from(byId.values());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  await writeJson(SYNC_VMAP_KEY, vmap);
  await writeJson(DELETES_KEY, Array.from(dels));
}

export async function getLastSync() {
  return (await AsyncStorage.getItem(LAST)) || null;
}
export async function setLastSync(ts) {
  await AsyncStorage.setItem(LAST, String(ts || ''));
}
