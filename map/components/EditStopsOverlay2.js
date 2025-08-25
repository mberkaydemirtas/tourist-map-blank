// src/components/EditStopsOverlay.js
import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, FlatList } from 'react-native';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

const USE_DRAGGABLE = true;

export default function EditStopsOverlay({
  visible,
  stops = [],                 // [from, ...waypoints, to]
  onClose,
  onConfirm,
  onDragEnd,                  // (fromIndex, toIndex) => void
  onDelete,                   // (index) => void
  onInsertAt,                 // (index) => void
  onReplaceAt,                // (index) => void
}) {
  // Stabil key üret
  const data = useMemo(() => {
    const seen = new Map();
    return (stops || []).map((s, i) => {
      const base = s?.place_id ?? (Number.isFinite(s?.lat) && Number.isFinite(s?.lng) ? `${s.lat},${s.lng}` : `idx-${i}`);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      const _key = n > 1 ? `${base}#${n}` : base;
      return { ...s, _key };
    });
  }, [stops]);

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
      onPress={() => {
        console.log('[Overlay] InsertBar press -> index=', index);
        onInsertAt?.(index);
      }}
      style={styles.insertBar}
    >
      <Text style={styles.insertText}>＋ Yeni durak buraya</Text>
    </TouchableOpacity>
  );

  const RowCore = ({ item, drag, isActive, i }) => {
    const canDelete   = !isFirst(i) && !isLast(i);
    const canReplace  = !isFirst(i);
    const dragDisabled = isFirst(i) || isLast(i);

    return (
      <View style={[styles.row, isActive && styles.rowActive]}>
        <TouchableOpacity
          style={[styles.dragHandle, dragDisabled && { opacity: 0.35 }]}
          onLongPress={drag}
          delayLongPress={120}
          disabled={!USE_DRAGGABLE || dragDisabled}
        >
          <Text style={styles.dragIcon}>≡</Text>
        </TouchableOpacity>

        <View style={styles.rowCenter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name || `Durak ${i + 1}`}
            </Text>
            <Label i={i} />
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.place_id
              ? `#${String(item.place_id).slice(0, 6)}`
              : `${(+item.lat).toFixed?.(5)}, ${(+item.lng).toFixed?.(5)}`}
          </Text>
        </View>

        <View style={styles.rowActions}>
          {canReplace && (
            <TouchableOpacity
              style={[styles.miniBtn, styles.replaceBtn]}
              onPress={() => {
                console.log('[Overlay] Replace press -> i=', i);
                onReplaceAt?.(i);
              }}
            >
              <Text style={styles.miniTxt}>Değiştir</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity
              style={[styles.miniBtn, styles.delBtn]}
              onPress={() => {
                console.log('[Overlay] Delete press -> i=', i);
                onDelete?.(i);
              }}
            >
              <Text style={[styles.miniTxt, styles.delTxt]}>Sil</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const getSafeIndex = (params) => {
    if (Number.isFinite(params.index)) return params.index;
    const k = params?.item?._key || params?.item?.key;
    const idx = data.findIndex((d) => d._key === k || d.key === k);
    return idx >= 0 ? idx : 0;
  };

  const renderItem = (params) => {
    const { item, drag, isActive } = params;
    const i = getSafeIndex(params);
    return (
      <View>
        <RowCore item={item} drag={drag} isActive={isActive} i={i} />
        {/* ⛔ Bitişin altında InsertBar yok */}
        {!isLast(i) && <InsertBar index={i + 1} />}
      </View>
    );
  };

  // ❗ Geçersiz drop’ta revert için küçük bir nonce
  const [dragNonce, setDragNonce] = useState(0);

  const ListBody = USE_DRAGGABLE ? DraggableFlatList : FlatList;

  const listProps = USE_DRAGGABLE
    ? {
        data,
        keyExtractor: (it) => it._key,
        renderItem,
        contentContainerStyle: styles.list,
        activationDistance: Platform.select({ ios: 12, android: 4 }),
        autoscrollThreshold: 40,
        autoscrollSpeed: 50,
        extraData: dragNonce,                     // 👈 revert tetikleyici
        onDragEnd: ({ from, to }) => {
          const lastIdx = data.length - 1;
          const midMin = 1;
          const midMax = Math.max(1, lastIdx - 1);

          // başlangıç/bitişten drag başlatılamaz (handle kapalı) ama yine de emniyet:
          if (from < midMin || from > midMax) {
            console.log('[Overlay] invalid drag FROM=', from, '→ revert');
            setDragNonce((n) => n + 1);
            return;
          }

          // hedefi orta aralığa kilitle
          const clampedTo = Math.max(midMin, Math.min(to, midMax));

          if (clampedTo !== to) {
            console.log('[Overlay] drop to out-of-bounds: to=', to, '→ clamp', clampedTo, 'and revert visual');
            // Görseli geri almak için nonce; sıralama parent’ta sadece geçerli aralıkta yapılır
            setDragNonce((n) => n + 1);
          }

          if (from !== clampedTo) {
            console.log('[Overlay] dragEnd apply', from, '→', clampedTo);
            onDragEnd?.(from, clampedTo);
          }
        },
        scrollEnabled: true,
        keyboardShouldPersistTaps: 'handled',
      }
    : {
        data,
        keyExtractor: (it) => it._key,
        renderItem,
        contentContainerStyle: styles.list,
        scrollEnabled: true,
      };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 18 : 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 6 },
  title: { fontSize: 16, fontWeight: '700', color: '#111', flex: 1 },
  closeBtn: { padding: 6, paddingHorizontal: 8 },
  closeTxt: { fontSize: 16, color: '#444' },

  list: { paddingHorizontal: 10, paddingBottom: 10 },

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
  rowTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  rowSub: { marginTop: 2, fontSize: 12, color: '#666' },

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
