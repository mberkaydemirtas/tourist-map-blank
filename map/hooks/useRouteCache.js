// src/hooks/useRouteCache.js
import { useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MEM_LIMIT = 50; // basit LRU sınırı
const KEY_PREFIX = 'route_cache:';

export function useRouteCache() {
  const mem = useRef(new Map());            // key -> { ts, value }
  const inflight = useRef(new Map());       // key -> Promise

  const getMem = (key) => mem.current.get(key)?.value;
  const setMem = (key, value) => {
    mem.current.set(key, { ts: Date.now(), value });
    // basit LRU temizliği
    if (mem.current.size > MEM_LIMIT) {
      const items = [...mem.current.entries()].sort((a,b)=>a[1].ts-b[1].ts);
      const remove = items.slice(0, Math.max(0, mem.current.size - MEM_LIMIT));
      remove.forEach(([k]) => mem.current.delete(k));
    }
  };

  const getAsync = async (key) => {
    try {
      const raw = await AsyncStorage.getItem(KEY_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };

  const setAsync = async (key, value) => {
    try { await AsyncStorage.setItem(KEY_PREFIX + key, JSON.stringify(value)); } catch {}
  };

  const getOrFetch = useCallback(async (key, fetcher) => {
    // 1) bellek
    const m = getMem(key);
    if (m) return { data: m, source: 'memory' };

    // 2) asyncstorage
    const a = await getAsync(key);
    if (a) {
      setMem(key, a);
      return { data: a, source: 'disk' };
    }

    // 3) inflight coalescing
    if (inflight.current.has(key)) {
      const p = inflight.current.get(key);
      const res = await p;                   // aynı fetch'i paylaş
      return { data: res, source: 'coalesced' };
    }

    // 4) fetch et
    const p = (async () => {
      const res = await fetcher();
      if (res != null) {
        setMem(key, res);
        setAsync(key, res);
      }
      return res;
    })();
    inflight.current.set(key, p);
    try {
      const result = await p;
      return { data: result, source: 'network' };
    } finally {
      inflight.current.delete(key);
    }
  }, []);

  const bust = useCallback(async (key) => {
    mem.current.delete(key);
    try { await AsyncStorage.removeItem(KEY_PREFIX + key); } catch {}
  }, []);

  return { getOrFetch, bust };
}
