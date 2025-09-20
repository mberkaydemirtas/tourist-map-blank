// trips/src/shared/validators/tripDates.js
// Tiny, dependency-free validator for trip date logic.

const toISODate = (d) => {
  // Accept Date, string, or number. Normalize to 'YYYY-MM-DD' in local time.
  const date = (d instanceof Date) ? d : new Date(d);
  if (Number.isNaN(+date)) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Validate a single segment: { cityId, start, end }
export function validateSegment(segment, idx = 0) {
  const issues = [];
  const s = toISODate(segment?.start);
  const e = toISODate(segment?.end);

  if (!s) issues.push({ code: 'SEGMENT_START_MISSING', idx, message: `Segment #${idx+1}: start date is missing or invalid.` });
  if (!e) issues.push({ code: 'SEGMENT_END_MISSING',   idx, message: `Segment #${idx+1}: end date is missing or invalid.` });

  if (s && e) {
    if (s > e) {
      issues.push({
        code: 'SEGMENT_START_AFTER_END',
        idx,
        message: `Segment #${idx+1}: start (${s}) cannot be after end (${e}).`
      });
    }
  }

  return issues;
}

// Validate an itinerary: [{ cityId, start, end }, ...] in the display order.
export function validateItinerary(segments) {
  const problems = [];

  // Per-segment checks
  segments.forEach((seg, i) => problems.push(...validateSegment(seg, i)));

  // Cross-segment continuity (end[i] === start[i+1])
  for (let i = 0; i < segments.length - 1; i++) {
    const curEnd = toISODate(segments[i]?.end);
    const nextStart = toISODate(segments[i+1]?.start);
    if (curEnd && nextStart) {
      if (curEnd !== nextStart) {
        problems.push({
          code: 'SEGMENT_MISMATCH_BOUNDARY',
          pair: [i, i+1],
          message: `Segment #${i+1} end (${curEnd}) must exactly equal Segment #${i+2} start (${nextStart}).`
        });
      }
    }
  }

  // Optional: detect overlaps (curEnd > nextStart) or gaps (curEnd < nextStart) separately
  // (Only needed if you plan to allow but warn.)
  for (let i = 0; i < segments.length - 1; i++) {
    const curEnd = toISODate(segments[i]?.end);
    const nextStart = toISODate(segments[i+1]?.start);
    if (curEnd && nextStart) {
      if (curEnd > nextStart) {
        problems.push({
          code: 'OVERLAP',
          pair: [i, i+1],
          message: `Segments #${i+1} and #${i+2} overlap (end ${curEnd} is after start ${nextStart}).`
        });
      }
      if (curEnd < nextStart) {
        problems.push({
          code: 'GAP',
          pair: [i, i+1],
          message: `Segments #${i+1} and #${i+2} have a gap (end ${curEnd} is before start ${nextStart}).`
        });
      }
    }
  }

  return problems;
}
