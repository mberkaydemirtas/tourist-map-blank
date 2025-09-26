// trips/TripsListScreen.js
import React, { useCallback, useMemo, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, Platform, Dimensions, findNodeHandle  } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';

// === Yeni servisler (offline-first + sync) ===
import { listTripsLocal, createTripLocal, markDeleteLocal, getTripLocal } from '../app/lib/tripsLocal';
import { syncTrips } from '../app/services/tripsSync';
import { getDeviceId } from '../app/services/device';
import { SERVER_ENABLED } from '../app/lib/api';

// (Varsa senin tarih helper'ın kalsın)
import { formatDate } from './shared/types';

const BORDER = '#23262F';

export default function TripsListScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const firstLoadedRef = useRef(false);
  const [menuFor, setMenuFor] = useState(null); // { _id, title, status } | null
  const [menuAnchor, setMenuAnchor] = useState(null); // { x, y, width, height }

  const onSelectPlaces = (id) => {
    nav.navigate('TripPlacesScreen', { id });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) yerelden yükle
      const rows = await listTripsLocal();
      setItems(rows.filter(x => !x.deleted));

      // 2) server açıksa arkada sessiz senkron (UI'ı bloklama)
      if (SERVER_ENABLED) {
        (async () => {
          try {
            const deviceId = await getDeviceId();
            await syncTrips({ deviceId });
            const rows2 = await listTripsLocal();
            setItems(rows2.filter(x => !x.deleted));
          } catch {}
        })();
      }
    } finally {
      setLoading(false);
    }
  }, []);

   useFocusEffect(useCallback(() => {
     const needFirst = !firstLoadedRef.current;
     const hasRefreshParam = !!route?.params?.refresh;
     if (needFirst || hasRefreshParam) {
       firstLoadedRef.current = true;
       load();
     }
   }, [load, route?.params?.refresh]));
  function EllipsisButton({ onMeasureAndOpen }) {
   const ref = useRef(null);
   const handlePress = () => {
     // RN view ölçümü (buton konumu)
     ref.current?.measureInWindow?.((x, y, width, height) => {
       onMeasureAndOpen?.({ x, y, width, height });
     });
   };
   return (
     <View ref={ref} collapsable={false}>
       <TouchableOpacity onPress={handlePress} style={styles.iconBtn} accessibilityLabel="Daha fazla">
         <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
       </TouchableOpacity>
     </View>
   );
 }

  // === Buton davranışı: Wizard akışı (WhereTo → StartEnd → Lodging)
  const startNewTrip = useCallback(() => {
    nav.navigate('CreateTripWizard');
  }, [nav]);

  // === Alternatif: Hemen local taslak oluşturup editöre gitmek istersen:
  // const startNewTrip = useCallback(async () => {
  //   const t = await createTripLocal({ title: 'New Trip' });
  //   nav.navigate('TripEditor', { id: t._id });
  // }, [nav]);

  const onDelete = (id, title) => {
    Alert.alert('Geziyi Sil', `"${title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await markDeleteLocal(id);
          if (SERVER_ENABLED) {
            try {
              const deviceId = await getDeviceId();
              await syncTrips({ deviceId });
            } catch {}
          }
          await load();
        }
      },
    ]);
  };

  const onDuplicate = async (id) => {
    const src = await getTripLocal(id);
    if (!src) return;
    const copy = {
      ...src,
      _id: undefined,
      title: (src.title || 'Trip') + ' (Copy)',
      updatedAt: new Date().toISOString(),
      version: 0,
      __dirty: true,
    };
    await createTripLocal(copy);
    if (SERVER_ENABLED) {
      try {
        const deviceId = await getDeviceId();
        await syncTrips({ deviceId });
      } catch {}
    }
    await load();
  };

  const Header = useMemo(() => (
    <View style={styles.tableHeader}>
      <Text style={[styles.hCell, styles.flex3]}>Gezi</Text>
      <Text style={[styles.hCell, styles.center, styles.flex1]}>Durak</Text>
      <Text style={[styles.hCell, styles.flex1]}>Oluşturma</Text>
      <Text style={[styles.hCell, styles.flex1]}>Güncelleme</Text>
      <Text style={[styles.hCell, styles.actionsHeader]} />
    </View>
  ), []);

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.8}
      onPress={() => {
        if (item.status === 'draft') {
          nav.navigate('CreateTripWizard', { resumeId: item._id });
        } else {
          nav.navigate('TripEditor', { id: item._id });
        }
      }}
      onLongPress={() => nav.navigate('TripEditor', { id: item._id })}
    >
      <View style={[styles.cell, styles.flex3]}>
         <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
           <Text style={styles.title} numberOfLines={2}>{item.title || '(untitled)'}</Text>
           {item.status === 'draft' ? <Text style={styles.draftBadge}>Taslak</Text> : null}
         </View>        
         <Text style={styles.subTitle} numberOfLines={1}>
          {(item?.dateRange?.start || '—')} → {(item?.dateRange?.end || '—')}
        </Text>
      </View>
      <Text style={[styles.cell, styles.center, styles.badge]}>{item.places?.length ?? 0}</Text>
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>
        {item.createdAt ? formatDate(item.createdAt) : '—'}
      </Text>
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>
        {item.updatedAt ? formatDate(item.updatedAt) : '—'}
      </Text>
      <View style={[styles.cell, styles.actions]}>
         <EllipsisButton
           onMeasureAndOpen={(anchorRect) => {
             setMenuAnchor(anchorRect);
             setMenuFor({ _id: item._id, title: item.title, status: item.status });
           }}
         />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Gezilerim</Text>
        <TouchableOpacity onPress={startNewTrip} style={styles.newBtn} activeOpacity={0.9}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>Yeni Gezi</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it._id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        stickyHeaderIndices={[0]}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={24} color="#A8A8B3" />
            <Text style={styles.emptyText}>Henüz gezi yok. “Yeni Gezi” ile başlayın.</Text>
          </View>
        ) : null}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

       <RowActionMenu
         visible={!!menuFor}
         title={menuFor?.title}
         anchor={menuAnchor}
         onClose={() => { setMenuFor(null); setMenuAnchor(null); }}
         onCopy={async () => { if (menuFor) await onDuplicate(menuFor._id); setMenuFor(null); }}
         onEdit={() => { if (menuFor) nav.navigate('TripEditor', { id: menuFor._id }); setMenuFor(null); }}
         onDelete={() => { if (menuFor) onDelete(menuFor._id, menuFor.title); setMenuFor(null); }}
       />
           </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014' },
  topBar: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },

  tableHeader: {
    flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 12,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14',
  },
  hCell: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12,
    borderBottomWidth: 1, borderColor: BORDER, gap: 8,
  },

  cell: { paddingHorizontal: 6 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  subTitle: { color: '#A8A8B3', fontSize: 12, marginTop: 2 },
   draftBadge: {
     color: '#f59e0b',
     borderColor: '#f59e0b',
     borderWidth: 1,
     paddingHorizontal: 6,
     paddingVertical: 2,
     borderRadius: 8,
     fontSize: 11,
     fontWeight: '800',
   },
  badge: {
    color: '#fff', fontWeight: '800', textAlign: 'center',
    paddingHorizontal: 10, paddingVertical: Platform.select({ ios: 4, android: 6 }),
    borderWidth: 1, borderColor: BORDER, borderRadius: 10, minWidth: 42,
  },

  flex3: { flex: 3 }, flex1: { flex: 1 }, center: { textAlign: 'center' },

  actionsHeader: { width: 120, textAlign: 'right' },
  actions: { width: 60, flexDirection: 'row', justifyContent: 'flex-end' },
  iconBtn: { padding: 6, marginLeft: 6 },

  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { color: '#A8A8B3' },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10 },
  newBtnText: { color: '#fff', fontWeight: '700' },
    /* Action menu */
   menuBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
   menuCardBase: {
     position: 'absolute',
     minWidth: 180,},
   menuHeader: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: BORDER },
   menuHeaderText: { color: '#9AA0A6', fontSize: 12 },
   menuItem: { paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
   menuItemText: { color: '#fff', fontWeight: '700' },
   dangerText: { color: '#ef4444', fontWeight: '800' },
});

/* --- satır sonunda: menü komponenti --- */
import { Modal, Pressable } from 'react-native';
function RowActionMenu({ visible, title, anchor, onClose, onCopy, onEdit, onDelete }) {
  if (!visible) return null;
  const win = Dimensions.get('window');
  const MENU_W = 200; // tahmini genislik
  const MENU_H_SAFE = 180; // clamp için alt boşluk tahmini
  let top = 20, left = win.width - MENU_W - 12;
  if (anchor) {
    // Menü, “…” butonunun HEMEN ÜSTÜNE hizalansın (birkaç px boşlukla)
    const margin = 6;
    const desiredTop = anchor.y - margin - 8 - MENU_H_SAFE * 0.1; // butonun biraz üstü
    const desiredLeft = anchor.x + anchor.width - MENU_W;          // sağa hizala
    // Ekrana sığdır
    top = Math.max(12, Math.min(desiredTop, win.height - MENU_H_SAFE));
    left = Math.max(12, Math.min(desiredLeft, win.width - MENU_W - 12));
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} />
      <View style={[styles.menuCardBase, { top, left, width: MENU_W }]}>        {!!title && (
          <View style={styles.menuHeader}>
            <Text style={styles.menuHeaderText} numberOfLines={1}>{title}</Text>
          </View>
        )}
        <TouchableOpacity onPress={onCopy} style={styles.menuItem}>
          <Ionicons name="copy-outline" size={18} color="#fff" />
          <Text style={styles.menuItemText}>Kopyala</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onEdit} style={styles.menuItem}>
          <Ionicons name="pencil-outline" size={18} color="#fff" />
          <Text style={styles.menuItemText}>Düzenle</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.menuItem}>
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
          <Text style={styles.dangerText}>Sil</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
