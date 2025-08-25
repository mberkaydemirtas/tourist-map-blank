// src/components/EditStopsOverlay.js
import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  FlatList,
} from 'react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const USE_DRAGGABLE = true;

export default function EditStopsOverlay({
  visible,
  stops = [],                 // [from, ...waypoints, to]
  onClose,
  onConfirm,
  onDragEnd,                  // (fromIndex, toIndex) => void  -> GLOBAL index bekler
  onDelete,                   // (index) => void                -> GLOBAL index
  onInsertAt,                 // (index) => void                -> GLOBAL index (splice hedefi)
  onReplaceAt,                // (index) => void                -> GLOBAL index
}) {
  const insets = useSafeAreaInsets();

  // Stabil key üret
  const data = useMemo(() => {
    const seen = new Map();
    return (stops || []).map((s, i) => {
      const base =
        s?.place_id ??
        (Number.isFinite(s?.lat) && Number.isFinite(s?.lng)
          ? `${s.lat},${s.lng}`
          : `idx-${i}`);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const _key = n > 1 ? `${base}#${n}` : base;
      return { ...s, _key };
    });
  }, [stops]);

  const lastIdx = data.length - 1;
  const start   = data[0];
  const end     = data[lastIdx];
  const mids    = lastIdx >= 1 ? data.slice(1, lastIdx) : []; // sadece orta duraklar draggable

  const isFirst = (i) => i === 0;
  const isLast  = (i) => i === data.length - 1;

  const Label = ({ i }) => (
    <View style={styles.badgeWrap}>
      {isFirst(i) && <Text style={[styles.badge, styles.badgeStart]}>Başlangıç</Text>}
      {isLast(i)  && <Text style={[styles.badge, styles.badgeEnd]}>Bitiş</Text>}
    </View>
  );

  const InsertBar = ({ index }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onInsertAt?.(index)} // 👉 GLOBAL index (splice target)
      style={styles.insertBar}
    >
      <Text style={styles.insertText}>＋ Yeni durak buraya</Text>
    </TouchableOpacity>
  );

  // 🚩/🏁 uç noktalar – draggable değil, “buton/pill” görünüm
  const EndpointRow = ({ item, globalIndex }) => {
    const isStart = globalIndex === 0;
    return (
      <View
        style={[
          styles.endpointRow,
          isStart ? styles.endpointStart : styles.endpointEnd,
        ]}
      >
        <Text style={styles.endpointIcon}>{isStart ? '🚩' : '🏁'}</Text>
        <View style={styles.rowCenter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.endpointTitle} numberOfLines={1}>
              {item?.name || (isStart ? 'Başlangıç' : 'Bitiş')}
            </Text>
            <Label i={globalIndex} />
          </View>
          <Text style={styles.endpointSub} numberOfLines={1}>
            {item?.place_id
              ? `#${String(item.place_id).slice(0, 6)}`
              : `${(+item?.lat).toFixed?.(5)}, ${(+item?.lng).toFixed?.(5)}`}
          </Text>
        </View>
      </View>
    );
  };

  // Orta durak: draggable + aksiyonlar, GLOBAL index = midIndex + 1
  const WaypointRow = ({ item, drag, isActive, midIndex }) => {
    const globalIndex = midIndex + 1;
    return (
      <View style={[styles.row, isActive && styles.rowActive]}>
        <TouchableOpacity
          style={styles.dragHandle}
          onLongPress={drag}
          delayLongPress={120}
          disabled={!USE_DRAGGABLE}
        >
          <Text style={styles.dragIcon}>≡</Text>
        </TouchableOpacity>

        <View style={styles.rowCenter}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item?.name || `Durak ${globalIndex}`}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item?.place_id
              ? `#${String(item.place_id).slice(0, 6)}`
              : `${(+item?.lat).toFixed?.(5)}, ${(+item?.lng).toFixed?.(5)}`}
          </Text>
        </View>

        <View style={styles.rowActions}>
          <TouchableOpacity
            style={[styles.miniBtn, styles.replaceBtn]}
            onPress={() => onReplaceAt?.(globalIndex)}
          >
            <Text style={styles.miniTxt}>Değiştir</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.miniBtn, styles.delBtn]}
            onPress={() => onDelete?.(globalIndex)}
          >
            <Text style={[styles.miniTxt, styles.delTxt]}>Sil</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderMidItem = ({ item, drag, isActive, index: midIndex }) => {
    const globalIndex = midIndex + 1;
    return (
      <View>
        <WaypointRow
          item={item}
          drag={drag}
          isActive={isActive}
          midIndex={midIndex}
        />
        {/* Her orta durağın altına insert bar – globalIndex+1 hedefi */}
        <InsertBar index={globalIndex + 1} />
      </View>
    );
  };

  const listRef = useRef(null);
  const [dragNonce, setDragNonce] = useState(0);

  const ListBody = USE_DRAGGABLE ? DraggableFlatList : FlatList;

  const listProps = USE_DRAGGABLE
    ? {
        ref: listRef,
        data: mids,
        keyExtractor: (it, i) => it._key ?? `mid-${i}`,
        renderItem: renderMidItem,
        contentContainerStyle: styles.listInner,
        activationDistance: Platform.select({ ios: 12, android: 4 }),
        autoscrollThreshold: 40,
        autoscrollSpeed: 50,
        extraData: dragNonce,
        onDragEnd: ({ from, to }) => {
          if (from === to) return;
          const fromGlobal = from + 1;
          const toGlobal   = to + 1;
          onDragEnd?.(fromGlobal, toGlobal);
          setDragNonce((n) => n + 1);
        },
        scrollEnabled: true,
        keyboardShouldPersistTaps: 'handled',
        windowSize: 10,
        initialNumToRender: 8,
        maxToRenderPerBatch: 8,
        showsVerticalScrollIndicator: false,
        ListHeaderComponent: (
          <View style={styles.listHeader}>
            {start && <EndpointRow item={start} globalIndex={0} />}
            {/* ✅ Başlangıcın hemen ALTINDA insert bar */}
            <InsertBar index={1} />
          </View>
        ),
        ListFooterComponent: (
          <View style={[styles.listFooter, { paddingBottom: Math.max(insets.bottom, 0) } ]}>
            {end && <EndpointRow item={end} globalIndex={lastIdx} />}
            {/* Bitişten sonra insert bar YOK */}
          </View>
        ),
      }
    : {
        data: mids,
        keyExtractor: (it, i) => it._key ?? `mid-${i}`,
        renderItem: renderMidItem,
        contentContainerStyle: styles.listInner,
        scrollEnabled: true,
        showsVerticalScrollIndicator: false,
        ListHeaderComponent: (
          <View style={styles.listHeader}>
            {start && <EndpointRow item={start} globalIndex={0} />}
            <InsertBar index={1} />
          </View>
        ),
        ListFooterComponent: (
          <View style={[styles.listFooter, { paddingBottom: Math.max(insets.bottom, 0) } ]}>
            {end && <EndpointRow item={end} globalIndex={lastIdx} />}
          </View>
        ),
      };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 18 : 10) }]}>
            <View style={styles.header}>
              <Text style={styles.title}>Durakları düzenle</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeTxt}>✕</Text>
              </TouchableOpacity>
            </View>

            <ListBody {...listProps} />

            <View style={styles.footer}>
              <TouchableOpacity onPress={onClose} style={[styles.footerBtn, styles.cancel]}>
                <Text style={styles.footerTxt}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onConfirm} style={[styles.footerBtn, styles.confirm]}>
                <Text style={[styles.footerTxt, styles.confirmTxt]}>Güncelle</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/* ------------------------------- Styles ------------------------------- */
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', color: '#111', flex: 1 },
  closeBtn: { padding: 6, paddingHorizontal: 8 },
  closeTxt: { fontSize: 16, color: '#444' },

  listInner: { paddingHorizontal: 10, paddingBottom: 10 },
  listHeader: { paddingHorizontal: 0 },
  listFooter: { paddingHorizontal: 0 },

  insertBar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cfe8cf',
    backgroundColor: '#eef8ee',
    borderStyle: 'dashed',
    paddingVertical: 8,
    borderRadius: 10,
    marginVertical: 5,
    alignItems: 'center',
  },
  insertText: { fontSize: 12, fontWeight: '700', color: '#1E7E34' },

  // Uç noktalar
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  endpointStart: { backgroundColor: '#eef8ee', borderColor: '#cfe8cf' },
  endpointEnd:   { backgroundColor: '#eef5ff', borderColor: '#cfe0ff' },
  endpointIcon:  { fontSize: 18, marginRight: 10 },
  endpointTitle: { fontSize: 14, fontWeight: '800', color: '#111' },
  endpointSub:   { marginTop: 2, fontSize: 12, color: '#666' },

  // Orta duraklar
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafa',
    borderRadius: 12,
    padding: 10,
    marginVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5e5',
  },
  rowActive: { backgroundColor: '#eef5ff', borderColor: '#cfe0ff' },

  dragHandle: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f1f1f1', marginRight: 10,
  },
  dragIcon: { fontSize: 18, color: '#666' },

  rowCenter: { flex: 1 },
  rowTitle:  { fontSize: 14, fontWeight: '700', color: '#111' },
  rowSub:    { marginTop: 2, fontSize: 12, color: '#666' },

  badgeWrap: { flexDirection: 'row', gap: 6 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeStart: { backgroundColor: '#E6F4EA', color: '#1E7E34' },
  badgeEnd:   { backgroundColor: '#E8F1FF', color: '#1E88E5' },

  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  replaceBtn: { backgroundColor: '#eef5ff', borderColor: '#cfe0ff' },
  delBtn: { backgroundColor: '#fdecec', borderColor: '#f5c2c0' },
  miniTxt: { fontSize: 12, fontWeight: '700', color: '#111' },
  delTxt: { color: '#B42318' },

  footer: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 14, paddingTop: 8, gap: 10 },
  footerBtn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  cancel: { backgroundColor: '#f4f4f4' },
  confirm: { backgroundColor: '#E6F4EA' },
  footerTxt: { fontWeight: '700', color: '#111' },
  confirmTxt: { color: '#1E7E34' },
});
