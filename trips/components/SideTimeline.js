import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Animated, Easing, Alert } from 'react-native';
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

/* ---------- helpers ---------- */
function getAnchorKind(item) {
  return item?.anchorKind || item?.meta?.category || null; // 'start' | 'end' | 'lodging'
}
function isAnchorItem(it) {
  return it?.type === 'anchor' || it?.meta?.isAnchor;
}
function rowName(item, index) {
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
function extractCoord(any) {
  const c = any?.place?.location || any?.location || any?.coords || any?.coord || any?.geometry;
  if (!c) return null;
  const lat = c.lat ?? c.latitude ?? c?.location?.lat ?? c?.location?.latitude;
  const lng = c.lon ?? c.lng ?? c.longitude ?? c?.location?.lng ?? c?.location?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') return { lat, lon: lng };
  return null;
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
  const trans = { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }], opacity: a };
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
  const trans = { transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }], opacity: a };
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
function LegConnector({ label, onPress }) {
  if (!label) return null;
  return (
    <View style={styles.legWrap}>
      <View style={styles.legLine} />
      <Pressable onPress={onPress} style={styles.legBtn} hitSlop={6} accessibilityLabel={`${label} arasını göster`}>
        <Ionicons name="git-commit-outline" size={14} color="#1D4ED8" />
        <Text style={styles.legTxt}>{label}</Text>
      </Pressable>
      <View style={styles.legLine} />
    </View>
  );
}

function AnchorBadge({ kind }) {
  const map = {
    start:   { bg: '#10B981', icon: 'play' },
    lodging: { bg: '#7C3AED', icon: 'home' },
    end:     { bg: '#EF4444', icon: 'stop' },
  };
  const k = map[kind] || map.start;
  return (
    <View style={[styles.anchorBadge, { backgroundColor: k.bg }]}>
      <Ionicons name={k.icon} size={12} color="#fff" />
    </View>
  );
}

/** Sağda küçük “Rota” butonu (anchor satırları için) */
function AnchorRouteButton({ onPress }) {
  if (!onPress) return null;
  return (
    <View style={styles.rowTailAbs}>
      <Pressable
        onPress={onPress}
        style={[styles.kebabBtn, { backgroundColor: '#DCF1FF', borderColor: '#B6E0FF' }]}
        hitSlop={8}
        accessibilityLabel="Rota"
      >
        <Ionicons name="navigate-outline" size={16} color="#0C4A6E" />
      </Pressable>
    </View>
  );
}

function RowCore({
  item, index, selected,
  onPress, onReplace, onDeleteAsk,
  drag, isActive, onOpenMenu,
  onAnchorRoute
}) {
  const order = (index ?? 0) + 1;
  const name = rowName(item, index);
  const isAnchor = isAnchorItem(item);
  const time = (!isAnchor && item?.start && item?.end) ? `${item.start} – ${item.end}` : null;
  const anchorKind = getAnchorKind(item);
  const category = isAnchor ? (anchorKind?.toUpperCase?.() || 'ANCHOR') : (item?.place?.category || item?.meta?.category || item?.type || '');
  const longTitle = String(name).length > 34;
  const displayTitle = name;

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
        <View style={styles.rowLead}>
          {isAnchor ? <AnchorBadge kind={anchorKind} /> : <View style={styles.badge}><Text style={styles.badgeTxt}>{order}</Text></View>}
        </View>
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
        {isAnchor
          ? <AnchorRouteButton onPress={onAnchorRoute} />
          : (
            <View style={styles.rowTailAbs}>
              <Pressable onPress={() => onOpenMenu?.(name, onReplace, onDeleteAsk)} style={styles.kebabBtn} hitSlop={8} accessibilityLabel="Seçenekler">
                <Ionicons name="ellipsis-vertical" size={16} color="#374151" />
              </Pressable>
            </View>
          )
        }
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
  selectedActivityId,

  // yalnız kamera pan/zoom için tercih edilen yeni API
  onFocus, // ({coord, kind, index, item})

  // geriye uyumluluk (opsiyonel)
  onSelect,

  onInsertAt,
  onEditAt,
  onDeleteAt,
  onReorder,
  insertMode = false,
  onPickInsertIndex,

  // legacy tek-adımlı leg: i -> i+1
  onPickLeg,

  // koordinat tabanlı çift uç
  onPickLegPair,

  // legacy anchor komşuları (fallback)
  onPickStartLeg,
  onPickEndLeg,
  onPickLodgingLeg,

  // anchor verileri
  startAnchor,
  endAnchor,
  lodgingAnchor,
}) {
  const days = plan?.days || [];
  const day = days[dayIndex] || null;

  // ---- key çakışmalarını önlemek için stabil tekil _key üret ----
  function coordSig(a) {
    const c = extractCoord(a);
    return c ? `${Number(c.lat).toFixed(5)},${Number(c.lon).toFixed(5)}` : '';
  }
  function computeUniqueKeys(list) {
    const seen = new Map(); // baseKey -> count
    return (list || []).map((a, i) => {
      const base =
        a?._key ||
        a?.id ||
        a?.place?.place_id ||
        coordSig(a) ||
        `idx:${i}`;
      const count = (seen.get(base) || 0) + 1;
      seen.set(base, count);
      const uniq = count === 1 ? base : `${base}#${count}`;
      return { ...a, _key: uniq };
    });
  }
  const acts = computeUniqueKeys(day?.activities || []);

  function coordsEqual(a, b) {
    const alon = a?.lon ?? a?.lng;
    const blon = b?.lon ?? b?.lng;
    return (a?.lat === b?.lat) && (alon === blon);
  }

  const startIsLodge = startAnchor?.location && lodgingAnchor?.location && coordsEqual(startAnchor.location, lodgingAnchor.location);
  const endIsLodge   = endAnchor?.location   && lodgingAnchor?.location && coordsEqual(endAnchor.location, lodgingAnchor.location);

  const makeAnchorItem = (k, a) => a ? ({
    id: `anchor:${k}`,
    type: 'anchor',
    anchorKind: k,
    label:
      k === 'lodging' ? 'Konaklama'
      : (k === 'start' ? (startIsLodge ? 'Konaklama' : 'Başlangıç')
      : (endIsLodge   ? 'Konaklama' : 'Bitiş')),
    place: { name: (k === 'lodging' ? 'Konaklama' : (a.label || '')), location: a.location },
    _key: `anchor:${k}`,
  }) : null;

  function lodgingShouldAdd(start, end, lodging) {
    if (!lodging?.location) return false;
    return !coordsEqual(lodging.location, start?.location) &&
           !coordsEqual(lodging.location, end?.location);
  }
  const lodgingAdd = lodgingShouldAdd(startAnchor, endAnchor, lodgingAnchor)
    ? makeAnchorItem('lodging', lodgingAnchor)
    : null;

  const actsContainAnchors = acts.some(a => isAnchorItem(a));
  const listData = actsContainAnchors
    ? acts
    : [
        makeAnchorItem('start', startAnchor),
        ...acts,
        lodgingAdd,
        makeAnchorItem('end', endAnchor),
      ].filter(Boolean);

  if (!isOpen) return <View style={styles.closedStrip} />;

  const startAnchorExists = !!(listData.length && isAnchorItem(listData[0]) && getAnchorKind(listData[0]) === 'start');
  const actOffset = startAnchorExists ? 1 : 0;
  const actCount = acts.length;

  const [sheetVisible, setSheetVisible] = useState(false);
  const sheetCallbacks = useRef({ onReplace: null, onDeleteAsk: null });
  const [sheetTitle, setSheetTitle] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const confirmCb = useRef({ onConfirm: null });

  useEffect(() => { setSheetVisible(false); setConfirmVisible(false); }, [dayIndex]);

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

  // ---- koordinat tabanlı uç objesi
  const asLegEndpoint = (it) => {
    const coord = extractCoord(it);
    const kind  = isAnchorItem(it) ? getAnchorKind(it) : 'activity';
    return coord ? { kind, loc: coord } : null;
  };

  /* ---------- pair caller (tek nokta) ---------- */
  function callPair(fromListIdx, toListIdx) {
    const fromItem = listData[fromListIdx];
    const toItem   = listData[toListIdx];

    // Yeni: koordinat tabanlı çift uç gönder
    if (typeof onPickLegPair === 'function') {
      const fromEp = asLegEndpoint(fromItem);
      const toEp   = asLegEndpoint(toItem);
      if (fromEp && toEp) {
        onPickLegPair({ from: fromEp, to: toEp });
        return;
      }
    }

    // ---- Fallback: eski indeks tabanlı handler'lar ----
    const fromIsAnchor = isAnchorItem(fromItem);
    const toIsAnchor   = isAnchorItem(toItem);

    let from = fromIsAnchor ? -1 : (fromListIdx - actOffset);
    let to   = toIsAnchor   ? actCount : (toListIdx  - actOffset);
    if (!Number.isFinite(from)) from = -1;
    if (!Number.isFinite(to))   to   = actCount;

    if (!fromIsAnchor && !toIsAnchor) {
      if (to === from + 1) onPickLeg?.(from);
      return;
    }
    if (fromIsAnchor && !toIsAnchor) {
      const k = getAnchorKind(fromItem);
      if (k === 'start')   return onPickStartLeg?.(to);
      if (k === 'lodging') return onPickLodgingLeg?.('after', to);
      if (k === 'end')     return onPickEndLeg?.(to - 1);
      return;
    }
    if (!fromIsAnchor && toIsAnchor) {
      const k = getAnchorKind(toItem);
      if (k === 'end')     return onPickEndLeg?.(from);
      if (k === 'lodging') return onPickLodgingLeg?.('before', from);
      if (k === 'start')   return onPickStartLeg?.(from + 1);
    }
  }

  /* ---------- connector (i & i+1) ---------- */
  const renderConnectorBetween = (leftIdx) => {
    if (leftIdx < 0 || leftIdx >= listData.length - 1) return null;
    const a = listData[leftIdx];
    const b = listData[leftIdx + 1];

    // Etiketleri listedeki "anchor olmayan"ları sayarak üret
    const anchorShort = (k) => (k === 'start' ? '0' : k === 'end' ? 'B' : 'K'); // lodging=K
    const ordinalAt = (idx) => {
      let c = 0;
      for (let i = 0; i <= idx; i++) if (!isAnchorItem(listData[i])) c++;
      return c; // 1..n
    };
    const labelFor = (item, idx) => {
      if (isAnchorItem(item)) return anchorShort(getAnchorKind(item));
      return String(ordinalAt(idx));
    };
    const leftLabel  = labelFor(a, leftIdx);
    const rightLabel = labelFor(b, leftIdx + 1);
    const label = `${leftLabel} → ${rightLabel}`;

    return <LegConnector key={`leg-${leftIdx}`} label={label} onPress={() => callPair(leftIdx, leftIdx + 1)} />;
  };

  const renderItem = ({ item, index, drag, isActive, getIndex }) => {
    const listIdx = Number.isFinite(index) ? index : (typeof getIndex === 'function' ? (getIndex() ?? 0) : 0);
    const isAnchor = isAnchorItem(item);
    const selected = !isAnchor && selectedActivityId && item?.id === selectedActivityId;
    const onInsert = insertMode ? onPickInsertIndex : onInsertAt;

    /* ---- satır tıklama: SADECE pan/zoom ---- */
    const onPress = () => {
      const coord = extractCoord(item);
      const kind  = isAnchor ? getAnchorKind(item) : null;
      const actIndex = isAnchor ? -1 : (listIdx - actOffset);

      if (typeof onFocus === 'function') {
        onFocus({ coord, kind, index: actIndex, item });
      } else if (typeof onSelect === 'function') {
        onSelect({ coordOnly: true, coord, index: actIndex, item, source: 'timeline' });
      }
    };

    /* ---- anchor "Rota" butonu ---- */
    let onAnchorRoute = null;
    if (isAnchor) {
      const k = getAnchorKind(item);
      const next = listData[listIdx + 1];
      const prev = listData[listIdx - 1];

      if (k === 'start' && next && !isAnchorItem(next)) {
        onAnchorRoute = () => callPair(listIdx, listIdx + 1);     // 0 -> 1
      } else if (k === 'end' && prev && !isAnchorItem(prev)) {
        onAnchorRoute = () => callPair(listIdx - 1, listIdx);      // (n-1) -> B
      } else if (k === 'lodging') {
        const hasNext = next && !isAnchorItem(next);
        const hasPrev = prev && !isAnchorItem(prev);
        if (hasPrev && hasNext) {
          // İki yön var: kullanıcıya sor
          const fromReal = (listIdx - 1) - actOffset;
          const toReal   = (listIdx + 1) - actOffset;
          onAnchorRoute = () => {
            const beforeLabel = `Durak ${fromReal + 1} → Konaklama`;
            const afterLabel  = `Konaklama → Durak ${toReal + 1}`;
            Alert.alert('Rota', 'Hangi yön?', [
              { text: beforeLabel, onPress: () => callPair(listIdx - 1, listIdx) },
              { text: afterLabel,  onPress: () => callPair(listIdx, listIdx + 1) },
              { text: 'Vazgeç', style: 'cancel' },
            ]);
          };
        } else if (hasNext) {
          onAnchorRoute = () => callPair(listIdx, listIdx + 1);
        } else if (hasPrev) {
          onAnchorRoute = () => callPair(listIdx - 1, listIdx);
        }
      }
    }

    return (
      <View key={item._key}>
        <RowCore
          item={item}
          index={isAnchor ? listIdx : (listIdx - actOffset)}
          selected={!!selected}
          onPress={onPress}
          onReplace={isAnchor ? undefined : () => onEditAt?.(listIdx - actOffset)}
          onDeleteAsk={isAnchor ? undefined : () => {
            const nm = rowName(item, listIdx);
            const realIdx = listIdx - actOffset;
            askDelete(nm, realIdx);
          }}
          drag={isAnchor ? undefined : drag}
          isActive={isActive}
          onOpenMenu={isAnchor ? undefined : openMenu}
          onAnchorRoute={onAnchorRoute}
        />

        {renderConnectorBetween(listIdx)}

        <Separator
          insertIndex={Math.max(0, listIdx + 1 - actOffset)}
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
          const fromIsAnchor = isAnchorItem(listData[from]);
          const toIsAnchor   = isAnchorItem(listData[to]);
          if (fromIsAnchor || toIsAnchor) return;
          const adjFrom = from - actOffset;
          const adjTo   = to   - actOffset;
          if (adjFrom != null && adjTo != null) onReorder?.(adjFrom, adjTo);
        }}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
        extraData={dayIndex}
      />
    );

  return (
    <View style={styles.openWrap}>
      {renderDraggable || (
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
          {listData.map((item, index) => renderItem({ item, index }))}
          {(day?.activities || []).length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Bu günde aktivite yok.</Text>
            </View>
          )}
        </View>
      )}

      <MiniSheet
        visible={sheetVisible}
        title={sheetTitle}
        onReplace={() => sheetCallbacks.current.onReplace?.()}
        onDeleteAsk={() => sheetCallbacks.current.onDeleteAsk?.()}
        onClose={closeMenu}
      />

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
