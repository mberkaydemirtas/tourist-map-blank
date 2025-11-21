// trips/hooks/parts/useTripAndPlan.js
import { useState, useEffect, useMemo } from 'react';
import { Alert, BackHandler, Platform, UIManager } from 'react-native';

import { getTripLocal, patchTripLocal } from '../../../app/lib/tripsLocal';
import { getPlanByTripId, savePlan } from '../../shared/plansRepo';
import { generatePlan } from '../../services/planService';
import { getAnchorsForDayDetailed } from '../../shared/anchors';

import {
  uid,
  toISODateSafe,
  addDaysISO,
  sanitizeIsoDate,
  deriveLodgeFromTrip,
  ensureResolvedForPlan,
} from '../../components/TripPlanHelpers';

/**
 * Boş (scratch) plan üret
 */
function makeEmptyPlan(tripId) {
  const todayISO = new Date().toISOString().slice(0, 10);
  return {
    _id: `plan_${tripId}`,
    id: `plan_${tripId}`,
    tripId,
    days: [{ id: uid(), date: todayISO, activities: [] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'scratch',
  };
}

/**
 * Trip + Plan yükleme ve back navigation davranışı
 * - Trip tarihlerini sanitize eder
 * - ensureResolvedForPlan ile place’leri çözer
 * - Var olan planı yükler, yoksa generatePlan + savePlan
 * - Back tuşu → her zaman TripsHome’a döner
 */
export function useTripAndPlan({ tripId, navigation, route, prefs }) {
  const [loading, setLoading] = useState(true);
  const [trip, setTrip] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dayIndex, setDayIndex] = useState(0);

  // Android LayoutAnimation enable (burada da dursa sorun yok; idempotent)
  if (
    Platform.OS === 'android' &&
    UIManager.setLayoutAnimationEnabledExperimental
  ) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  /* ------------ Back tuşu override ------------ */

  useEffect(() => {
    const onBack = () => {
      navigation.navigate('TripsHome');
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      const t = e.data?.action?.type;
      if (t !== 'GO_BACK' && t !== 'POP') return;
      const routes = navigation.getState()?.routes || [];
      const hasHomeBelow = routes.some(
        (r, i) => r.name === 'TripsHome' && i < routes.length - 1
      );
      if (hasHomeBelow) return;
      e.preventDefault();
      navigation.navigate('TripsHome');
    });
    return sub;
  }, [navigation]);

  /* ------------ Trip & Plan yükleme ------------ */

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        let t = await getTripLocal(tripId);
        if (!t) {
          Alert.alert('Plan', 'Trip bulunamadı.');
          setLoading(false);
          return;
        }

        // Tarih alanlarını düzelt
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

        if (patched) {
          try {
            await patchTripLocal(t._id ?? t.id, {
              dateRange: t.dateRange ?? null,
              _startEndSingle: t._startEndSingle ?? null,
              _startEndByCity: t._startEndByCity ?? null,
              updatedAt: new Date().toISOString(),
              __dirty: true,
            });
          } catch {}
          try {
            t = (await getTripLocal(t._id ?? t.id)) || t;
          } catch {}
        }

        // Yerler çözülmemişse resolve et
        t = await ensureResolvedForPlan(t);
        setTrip(t);

        // Plan
        const existing = await getPlanByTripId(tripId);
        const scratchMode = route?.params?.mode === 'scratch';

        if (existing?.days?.length && !scratchMode) {
          const normDays = (existing.days || []).filter(Boolean).map((d) => ({
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
          if (!p) p = makeEmptyPlan(tripId);
          p = { ...p, tripId: t.id || t._id, _id: `plan_${t.id || t._id}` };
          try {
            await savePlan(p);
          } catch {}
          setPlan(p);
        }
      } catch (e) {
        console.warn('Load error', e);
        Alert.alert('Hata', 'Plan yüklenemedi.');
      } finally {
        setLoading(false);
      }
    })();
  }, [tripId, prefs, route?.params?.mode]);

  /* ------------ Gün objesi ------------ */

  const day = useMemo(
    () => (plan?.days || [])[dayIndex] || null,
    [plan, dayIndex]
  );

  return {
    loading,
    trip,
    setTrip,
    plan,
    setPlan,
    dayIndex,
    setDayIndex,
    day,
  };
}
