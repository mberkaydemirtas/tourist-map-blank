// trips/TripsListScreen.js
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

// === Yeni servisler (offline-first + sync) ===
import { listTripsLocal, createTripLocal, markDeleteLocal, getTripLocal } from '../app/lib/tripsLocal';
import { syncTrips } from '../app/services/tripsSync';
import { getDeviceId } from '../app/services/device';

// (Varsa senin tarih helper'ın kalsın)
import { formatDate } from './shared/types';

const BORDER = '#23262F';

export default function TripsListScreen() {
  const nav = useNavigation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [overlay, setOverlay] = useState(false);

  const onSelectPlaces = (id) => {
    nav.navigate('TripPlacesScreen', { id });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1) yerelden yükle
      const rows = await listTripsLocal();
      setItems(rows.filter(x => !x.deleted));

      // 2) sessiz senkron
      const deviceId = await getDeviceId();
      await syncTrips({ deviceId }).catch(() => { /* offline olabilir, sorun değil */ });

      // 3) senkron sonrası tekrar yükle
      const rows2 = await listTripsLocal();
      setItems(rows2.filter(x => !x.deleted));
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startScratch = async () => {
    setOverlay(false);
    const t = await createTripLocal({ title: 'New Trip' });
    nav.navigate('TripEditor', { id: t._id });
  };

  const onDelete = (id, title) => {
    Alert.alert('Geziyi Sil', `"${title}" silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          await markDeleteLocal(id);
          const deviceId = await getDeviceId();
          await syncTrips({ deviceId }).catch(()=>{});
          await load();
        }
      },
    ]);
  };

  const onDuplicate = async (id) => {
    // Basit çoğaltma
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
    await createTripLocal(copy); // createTripLocal yeni uuid verir
    const deviceId = await getDeviceId();
    await syncTrips({ deviceId }).catch(()=>{});
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
      onPress={() => nav.navigate('TripEditor', { id: item._id })}
      onLongPress={() => nav.navigate('TripEditor', { id: item._id })}
    >
      {/* Sol: Başlık + tarih alt yazısı */}
      <View style={[styles.cell, styles.flex3]}>
        <Text style={styles.title} numberOfLines={2}>{item.title || '(untitled)'}</Text>
        <Text style={styles.subTitle} numberOfLines={1}>
          {(item?.dateRange?.start || '—')} → {(item?.dateRange?.end || '—')}
        </Text>
      </View>

      {/* Orta: durak sayısı (places) */}
      <Text style={[styles.cell, styles.center, styles.badge]}>{item.places?.length ?? 0}</Text>

      {/* Tarihler */}
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>
        {item.createdAt ? formatDate(item.createdAt) : '—'}
      </Text>
      <Text style={[styles.cell, styles.flex1]} numberOfLines={1}>
        {item.updatedAt ? formatDate(item.updatedAt) : '—'}
      </Text>

      {/* Aksiyonlar */}
      <View style={[styles.cell, styles.actions]}>
        {/* YERLERİ SEÇ butonu (yeni) */}
        <TouchableOpacity onPress={() => onSelectPlaces(item._id)} style={styles.iconBtn}>
          <Ionicons name="map-outline" size={22} color="#22c55e" />
        </TouchableOpacity>

        {/* Kopyala */}
        <TouchableOpacity onPress={() => onDuplicate(item._id)} style={styles.iconBtn}>
          <Ionicons name="copy-outline" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Düzenle */}
        <TouchableOpacity onPress={() => nav.navigate('TripEditor', { id: item._id })} style={styles.iconBtn}>
          <Ionicons name="pencil-outline" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Sil */}
        <TouchableOpacity onPress={() => onDelete(item._id, item.title)} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={22} color="#ef4444" />
        </TouchableOpacity>
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

      {/* Mevcut overlay'in kalsın – import'un varsa aç */}
      {/* <CreateTripOverlay
        visible={overlay}
        onClose={() => setOverlay(false)}
        onStartScratch={startScratch}
        onStartTemplate={() => {}}
        onStartAI={() => {}}
        online={true}
      /> */}
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
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10 },
  newBtnText: { color: '#fff', fontWeight: '700' },
});
