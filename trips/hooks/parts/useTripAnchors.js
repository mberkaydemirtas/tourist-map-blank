// trips/hooks/parts/useTripAnchors.js
import { useMemo, useCallback } from 'react';
import { getAnchorsForDayDetailed } from '../../shared/anchors';
import {
  deriveLodgeFromTrip,
  uiActivitiesRawFn,
  startEndForDay,
} from '../../components/TripPlanHelpers';

/**
 * Trip + plan + gün bilgisine göre:
 *  - anchorInfo (start / end / lodge + label’lar)
 *  - uiActivities (timeline için gösterilen liste)
 *  - uiToReal (UI index -> gerçek activity index)
 *  - guardAnchorAction (anchor’a dokunulmasın mı?)
 */
export function useTripAnchors({ trip, day, plan, dayIndex }) {
  // 1) Anchor bilgisi (start / end / lodge)
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

  // 2) UI aktiviteleri (anchor’lar dahil)
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

  // 3) UI index -> gerçek activity index
  const uiToReal = useCallback(
    (uiIndex) => {
      if (!uiActivities.length) return null;

      const hasStart =
        uiActivities[0]?.meta?.isAnchor &&
        uiActivities[0]?.meta?.category === 'start';
      const hasEnd =
        uiActivities[uiActivities.length - 1]?.meta?.isAnchor &&
        uiActivities[uiActivities.length - 1]?.meta?.category === 'end';

      if (hasStart && uiIndex === 0) return null;
      if (hasEnd && uiIndex === uiActivities.length - 1) return null;

      return uiIndex - (hasStart ? 1 : 0);
    },
    [uiActivities]
  );

  // 4) Anchor koruması
  const guardAnchorAction = useCallback(
    (uiIndex) => uiToReal(uiIndex) == null,
    [uiToReal]
  );

  return {
    anchorInfo,
    uiActivities,
    uiToReal,
    guardAnchorAction,
  };
}
