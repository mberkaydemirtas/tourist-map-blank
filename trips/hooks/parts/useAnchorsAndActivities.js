// trips/hooks/parts/useAnchorsAndActivities.js
import { useMemo, useCallback } from 'react';

import { getAnchorsForDayDetailed } from '../../shared/anchors';
import {
  deriveLodgeFromTrip,
  uiActivitiesRawFn,
  startEndForDay,
  round5k,
} from '../../components/TripPlanHelpers';

/**
 * Anchor bilgisi + uiActivities + uiToReal/guardAnchorAction
 * Eski useTripPlansLogic içindeki blok aynen taşındı.
 */
export function useAnchorsAndActivities({ trip, plan, dayIndex }) {
  // Gün
  const day = useMemo(
    () => (plan?.days || [])[dayIndex] || null,
    [plan, dayIndex]
  );

  // Anchor bilgisi
  const anchorInfo = useMemo(() => {
    if (!trip || !day)
      return {
        start: null,
        end: null,
        lodge: null,
        startLabel: 'Başlangıç',
        endLabel: 'Bitiş',
        lodgeLabel: 'Konaklama',
      };

    let ai = {};
    try {
      ai = getAnchorsForDayDetailed(trip, day) || {};
    } catch {
      ai = {};
    }

    const se = startEndForDay(trip, day) || {};
    const start = ai.start ?? se.start ?? null;
    const end = ai.end ?? se.end ?? null;
    const lodge =
      ai.lodge ?? ai.lodging ?? deriveLodgeFromTrip(trip, day) ?? null;

    return {
      start,
      end,
      lodge,
      startLabel: ai.startLabel || 'Başlangıç',
      endLabel: ai.endLabel || 'Bitiş',
      lodgeLabel: 'Konaklama',
    };
  }, [trip, day]);

  // UI Activities (anchor'lar + aktiviteler birleştirilmiş)
  const uiActivities = useMemo(() => {
    if (!plan || !Array.isArray(plan?.days)) return [];
    const d = plan.days[dayIndex];
    if (!d) return [];
    return uiActivitiesRawFn(trip, d, {
      start: anchorInfo.start,
      end: anchorInfo.end,
      lodge: anchorInfo.lodge,
      startLabel: anchorInfo.startLabel,
      endLabel: anchorInfo.endLabel,
    });
  }, [plan, dayIndex, trip, anchorInfo]);

  // Lokasyon signature (segment cache için)
  const locSig = useMemo(
    () =>
      uiActivities
        .map((a) => {
          const l = a?.place?.location;
          return l ? `${round5k(l.lat)}:${round5k(l.lon)}` : 'x';
        })
        .join('|'),
    [uiActivities]
  );

  // UI index → gerçek activity index
  const uiToReal = useCallback(
    (uiIndex) => {
      const hasStart =
        uiActivities.length &&
        uiActivities[0]?.meta?.isAnchor &&
        uiActivities[0]?.meta?.category === 'start';
      const hasEnd =
        uiActivities.length &&
        uiActivities[uiActivities.length - 1]?.meta?.isAnchor &&
        uiActivities[uiActivities.length - 1]?.meta?.category === 'end';

      if (hasStart && uiIndex === 0) return null;
      if (hasEnd && uiIndex === uiActivities.length - 1) return null;

      return uiIndex - (hasStart ? 1 : 0);
    },
    [uiActivities]
  );

  const guardAnchorAction = (uiIndex) => uiToReal(uiIndex) == null;

  return {
    day,
    anchorInfo,
    uiActivities,
    locSig,
    uiToReal,
    guardAnchorAction,
  };
}
