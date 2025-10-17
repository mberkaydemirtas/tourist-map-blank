// trips/components/SideTimeline.js
import React from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform, ActionSheetIOS } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

let DraggableFlatList;
try { DraggableFlatList = require('react-native-draggable-flatlist').default; } catch {}

const FG = '#111827';
const FG_MUTED = '#6B7280';
const CARD_BG = '#FFFFFF';
const BORDER = '#E5E7EB';
const PRIMARY = '#111827';
const ACCENT = '#2563EB';

const TITLE_MAX_LINES = 3;         // 🔑 daha çok satır
const TITLE_FONT = 12.5;           // kompakt ama okunur
const ROW_TAIL_W = 28;             // 🔑 tek kebap menü → çok dar
const ROW_TAIL_PAD = ROW_TAIL_W + 12;

function rowName(item, index) {
  return (
    item?.place?.name ||
    item?.place?.displayName ||
    item?.label ||
    item?.title ||
    item?.place?.formatted_address ||
    `Durak ${index + 1}`
  );
}

function showRowMenu({ name, onEdit, onDelete }) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Vazgeç', 'Düzenle', 'Sil'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 0,
        title: name,
      },
      (i) => {
        if (i === 1) onEdit?.();
        if (i === 2) {
          Alert.alert('Durağı sil', `"${name}" silinsin mi?`, [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Sil', style: 'destructive', onPress: onDelete },
          ]);
        }
      }
    );
  } else {
    // Android
    Alert.alert(name || 'Durak', undefined, [
      { text: 'Düzenle', onPress: onEdit },
      { text: 'Sil', style: 'destructive', onPress: () => {
          Alert.alert('Durağı sil', `"${name}" silinsin mi?`, [
            { text: 'Vazgeç', style: 'cancel' },
            { text: 'Sil', style: 'destructive', onPress: onDelete },
          ]);
        } 
      },
      { text: 'Kapat', style: 'cancel' },
    ]);
  }
}

function RowCore({ item, index, selected, onPress, onEdit, onDelete, drag, isActive }) {
  const order = (index ?? 0) + 1;
  const name = rowName(item, index);
  const time = (item?.start && item?.end) ? `${item.start} – ${item.end}` : null;
  const category = item?.place?.category || item?.meta?.category || item?.type || '';
  const longTitle = String(name).length > 34;  // uzun başlıkta meta'yı sakla

  return (
    <View style={[styles.row, selected && styles.rowSelected, isActive && styles.rowDragging]}>
      <View style={styles.selStripe} pointerEvents="none" />

      <Pressable
        onPress={onPress}
        onLongPress={drag}
        delayLongPress={160}
        android_ripple={{ color: BORDER }}
        style={styles.rowTap}
      >
        {/* Sol rozet — daha sola & yakın */}
        <View style={styles.rowLead}>
          <View style={styles.badge}><Text style={styles.badgeTxt}>{order}</Text></View>
        </View>

        {/* Metin alanı — geniş ve esnek */}
        <View style={styles.textBlock}>
          <Text
            numberOfLines={TITLE_MAX_LINES}
            ellipsizeMode="tail"
            style={styles.title}
          >
            {name}
          </Text>

          {!longTitle && (
            <View style={styles.metaRow}>
              {time ? <Text numberOfLines={1} style={[styles.metaTime, { marginRight: 6 }]}>{time}</Text> : null}
              {category ? <Text numberOfLines={1} style={styles.metaChip}>{String(category).toUpperCase()}</Text> : null}
            </View>
          )}
        </View>

        {/* Sağ: tek kebap menü (⋮) — minimum genişlik */}
        <View style={styles.rowTailAbs}>
          <Pressable
            onPress={() => showRowMenu({ name, onEdit, onDelete })}
            style={styles.kebabBtn}
            hitSlop={8}
            accessibilityLabel="Seçenekler"
          >
            <Ionicons name="ellipsis-vertical" size={16} color="#374151" />
          </Pressable>
        </View>
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
  onEditAt,
  onDeleteAt,
  onReorder,
  insertMode = false,
  onPickInsertIndex,
  onCancelInsertMode,
}) {
  const days = plan?.days || [];
  const day = days[dayIndex] || null;
  const listData = (day?.activities || []).map((a, i) => ({ ...a, _key: a?.id || String(i) }));

  if (!isOpen) return <View style={styles.closedStrip} />;

  const renderItem = ({ item, index, drag, isActive, getIndex }) => {
    const safeIndex = Number.isFinite(index)
      ? index
      : typeof getIndex === 'function'
      ? getIndex() ?? 0
      : 0;

    const selected = selectedActivityId && item?.id === selectedActivityId;
    const onInsert = insertMode ? onPickInsertIndex : onInsertAt;

    return (
      <View key={item._key}>
        <RowCore
          item={item}
          index={safeIndex}
          selected={!!selected}
          onPress={() => onSelect?.(item)}
          onEdit={() => onEditAt?.(safeIndex)}
          onDelete={() => onDeleteAt?.(safeIndex)}
          drag={drag}
          isActive={isActive}
        />
        <Separator insertIndex={safeIndex + 1} onInsert={onInsert} highlight={insertMode} />
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
          if (from != null && to != null) onReorder?.(from, to);
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
          {listData.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Bu günde aktivite yok.</Text>
            </View>
          )}
        </View>
      )}
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

  // Sol rozet: daha sola ve yazıya yakın
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

  // Metin alanı — genişlik önceliği
  textBlock: {
    flexBasis: 0,
    flexGrow: 1,
    minWidth: 0,
    paddingRight: ROW_TAIL_PAD, // sağdaki kebap için boşluk
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

  // Sağ: tek kebap menü
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

  // Separator
  sepWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 10, paddingHorizontal: 10 },
  sepLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: BORDER },
  sepAddBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF' },
  sepAddBtnHL: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  sepAddTxt: { color: FG, fontSize: 11, fontWeight: '700', marginLeft: 4 },

  empty: { padding: 12, alignItems: 'center' },
  emptyText: { color: FG_MUTED },
});
 