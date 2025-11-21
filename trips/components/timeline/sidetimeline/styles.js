// src/components/timeline/SideTimeline/styles.js
import { StyleSheet } from 'react-native';
import { ACCENT, BORDER, CARD_BG, FG, FG_MUTED, PRIMARY, ROW_TAIL_W } from './utils';

export const styles = StyleSheet.create({
  closedStrip: {
    width: 24,
    backgroundColor: CARD_BG,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: BORDER,
  },
  openWrap: { flex: 1, backgroundColor: CARD_BG },

  row: {
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EEF2F7',
    overflow: 'hidden',
    elevation: 2,
  },
  rowSelected: { backgroundColor: '#FFF6ED' },
  rowDragging: { opacity: 0.96, transform: [{ scale: 0.996 }] },

  selStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: ACCENT },

  rowTap: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },

  rowLead: {
    width: 22,
    alignItems: 'center',
    marginRight: 2,
    marginLeft: -10,
    paddingTop: 6,
  },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: PRIMARY,
  },
  badgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },

  anchorBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
  },

  textBlock: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
    paddingRight: ROW_TAIL_W + 12,
  },
  title: {
    color: FG,
    fontWeight: '800',
    fontSize: 12.5,
    lineHeight: 16.5,
    includeFontPadding: false,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  metaTime: { color: FG_MUTED, fontSize: 10.5, lineHeight: 14 },
  metaChip: {
    color: FG, fontSize: 9.5, fontWeight: '800', lineHeight: 13,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#F3F4F6',
  },

  rowTailAbs: {
    position: 'absolute',
    right: 12, top: 12, bottom: 12,
    width: ROW_TAIL_W,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  kebabBtn: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },

  /* Leg connector */
  legWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 6, paddingHorizontal: 10 },
  legLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  legBtn: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', marginHorizontal: 6,
  },
  legTxt: { marginLeft: 6, color: '#1D4ED8', fontWeight: '800', fontSize: 11 },

  /* Ekle ayracı */
  sepWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 10, paddingHorizontal: 10 },
  sepLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  sepAddBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF' },
  sepAddBtnHL: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  sepAddTxt: { color: FG, fontSize: 11, fontWeight: '700', marginLeft: 4 },

  empty: { padding: 12, alignItems: 'center' },
  emptyText: { color: FG_MUTED },

  /* sheet */
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetTapCatcher: { flex: 1 },
  sheetCard: {
    margin: 10, borderRadius: 14, backgroundColor: '#fff', padding: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    elevation: 10, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  sheetTitle: { color: FG, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  sheetItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, marginVertical: 2 },
  sheetText: { color: FG, fontWeight: '800' },

  /* dialog */
  dialogBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  dialogCard: {
    width: '86%', maxWidth: 420, borderRadius: 14, backgroundColor: '#fff', padding: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 10 },
  },
  dialogTitle: { color: FG, fontWeight: '800', fontSize: 16 },
  dialogMsg: { color: FG_MUTED, marginTop: 6 },
  dialogBtns: { marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  dBtn: { minHeight: 40, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  dCancel: { backgroundColor: '#F3F4F6' },
  dDanger: { backgroundColor: '#B91C1C' },
  dCancelTxt: { color: FG, fontWeight: '700' },
  dDangerTxt: { color: '#fff', fontWeight: '800' },
});
