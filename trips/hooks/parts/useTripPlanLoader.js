// trips/hooks/parts/useTripPlanLoader.js
import { useEffect } from 'react';
import { Alert } from 'react-native';

import { getTripLocal, patchTripLocal } from '../../../app/lib/tripsLocal';
import { getPlanByTripId, savePlan } from '../../shared/plansRepo';
import { generatePlan } from '../../services/planService';

import {
  sanitizeIsoDate,
  ensureResolvedForPlan,
} from '../../components/TripPlanHelpers';

// Sıfırdan boş bir plan üretici (eski makeEmptyPlan)
const makeEmptyPlan = (tripId) => {
  const todayISO = new Date().toISOString().slice(0, 10);
  return {
    _id: `plan_${tripId}`,
    id: `plan_${tripId}`,
    tripId,
    days: [{ id: `day_${todayISO}`, date: todayISO, activities: [] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'scratch',
  };
};

/**
 * Trip & Plan yükleme / oluşturma mantığı
 * - Tarihleri sanitize eder
 * - ensureResolvedForPlan ile place detaylarını çözer
 * - Varsa mevcut planı yükler, yoksa generatePlan veya empty plan
 */
export function useTripPlanLoader({
  tripId,
  prefs,
  route,
  setTrip,
  setPlan,
  setLoading,
}) {
  useEffect(() => {
    if (!tripId) return;

    (async () => {
      try {
        setLoading(true);

        // 1) Trip'i local DB'den al
        let t = await getTripLocal(tripId);
        if (!t) {
          Alert.alert('Plan', 'Trip bulunamadı.');
          setLoading(false);
          return;
        }

        // 2) Tarih alanlarını düzelt
        const fixDate = (s) => sanitizeIsoDate(s) || s;
        let patched = false;

        if (t?.dateRange) {
          const s = fixDate(t.dateRange.start);
          const e = fixDate(t.dateRange.end);
          if (s && s !== t.dateRange.start) {
            t.dateRange.start = s;
            patched = true;
          }
          if (e && e !== t.dateRange.end) {
            t.dateRange.end = e;
            patched = true;
          }
        }

        if (t?._startEndSingle) {
          for (const k of ['start', 'end']) {
            const cur = t._startEndSingle[k];
            if (cur?.date) {
              const f = fixDate(cur.date);
              if (f && f !== cur.date) {
                cur.date = f;
                patched = true;
              }
            }
          }
        }

        if (t?._startEndByCity && typeof t._startEndByCity === 'object') {
          for (const k of Object.keys(t._startEndByCity)) {
            for (const kk of ['start', 'end']) {
              const cur = t._startEndByCity[k]?.[kk];
              if (cur?.date) {
                const f = fixDate(cur.date);
                if (f && f !== cur.date) {
                  cur.date = f;
                  patched = true;
                }
              }
            }
          }
        }

        // 3) Gerekirse trip'in tarihlerini patchle
        if (patched) {
          try {
            await patchTripLocal(t._id ?? t.id, {
              dateRange: t.dateRange ?? null,
              _startEndSingle: t._startEndSingle ?? null,
              _startEndByCity: t._startEndByCity ?? null,
              updatedAt: new Date().toISOString(),
              __dirty: true,
            });
          } catch {
            // sessiz fail
          }

          try {
            t = (await getTripLocal(t._id ?? t.id)) || t;
          } catch {
            // yine sessiz, eldeki t ile devam
          }
        }

        // 4) Yerler çözülmemişse resolve et
        t = await ensureResolvedForPlan(t);
        setTrip(t);

        // 5) Plan yükle / üret
        const existing = await getPlanByTripId(tripId);
        const scratchMode = route?.params?.mode === 'scratch';

        if (existing?.days?.length && !scratchMode) {
          // Eski şemayı normalize et
          const normDays = (existing.days || [])
            .filter(Boolean)
            .map((d) => ({
              ...d,
              activities: Array.isArray(d.activities)
                ? d.activities
                : Array.isArray(d.items)
                ? d.items
                : [],
            }));
          setPlan({ ...existing, days: normDays });
        } else {
          let p = null;

          if (!scratchMode) {
            try {
              const tmp = await generatePlan(t, prefs, {
                useRealDirections: true,
                respectAnchors: true,
                splitByDays: true,
                maxPerDay: 12,
              });

              if (
                tmp &&
                (Array.isArray(tmp.days) || Array.isArray(tmp.items))
              ) {
                const days = Array.isArray(tmp.days) ? tmp.days : tmp.items;
                p = { ...tmp, days };
              }
            } catch (e) {
              console.warn('Plan generation failed', e);
            }
          }

          if (!p) {
            p = makeEmptyPlan(tripId);
          }

          p = { ...p, tripId: t.id || t._id, _id: `plan_${t.id || t._id}` };

          try {
            await savePlan(p);
          } catch {
            // offline vs olabilir, sorun değil
          }

          setPlan(p);
        }
      } catch (e) {
        console.warn('Load error', e);
        Alert.alert('Hata', 'Plan yüklenemedi.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, prefs, route, setTrip, setPlan, setLoading]);
}
