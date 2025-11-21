// /trips/screens/TripPlanStyles
import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');

export const COLORS = {
  bgApp: '#F3F4F6',
  bgCard: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fgMuted: '#6B7280',
  primary: '#111827',
  accent: '#2563EB',
  accentDim: '#EFF6FF',
  warnSoftBg: '#FFF6ED',
  warnSoftBorder: '#FBD6B6',
  success: '#4CAF50',
  neutral: '#607D8B',
};

export const LEFT_OPEN_W = Math.min(380, SCREEN_W * 0.42);
export const LEFT_CLOSED_W = 0;
export const TOGGLE_PEEK = 12;
export const TOGGLE_SIZE = 44;

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bgApp },

  header: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    zIndex: 200,
    elevation: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6', marginRight: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  headerCity: { color: COLORS.fg, fontSize: 16, fontWeight: '800', lineHeight: 20 },
  headerDates: { color: COLORS.fgMuted, fontSize: 12, marginTop: 2 },

  quickLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    pointerEvents: 'box-none',
  },

  replanBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EEF2F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  replanText: { color: COLORS.fg, fontWeight: '800' },

  daysBar: {
    minHeight: 56,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 190,
    elevation: 7,
  },
  dayArrows: { width: 34, alignItems: 'center', justifyContent: 'center' },
  dayArrowBtn: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },

  dayChip: {
    marginHorizontal: 4,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  dayChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  dayChipText: { color: COLORS.fg, fontWeight: '700', fontSize: 12 },
  dayChipTextActive: { color: '#fff' },

  content: { flex: 1, flexDirection: 'row', position: 'relative' },

  side: {
    zIndex: 999,
    backgroundColor: COLORS.bgCard,
    borderRightWidth: 0,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 24,
  },

  iconOnlyBtn: {
    marginLeft: 8,
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#EEF2F7',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  searchBarWrap: {
    position: 'absolute', top: 12, left: 12, right: 12,
    zIndex: 2000, elevation: 2000,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  searchInput: { flex: 1, color: '#111' },
  searchCloseBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  toggleOverlay: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0, right: 0,
    justifyContent: 'center',
    zIndex: 10,
    elevation: 20,
    pointerEvents: 'box-none',
  },
  panelToggleWrapper: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -TOGGLE_SIZE / 2 }],
  },
  panelToggleHitZone: {
    width: TOGGLE_SIZE + 32,
    height: TOGGLE_SIZE + 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelToggle: {
    width: TOGGLE_SIZE, height: TOGGLE_SIZE, borderRadius: TOGGLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.bgCard,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },

  mapWrap: { backgroundColor: '#EEF2F7' },
  map: { flex: 1, zIndex: 0, elevation: 0 },

  numMarkerInner: {
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  numMarkerText: { color: '#fff', fontWeight: '800', fontSize: 13, includeFontPadding: false },
  numMarkerTip: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginTop: -1,
    borderTopColor: COLORS.accent,
  },

  calCard: {
    position: 'absolute',
    left: 16, right: 16, bottom: 24,
    backgroundColor: '#0D0F14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#23262F',
    padding: 8,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B0D12' },

  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});