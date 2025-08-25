// src/trips/TripEditorScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { getTrip, updateTrip } from './services/tripsService';

const BORDER = '#23262F';

export default function TripEditorScreen() {
  const route = useRoute();
  const { id } = route.params || {};
  const [trip, setTrip] = useState(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const t = await getTrip(id);
      if (!mounted) return;
      setTrip(t);
      setTitle(t?.title ?? '');
    })();
    return () => { mounted = false; };
  }, [id]);

  const saveTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed) return Alert.alert('Uyarı', 'Gezi adı boş olamaz');
    const updated = await updateTrip(id, { title: trimmed });
    setTrip(updated);
    Alert.alert('Kaydedildi', 'Gezi adı güncellendi');
  };

  if (!trip) return (<View style={styles.center}><Text style={{color:'#fff'}}>Yükleniyor...</Text></View>);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 24 }}>
      <Text style={styles.label}>Gezi Adı</Text>
      <View style={styles.row}>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Gezi adı" placeholderTextColor="#6B7280" maxLength={100} />
        <TouchableOpacity onPress={saveTitle} style={styles.saveBtn} activeOpacity={0.8}><Text style={styles.saveText}>Kaydet</Text></TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Özet</Text>
        <Text style={styles.item}>Durak sayısı: {trip.stops?.length ?? 0}</Text>
        <Text style={styles.item}>Tarih: {trip?.dateRange?.start} → {trip?.dateRange?.end}</Text>
        <Text style={styles.item}>Geliş: {trip?.transport?.inbound?.mode || '-'} • {trip?.transport?.inbound?.arriveTime || '-'} • {trip?.transport?.inbound?.hub?.name || '-'}</Text>
        <Text style={styles.item}>Dönüş: {trip?.transport?.outbound?.mode || '-'} • {trip?.transport?.outbound?.departTime || '-'} • {trip?.transport?.outbound?.hub?.name || '-'}</Text>
        {trip?.stays?.[0] && (
          <Text style={styles.item}>Konaklama: {trip.stays[0].city} • {trip.stays[0].place?.name} • CI {trip.stays[0].checkIn} / CO {trip.stays[0].checkOut}</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Günlük Plan</Text>
        {trip.daily?.length ? (
          trip.daily.map((d) => (
            <View key={d.date} style={styles.day}>
              <Text style={styles.dayTitle}>{d.date} — Başlangıç {d.anchor?.place?.name || 'Konaklama'} @ {d.anchor?.ready_at}</Text>
              <Text style={styles.muted}>Gün Penceresi: {d.dayWindow?.start}–{d.dayWindow?.end}</Text>
              {d.blocks?.length ? d.blocks.map((b, i) => (
                <Text key={i} style={styles.block}>
                  • {b.type}{b.type === 'BUFFER' && b.minutes ? ` (${b.minutes} dk)` : ''}{b.type === 'CHECKIN' && b.time ? ` @ ${b.time}` : ''}{b.type === 'CHECKOUT' && b.time ? ` @ ${b.time}` : ''}
                </Text>
              )) : <Text style={styles.muted}>Bu gün için henüz blok yok.</Text>}
            </View>
          ))
        ) : (<Text style={styles.muted}>Henüz günlük plan oluşturulmamış.</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014', padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101014' },
  label: { fontSize: 13, color: '#A8A8B3', marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: '#fff' },
  saveBtn: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#2563EB', justifyContent: 'center' },
  saveText: { color: '#fff', fontWeight: '700' },

  card: { marginTop: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, gap: 6, backgroundColor:'#0D0F14' },
  cardTitle: { fontWeight: '700', fontSize: 16, color:'#fff' },
  item: { fontSize: 14, color: '#FFFFFF' },
  muted: { color: '#A8A8B3' },

  day: { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: BORDER, gap: 4 },
  dayTitle: { fontWeight: '600', color: '#FFFFFF' },
  block: { color: '#FFFFFF', fontSize: 13 },
});
