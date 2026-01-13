// src/shared/localDrivers/asyncStorageDriver.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emptyTrip, now } from '../shared/types';

const STORAGE_KEY = 'TRIPS_V1';

async function readAll() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(items) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function isDeletedTrip(t) {
  // ✅ Hem eski local (deletedAt) hem server uyumu için (deleted)
  return !!(t?.deletedAt || t?.deleted);
}

export default function createAsyncStorageDriver() {
  return {
    async listTrips() {
      const items = await readAll();
      return items
        .filter((t) => !isDeletedTrip(t))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async getTrip(id) {
      if (!id) return null;
      const items = await readAll();
      const t = items.find((x) => x.id === id) || null;
      if (!t) return null;
      if (isDeletedTrip(t)) return null;
      return t;
    },

    async createTrip(init = {}) {
      const items = await readAll();
      const base = init.title || 'Yeni Gezi';
      const existing = items.filter((t) => (t.title || '').startsWith(base));
      const numbered = existing.length ? `${base} ${existing.length + 1}` : base;

      // emptyTrip id üretmiyorsa burada kesinleştir
      const draft = emptyTrip({ ...init, title: numbered });

      const trip = draft.id
        ? {
            ...draft,
            deleted: false,
            deletedAt: undefined,
          }
        : {
            ...draft,
            id: `${now()}_${Math.random().toString(36).slice(2, 8)}`,
            deleted: false,
            deletedAt: undefined,
          };

      await writeAll([trip, ...items]);
      return trip;
    },

    async updateTrip(id, patch, expectedVersion) {
      const items = await readAll();
      const idx = items.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error('Trip not found');

      const current = items[idx];
      if (expectedVersion != null && current.version !== expectedVersion) {
        console.warn('Version conflict (local):', {
          expectedVersion,
          actual: current.version,
        });
      }

      const updated = {
        ...current,
        ...patch,
        id, // id sabit
        version: (current.version || 1) + 1,
        updatedAt: now(),
      };

      // ✅ Eğer patch deleted true/false getiriyorsa deletedAt'i uyumlu tut
      if (patch?.deleted === true && !updated.deletedAt) {
        updated.deletedAt = now();
      } else if (patch?.deleted === false) {
        updated.deletedAt = undefined;
      }

      items[idx] = updated;
      await writeAll(items);
      return updated;
    },

    async deleteTrip(id) {
      const items = await readAll();
      const idx = items.findIndex((t) => t.id === id);
      if (idx === -1) return;

      const t = now();
      items[idx] = {
        ...items[idx],
        deleted: true,     // ✅ server uyumu
        deletedAt: t,      // ✅ local uyumu
        updatedAt: t,
        version: (items[idx].version || 1) + 1,
      };

      await writeAll(items);
    },

    async duplicateTrip(id) {
      const items = await readAll();
      const src = items.find((t) => t.id === id);
      if (!src) throw new Error('Trip not found');

      const t = now();
      const copy = {
        ...src,
        id: `${t}_${Math.random().toString(36).slice(2, 6)}`,
        title: `Kopya - ${src.title}`,
        createdAt: t,
        updatedAt: t,
        version: 1,
        deleted: false,
        deletedAt: undefined,
      };

      await writeAll([copy, ...items]);
      return copy;
    },
  };
}
