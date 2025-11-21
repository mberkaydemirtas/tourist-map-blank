// src/components/timeline/SideTimeline/helpers.js
const FG = '#111827';
const FG_MUTED = '#6B7280';
const CARD_BG = '#FFFFFF';
const BORDER = '#E5E7EB';
const PRIMARY = '#111827';
const ACCENT = '#2563EB';

const TITLE_MAX_LINES = 3;
const TITLE_FONT = 12.5;
const ROW_TAIL_W = 28;
const ROW_TAIL_PAD = ROW_TAIL_W + 12;

function getAnchorKind(item) {
  return item?.anchorKind || item?.meta?.category || null;
}
function isAnchorItem(it) {
  return it?.type === 'anchor' || it?.meta?.isAnchor;
}
function rowName(item, index) {
  if (isAnchorItem(item)) {
    const kind = getAnchorKind(item);
    if (kind === 'start') return 'Başlangıç';
    if (kind === 'end') return 'Bitiş';
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
function extractCoord(any) {
  const c = any?.place?.location || any?.location || any?.coords || any?.coord || any?.geometry;
  if (!c) return null;
  const lat = c.lat ?? c.latitude ?? c?.location?.lat ?? c?.location?.latitude;
  const lng = c.lon ?? c.lng ?? c.longitude ?? c?.location?.lng ?? c?.location?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lon: lng };
  return null;
}

module.exports = {
  FG,
  FG_MUTED,
  CARD_BG,
  BORDER,
  PRIMARY,
  ACCENT,
  TITLE_MAX_LINES,
  TITLE_FONT,
  ROW_TAIL_W,
  ROW_TAIL_PAD,
  getAnchorKind,
  isAnchorItem,
  rowName,
  extractCoord,
};
