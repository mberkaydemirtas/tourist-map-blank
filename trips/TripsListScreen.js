import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { listTrips, deleteTrip, duplicateTrip } from './services/tripsService';
import { formatDate } from './shared/types';
import CreateTripOverlay from './CreateTripOverlay';

const BORDER = '#23262F';

export default function TripsListScreen() {
  const nav = useNavigation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await listTrips()); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startScratch = () => { setOverlay(false); nav.navigate('CreateTripWizard'); };

  const onDelete = (id, title) => {
    Alert.alert('Geziyi Sil', `"${title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: async () => { await deleteTrip(id); load(); } },
    ]);
  };
  const onDuplicate = async (id) => { await duplicateTrip(id); load(); };

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
      onPress={() => nav.navigate('TripEditor', { id: item.id })}
      onLongPress={() => nav.navigate('TripEditor', { id: item.id })}
    >
      {/* Sol: Başlık + tarih alt yazısı */}
      <View style={[styles.cell, styles.flex3]}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.subTitle} numberOfLines={1}>
          {item?.dateRange?.start || '—'} → {item?.dateRange?.end || '—'}
        </Text>
      </View>

      {/* Orta: durak sayısı */}
      <Text style={[styles.cell, styles.center, styles.badge]}>{item.stops?.length ?? 0}</Text>

      {/* Tarihler */}
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>{formatDate(item.createdAt)}</Text>
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>{formatDate(item.updatedAt)}</Text>

      {/* Aksiyonlar */}
      <View style={[styles.cell, styles.actions]}>
        <TouchableOpacity onPress={() => onDuplicate(item.id)} style={styles.iconBtn}><Ionicons name="copy-outline" size={22} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={() => nav.navigate('TripEditor', { id: item.id })} style={styles.iconBtn}><Ionicons name="pencil-outline" size={22} color="#fff" /></TouchableOpacity>
        <TouchableOpacity onPress={() => onDelete(item.id, item.title)} style={styles.iconBtn}><Ionicons name="trash-outline" size={22} color="#ef4444" /></TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.screenTitle}>Gezilerim</Text>
        <TouchableOpacity onPress={() => setOverlay(true)} style={styles.newBtn} activeOpacity={0.9}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.newBtnText}>Yeni Gezi</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        stickyHeaderIndices={[0]}                 // 👈 Header sabit
        refreshControl={<RefreshControl tintColor="#fff" refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={24} color="#A8A8B3" />
            <Text style={styles.emptyText}>Henüz gezi yok. “Yeni Gezi” ile başlayın.</Text>
          </View>
        ) : null}
        contentContainerStyle={{ paddingBottom: 24 }}
      />

      <CreateTripOverlay
        visible={overlay}
        onClose={() => setOverlay(false)}
        onStartScratch={startScratch}
        onStartTemplate={() => {}}
        onStartAI={() => {}}
        online={true}
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
  badge: {
    color: '#fff', fontWeight: '800', textAlign: 'center',
    paddingHorizontal: 10, paddingVertical: Platform.select({ ios: 4, android: 6 }),
    borderWidth: 1, borderColor: BORDER, borderRadius: 10, minWidth: 42,
  },

  flex3: { flex: 3 }, flex1: { flex: 1 }, center: { textAlign: 'center' },

  actionsHeader: { width: 120, textAlign: 'right' },
  actions: { width: 120, flexDirection: 'row', justifyContent: 'flex-end' },
  iconBtn: { padding: 6, marginLeft: 6 },

  empty: { alignItems: 'center', padding: 24, gap: 8 },
  emptyText: { color: '#A8A8B3' },
});
