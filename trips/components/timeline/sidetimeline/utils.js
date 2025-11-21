// src/components/timeline/SideTimeline/utils.js

// sabitler
export const FG = '#111827';
export const FG_MUTED = '#6B7280';
export const CARD_BG = '#FFFFFF';
export const BORDER = '#E5E7EB';
export const PRIMARY = '#111827';
export const ACCENT = '#2563EB';

export const TITLE_MAX_LINES = 3;
export const TITLE_FONT = 12.5;
export const ROW_TAIL_W = 28;
export const ROW_TAIL_PAD = ROW_TAIL_W + 12;

export function getAnchorKind(item) {
  return item?.anchorKind || item?.meta?.category || null; // 'start' | 'end' | 'lodging'
}

export function isAnchorItem(it) {
  return it?.type === 'anchor' || it?.meta?.isAnchor;
}

export function rowName(item, index) {
  if (isAnchorItem(item)) {
    const kind = getAnchorKind(item);
    if (kind === 'start')   return 'Başlangıç';
    if (kind === 'end')     return 'Bitiş';
    if (kind === 'lodging') return 'Konaklama';
  }
  return (
    item?.place?.name ||
    item?.place?.displayName ||
    item?.label ||
    item?.title ||
    item?.place?.formatted_address ||
    `Durak ${index + 1}`
  );
}

export function extractCoord(any) {
  const c = any?.place?.location || any?.location || any?.coords || any?.coord || any?.geometry;
  if (!c) return null;
  const lat = c.lat ?? c.latitude ?? c?.location?.lat ?? c?.location?.latitude;
  const lng = c.lon ?? c.lng ?? c.longitude ?? c?.location?.lng ?? c?.location?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lon: lng };
  return null;
}
