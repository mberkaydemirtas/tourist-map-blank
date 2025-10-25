// trips/components/SideTimeline.js
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Animated, Easing } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

let DraggableFlatList;
try { DraggableFlatList = require('react-native-draggable-flatlist').default; } catch {}

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

function rowName(item, index) {
  // Anchor satırları için sabit isim; normal duraklar için varolan mantık
  if (item?.type === 'anchor') {
    if (item.anchorKind === 'start') return item.label || 'Başlangıç';
    if (item.anchorKind === 'end')   return item.label || 'Bitiş';
    if (item.anchorKind === 'lodging') return item.label || 'Konaklama';
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

/* ---------- Confirm Dialog (custom) ---------- */
function ConfirmDialog({ visible, title, message, confirmText = 'Sil', cancelText = 'Vazgeç', onConfirm, onCancel }) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 160 : 120,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const trans = { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] , opacity: a };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <Animated.View style={[styles.dialogCard, trans]}>
          {!!title && <Text style={styles.dialogTitle}>{title}</Text>}
          {!!message && <Text style={styles.dialogMsg}>{message}</Text>}
          <View style={styles.dialogBtns}>
            <Pressable onPress={onCancel} style={[styles.dBtn, styles.dCancel]}>
              <Text style={styles.dCancelTxt}>{cancelText}</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={[styles.dBtn, styles.dDanger]}>
              <Ionicons name="trash-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.dDangerTxt}>{confirmText}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ---------- Mini Bottom Sheet (ortak görünüm) ---------- */
function MiniSheet({ visible, title, onReplace, onDeleteAsk, onClose }) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 140,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const trans = {
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
    opacity: a,
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop} pointerEvents="box-none">
        <Pressable style={styles.sheetTapCatcher} onPress={onClose} />
        <Animated.View style={[styles.sheetCard, trans]}>
          {!!title && <Text style={styles.sheetTitle} numberOfLines={2}>{title}</Text>}

          <Pressable style={styles.sheetItem} onPress={() => { onClose?.(); onReplace?.(); }}>
            <Ionicons name="swap-horizontal-outline" size={18} color={FG} style={{ marginRight: 10 }} />
            <Text style={styles.sheetText}>Değiştir</Text>
          </Pressable>

          <Pressable style={[styles.sheetItem, { backgroundColor: '#FEF2F2' }]} onPress={() => { onClose?.(); onDeleteAsk?.(); }}>
            <Ionicons name="trash-outline" size={18} color="#B91C1C" style={{ marginRight: 10 }} />
            <Text style={[styles.sheetText, { color: '#B91C1C', fontWeight: '800' }]}>Sil</Text>
          </Pressable>

          <Pressable style={styles.sheetItem} onPress={onClose}>
            <Ionicons name="close" size={18} color={FG} style={{ marginRight: 10 }} />
            <Text style={styles.sheetText}>Kapat</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/* ---------- Leg Connector (i → i+1) ---------- */
function LegConnector({ fromIndex, onPickLeg }) {
  if (typeof fromIndex !== 'number') return null;
  const label = `${fromIndex + 1} → ${fromIndex + 2}`;
  return (
    <View style={styles.legWrap}>
      <View style={styles.legLine} />
      <Pressable
        onPress={() => onPickLeg?.(fromIndex)}
        style={styles.legBtn}
        hitSlop={6}
        accessibilityLabel={`${label} arasını göster`}
      >
        <Ionicons name="git-commit-outline" size={14} color="#1D4ED8" />
        <Text style={styles.legTxt}>{label}</Text>
      </Pressable>
      <View style={styles.legLine} />
    </View>
  );
}

function AnchorBadge({ kind }) {
  const map = {
    start: { bg: '#10B981', icon: 'play' },      // yeşil
    lodging: { bg: '#7C3AED', icon: 'home' },    // mor
    end:   { bg: '#EF4444', icon: 'stop' },      // kırmızı
  };
  const k = map[kind] || map.start;
  return (
    <View style={[styles.anchorBadge, { backgroundColor: k.bg }]}>
      <Ionicons name={k.icon} size={12} color="#fff" />
    </View>
  );
}

function RowCore({
  item, index, selected,
  onPress, onReplace, onDeleteAsk,
  drag, isActive, onOpenMenu
}) {
   const order = (index ?? 0) + 1;
   const name = rowName(item, index);
   const isAnchor = !!item?.meta?.isAnchor;
   const time = (!isAnchor && item?.start && item?.end) ? `${item.start} – ${item.end}` : null;
   const category = isAnchor ? (item.anchorKind?.toUpperCase?.() || 'ANCHOR') : (item?.place?.category || item?.meta?.category || item?.type || '');
   const longTitle = String(name).length > 34;
  const displayTitle = isAnchor ? name : `(${name})`;

  return (
    <View style={[styles.row, selected && styles.rowSelected, isActive && styles.rowDragging]}>
      <View style={styles.selStripe} pointerEvents="none" />

      <Pressable
        onPress={onPress}
        onLongPress={isAnchor ? undefined : drag}
        delayLongPress={isAnchor ? undefined : 160}
        android_ripple={{ color: BORDER }}
        style={styles.rowTap}
      >
        {/* Sol rozet */}
        <View style={styles.rowLead}>
          {isAnchor
            ? <AnchorBadge kind={item.anchorKind} />
            : <View style={styles.badge}><Text style={styles.badgeTxt}>{order}</Text></View>}
        </View>

        {/* Metin */}
        <View style={styles.textBlock}>
          <Text numberOfLines={TITLE_MAX_LINES} ellipsizeMode="tail" style={styles.title}>
            {displayTitle}
          </Text>

          {!longTitle && (
            <View style={styles.metaRow}>
              {time ? <Text numberOfLines={1} style={[styles.metaTime, { marginRight: 6 }]}>{time}</Text> : null}
              {category ? <Text numberOfLines={1} style={styles.metaChip}>{String(category).toUpperCase()}</Text> : null}
            </View>
          )}
        </View>

        {/* Sağ ⋮ menü — anchor için gizli */}
        {!isAnchor && (
          <View style={styles.rowTailAbs}>
            <Pressable
              onPress={() => onOpenMenu?.(name, onReplace, onDeleteAsk)}
              style={styles.kebabBtn}
              hitSlop={8}
              accessibilityLabel="Seçenekler"
            >
              <Ionicons name="ellipsis-vertical" size={16} color="#374151" />
            </Pressable>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function Separator({ insertIndex, onInsert, highlight }) {
  return (
    <View style={styles.sepWrap}>
      <View style={[styles.sepLine, highlight && { backgroundColor: '#11182722' }]} />
      <Pressable
        onPress={() => onInsert?.(insertIndex)}
        style={[styles.sepAddBtn, highlight && styles.sepAddBtnHL]}
        hitSlop={6}
      >
        <Ionicons name="add" size={14} color={highlight ? '#fff' : FG} />
        <Text style={[styles.sepAddTxt, highlight && { color: '#fff' }]}>
          {highlight ? 'Buraya ekle' : 'Durak ekle'}
        </Text>
      </Pressable>
      <View style={[styles.sepLine, highlight && { backgroundColor: '#11182722' }]} />
    </View>
  );
}

export default function SideTimeline({
  isOpen = true,
  plan,
  dayIndex = 0,
  setDayIndex,
  onSelect,
  selectedActivityId,
  onInsertAt,
  onEditAt,      // index → değiştir
  onDeleteAt,    // index → sil
  onReorder,
  insertMode = false,
  onPickInsertIndex,
  onCancelInsertMode,
  onPickLeg,     // i → i+1 arasını seç
  // 🔹 yeni: anchor’lar
  startAnchor,   // {label, location:{lat,lon}}
  endAnchor,     // {label, location:{lat,lon}}
  lodgingAnchor, // {label, location:{lat,lon}} (info amaçlı – aynı noktaysa start/end ile birleşik olabilir)
}) {
  const days = plan?.days || [];
  const day = days[dayIndex] || null;

  // Anchor’ları liste başı/sonuna koy
  const makeAnchorItem = (k, a) => a ? ({
    id: `anchor:${k}`,
    type: 'anchor',
    anchorKind: k,      // 'start' | 'end' | 'lodging'
    label: a.label || (k === 'start' ? 'Başlangıç' : k === 'end' ? 'Bitiş' : 'Konaklama'),
    place: { name: a.label, location: a.location },
    _key: `anchor:${k}`,
  }) : null;

  const acts = (day?.activities || []).map((a, i) => ({ ...a, _key: a?.id || String(i) }));
function coordsEqual(a, b) {
  return a?.lat === b?.lat && a?.lon === b?.lon;
}

function lodgingShouldAdd(start, end, lodging) {
  if (!lodging?.location) return false;
  return !coordsEqual(lodging.location, start?.location) &&
         !coordsEqual(lodging.location, end?.location);
}

const lodgingAdd = lodgingShouldAdd(startAnchor, endAnchor, lodgingAnchor)
  ? makeAnchorItem('lodging', lodgingAnchor)
  : null;
  

const listData = [
  makeAnchorItem('start', startAnchor),
  ...acts,
  lodgingAdd,
  makeAnchorItem('end', endAnchor),
].filter(Boolean);

  // Menu & Confirm state
  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetCallbacks = useRef({ onReplace: null, onDeleteAsk: null });
  const [sheetTitle, setSheetTitle] = useState('');

  const [confirmVisible, setConfirmVisible] = useState(false);
  const confirmCb = useRef({ onConfirm: null });

  const openMenu = (name, onReplace, onDeleteAsk) => {
    sheetCallbacks.current = { onReplace, onDeleteAsk };
    setSheetTitle(name || 'Durak');
    setSheetVisible(true);
  };
  const closeMenu = () => setSheetVisible(false);

  const askDelete = (name, index) => {
    setConfirmVisible(true);
    confirmCb.current.onConfirm = () => {
      setConfirmVisible(false);
      onDeleteAt?.(index);
    };
  };

  if (!isOpen) return <View style={styles.closedStrip} />;

  const renderItem = ({ item, index, drag, isActive, getIndex }) => {
    const safeIndex = Number.isFinite(index)
      ? index
      : typeof getIndex === 'function'
      ? getIndex() ?? 0
      : 0;

    const isAnchor = item?.type === 'anchor';
    const selected = !isAnchor && selectedActivityId && item?.id === selectedActivityId;
    const onInsert = insertMode ? onPickInsertIndex : onInsertAt;

    const onPress = () => {
      if (isAnchor) {
        // Anchor satırına tıklayınca haritada odaklan
        const coord = item?.place?.location;
        onSelect?.({ anchor: item.anchorKind, coord, source: 'timeline' });
      } else {
        onSelect?.({ index: safeIndex - (startAnchor ? 1 : 0), source: 'timeline' });
      }
    };

    return (
      <View key={item._key}>
        <RowCore
          item={item}
          index={isAnchor ? safeIndex : (safeIndex - (startAnchor ? 1 : 0))}
          selected={!!selected}
          onPress={onPress}
          onReplace={isAnchor ? undefined : () => onEditAt?.(safeIndex - (startAnchor ? 1 : 0))}
          onDeleteAsk={isAnchor ? undefined : () => askDelete(rowName(item, safeIndex), safeIndex - (startAnchor ? 1 : 0))}
          drag={isAnchor ? undefined : drag}
          isActive={isActive}
          onOpenMenu={isAnchor ? undefined : openMenu}
        />
        {/* Leg connector — anchor satırlarından sonra çizilmez */}
        {!isAnchor && (safeIndex < listData.length - 1) && (listData[safeIndex + 1]?.type !== 'anchor') && (
          <LegConnector fromIndex={(safeIndex - (startAnchor ? 1 : 0))} onPickLeg={onPickLeg} />
        )}
        {/* Ekle ayracı */}
        <Separator
          insertIndex={Math.max(0, safeIndex + 1 - (startAnchor ? 1 : 0))}
          onInsert={onInsert}
          highlight={insertMode}
        />
      </View>
    );
  };

  const renderDraggable =
    DraggableFlatList && (
      <DraggableFlatList
        data={listData}
        keyExtractor={(item) => item._key}
        activationDistance={12}
        onDragEnd={({ from, to }) => {
          // Anchor’lar sürüklenemez: güvenlik — drag’ler zaten anchor için kapalı.
          if (listData[from]?.type === 'anchor' || listData[to]?.type === 'anchor') return;
          const adjFrom = from - (startAnchor ? 1 : 0);
          const adjTo   = to   - (startAnchor ? 1 : 0);
          if (adjFrom != null && adjTo != null) onReorder?.(adjFrom, adjTo);
        }}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      />
    );

  return (
    <View style={styles.openWrap}>
      {renderDraggable || (
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          {listData.map((item, index) => renderItem({ item, index }))}
          {acts.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Bu günde aktivite yok.</Text>
            </View>
          )}
        </View>
      )}

      {/* MiniSheet */}
      <MiniSheet
        visible={sheetVisible}
        title={sheetTitle}
        onReplace={() => sheetCallbacks.current.onReplace?.()}
        onDeleteAsk={() => sheetCallbacks.current.onDeleteAsk?.()}
        onClose={closeMenu}
      />

      {/* Sil onayı */}
      <ConfirmDialog
        visible={confirmVisible}
        title="Durağı sil"
        message="Bu durağı silmek istediğine emin misin?"
        confirmText="Sil"
        cancelText="Vazgeç"
        onConfirm={() => confirmCb.current.onConfirm?.()}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    paddingRight: ROW_TAIL_PAD,
  },
  title: {
    color: FG,
    fontWeight: '800',
    fontSize: TITLE_FONT,
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
    right: 12,
    top: 12,
    bottom: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    marginHorizontal: 6,
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
    margin: 10,
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  sheetTitle: { color: FG, fontWeight: '800', fontSize: 14, marginBottom: 4 },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginVertical: 2,
  },
  sheetText: { color: FG, fontWeight: '800' },

  /* dialog */
  dialogBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  dialogCard: {
    width: '86%',
    maxWidth: 420,
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
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
