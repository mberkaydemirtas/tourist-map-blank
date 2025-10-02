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
// TRIPS_V1: asıl veri (src/shared/localDrivers/asyncStorageDriver.js içinde)
// Aşağıdakiler lokal sync metaverileri:
const LAST = 'trip:lastSyncAt';
const SYNC_VMAP_KEY = 'TRIPS_SYNC_VERSION_MAP_V1'; // { [id]: lastSyncedVersion }
const DELETES_KEY   = 'TRIPS_SYNC_DELETES_V1';     // string[] (silinmiş id'ler, henüz servera gönderilmedi)

async function readJson(key, def) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : def; }
  catch { return def; }
}
async function writeJson(key, val) { await AsyncStorage.setItem(key, JSON.stringify(val)); }

// === Eski API: Listele / Oku / Oluştur / Kaydet / Patch / Sil / Kopyala ===
export async function listTripsLocal() {
  return listTrips(); // { id, title, version, updatedAt, ... }
}

export async function getTripLocal(id) {
  return getTrip(id);
}

export async function createTripLocal(seed = {}) {
  const t = await createTrip(seed);
  // oluşturulan her kaydı "dirty" kabul edelim → versiyon haritası henüz yok
  // bir şey yapmasak da getDirtyChanges bunu fark eder (undefined !== version).
  return t;
}

export async function saveTripLocal(trip) {
  if (!trip?.id) throw new Error('[tripsLocal] saveTripLocal: trip.id missing');
  // Tam obje yolluyorsan patch olarak geçer; sürücü version'ı arttırır.
  const updated = await updateTrip(trip.id, { ...trip });
  return updated;
}

// Küçük, güvenli patch helper: ID + patch → birleştir
export async function patchTripLocal(id, patch = {}) {
  const cur = await getTrip(id);
  if (!cur) throw new Error('[tripsLocal] patchTripLocal: trip not found');
  const updated = await updateTrip(id, { ...cur, ...patch });
  return updated;
}

export async function markDeleteLocal(id) {
  // Silmeyi kuyruğa da yaz (senkron için)
  await deleteTrip(id);
  const dels = await readJson(DELETES_KEY, []);
  if (!dels.includes(id)) { dels.push(id); await writeJson(DELETES_KEY, dels); }
}

export async function duplicateTripLocal(id) {
  return duplicateTrip(id);
}

// === Sync yardımcıları ===
// Değişiklik listesi: version haritasına göre farkları çıkar.
export async function getDirtyChanges() {
  const trips = await listTrips();
  const vmap = await readJson(SYNC_VMAP_KEY, {}); // { [id]: number }
  const dels = await readJson(DELETES_KEY, []);

  const out = [];

  // Silinenler → delete
  for (const id of dels) out.push({ type: 'delete', id });

  // Var olan kayıtlar → upsert (version değişmişse)
  for (const t of trips) {
    // soft-delete edilmişler listTrips tarafından zaten filtreleniyor
    const lastV = vmap[t.id];
    if (lastV === t.version) continue; // değişmemiş
    out.push({
      type: 'upsert',
      expectedVersion: lastV ?? null,
      data: stripLocal(t),
    });
  }

  return out;
}

function stripLocal(obj) {
  // Şimdilik doğrudan nesneyi döndürüyoruz; özel yerel alan yok.
  const copy = { ...obj };
  return copy;
}

// Sunucu sıraları uygula: TRIPS_V1 içine yazar + versiyon haritasını günceller + silme kuyruğunu temizler.
export async function applyServerRows(rows) {
  const STORAGE_KEY = 'TRIPS_V1';
  const itemsRaw = await AsyncStorage.getItem(STORAGE_KEY);
  const items = itemsRaw ? (JSON.parse(itemsRaw) || []) : [];
  const byId = new Map(items.map(x => [x.id, x]));

  const vmap = await readJson(SYNC_VMAP_KEY, {});
  const dels = new Set(await readJson(DELETES_KEY, []));

  for (const r of (rows || [])) {
    const id = r.id || r._id;
    if (!id) continue;
    // Server tarafı bir silme göndermişse, soft-delete olarak işaretleyelim
    if (r.deleted || r.deletedAt) {
      const prev = byId.get(id) || {};
      const delRow = {
        ...prev,
        id,
        deletedAt: r.deletedAt || nowISO(),
        updatedAt: r.updatedAt || nowISO(),
        version: r.version ?? ((prev.version || 1) + 1),
      };
      byId.set(id, delRow);
      vmap[id] = delRow.version;
      dels.delete(id);
      continue;
    }

    // Upsert
    const next = { ...byId.get(id), ...r, id, updatedAt: r.updatedAt || nowISO() };
    byId.set(id, next);
    if (typeof r.version === 'number') vmap[id] = r.version;
  }

  const merged = Array.from(byId.values());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  await writeJson(SYNC_VMAP_KEY, vmap);
  await writeJson(DELETES_KEY, Array.from(dels)); // uygulanan silmeler kuyruğundan düşer
}

export async function getLastSync() {
  return (await AsyncStorage.getItem(LAST)) || null;
}
export async function setLastSync(ts) {
  await AsyncStorage.setItem(LAST, ts);
}

function nowISO() {
  return new Date().toISOString();
}
