// src/trips/components/LodgingQuestion.js
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ActivityIndicator, FlatList } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { getTopLodgingsByCity } from '../../services/hotelSuggest';

const BORDER = '#23262F';
const BTN = '#2563EB';

/**
 * LodgingQuestion
 * Props:
 * - cityName: string
 * - cityKey: string (place_id)
 * - range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 * - segments: Array<{ place: { name, place_id }, start?: string, end?: string }>
 * - onChange(segments)
 * - onOpenPicker(): MapScreen'de "lodging" picker’ını açar (haritadan seçim)
 * - cityCenter?: {lat:number,lng:number}  // öneri sorgusu için şehir merkezi (opsiyonel ama önerilir)
 */
export default function LodgingQuestion({ cityName, cityKey, range, segments = [], onChange, onOpenPicker, cityCenter }) {
  const [items, setItems] = useState(segments);

  // Öneri sekmesi state’i
  const [limit, setLimit] = useState(10); // 10 | 15 | 20
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => { setItems(segments); }, [segments]);
  useEffect(() => { onChange?.(items); }, [items]); // eslint-disable-line

  const err = useMemo(() => validate(items, range), [items, range]);

  useEffect(() => {
    let alive = true;
    async function run() {
      if (!cityCenter || !Number.isFinite(cityCenter.lat) || !Number.isFinite(cityCenter.lng)) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const list = await getTopLodgingsByCity(cityCenter, limit);
        if (!alive) return;
        setSuggestions(list);
      } catch {
        if (!alive) return;
        setSuggestions([]);
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => { alive = false; };
  }, [cityCenter?.lat, cityCenter?.lng, limit]);

  function addEmptyFromMap() { onOpenPicker?.(); }
  function removeAt(idx) { setItems(prev => prev.filter((_, i) => i !== idx)); }
  function setDatesAt(idx, next) { setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...next } : it))); }

  function addFromSuggestion(h) {
    // Aynı place_id varsa bir daha ekleme:
    if (items.some(seg => seg.place?.place_id === h.place_id)) return;
    setItems(prev => [...prev, { place: { name: h.name, place_id: h.place_id }, start: null, end: null }]);
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.note}>
        Şehir: <Text style={{ fontWeight: '700', color: '#fff' }}>{cityName}</Text> • Tarih aralığı: {range?.start || '—'} → {range?.end || '—'}
      </Text>

      {/* Önerilen Oteller */}
      <View style={styles.suggestCard}>
        <View style={styles.suggestHeader}>
          <Text style={styles.suggestTitle}>Önerilen Oteller</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <LimitChip value={10} active={limit === 10} onPress={() => setLimit(10)} />
            <LimitChip value={15} active={limit === 15} onPress={() => setLimit(15)} />
            <LimitChip value={20} active={limit === 20} onPress={() => setLimit(20)} />
          </View>
        </View>

        {loading ? (
          <View style={styles.suggestLoading}>
            <ActivityIndicator />
            <Text style={{ color: '#A8A8B3', marginTop: 6 }}>Oteller yükleniyor…</Text>
          </View>
        ) : suggestions.length === 0 ? (
          <View style={styles.suggestEmpty}>
            <Text style={{ color: '#A8A8B3' }}>Bu şehir için öneri bulunamadı.</Text>
          </View>
        ) : (
          <FlatList
            data={suggestions}
            keyExtractor={(it) => it.place_id}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => (
              <View style={styles.suggestItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestName}>{item.name}</Text>
                  <Text style={styles.suggestSub}>
                    {item.rating ? `⭐ ${item.rating} ` : ''}{item.user_ratings_total ? `(${item.user_ratings_total}) • ` : ''}{item.address || ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => addFromSuggestion(item)}
                    style={[styles.smallBtn, { borderColor: BTN }]}
                  >
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Seç</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onOpenPicker}
                    style={[styles.smallBtn, { borderColor: BORDER }]}
                  >
                    <Text style={{ color: '#fff' }}>Haritada Aç</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}

        <TouchableOpacity onPress={onOpenPicker} style={[styles.addBtn, { marginTop: 8 }]}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Haritadan Seç</Text>
        </TouchableOpacity>
      </View>

      {/* Kullanıcının seçtiği konaklama segmentleri */}
      {items.map((seg, idx) => (
        <View key={`${seg.place?.place_id || 'seg'}_${idx}`} style={styles.card}>
          <Text style={styles.placeTitle}>{seg.place?.name || 'Otel seçilmedi'}</Text>

          <Row>
            <DateField
              label="Check-in"
              value={seg.start}
              minDate={range?.start}
              maxDate={range?.end}
              onChange={(d) => {
                const endOk = seg.end && d && seg.end < d ? null : seg.end;
                setDatesAt(idx, { start: d, end: endOk });
              }}
            />
            <DateField
              label="Check-out"
              value={seg.end}
              minDate={seg.start || range?.start}
              maxDate={range?.end}
              onChange={(d) => setDatesAt(idx, { end: d })}
            />
          </Row>

          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <TouchableOpacity onPress={() => removeAt(idx)} style={[styles.smallBtn, { borderColor: '#EF4444' }]}>
              <Text style={{ color: '#EF4444', fontWeight: '700' }}>Sil</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {!!err && <Text style={styles.error}>{err}</Text>}
    </View>
  );
}

function LimitChip({ value, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.limitChip,
        active && { backgroundColor: BTN, borderColor: BTN },
      ]}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Top {value}</Text>
    </TouchableOpacity>
  );
}

function Row({ children }) { return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>; }

function DateField({ label, value, minDate, maxDate, onChange }) {
  const [open, setOpen] = useState(false);
  const marked = useMemo(() => {
    if (!value) return {};
    return { [value]: { selected: true, selectedColor: BTN, selectedTextColor: '#fff' } };
  }, [value]);

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.selectShell}>
        <Text style={styles.selectShellText}>{value || 'Tarih seçin'}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={[styles.modalCard, { top: '12%', bottom: '12%' }]}>
          <Text style={styles.modalTitle}>{label}</Text>
          <Calendar
            minDate={minDate}
            maxDate={maxDate}
            markedDates={marked}
            onDayPress={(d) => { onChange(d.dateString); setOpen(false); }}
            theme={{
              calendarBackground: '#0D0F14',
              dayTextColor: '#fff',
              monthTextColor: '#fff',
              textDisabledColor: '#6B7280',
              arrowColor: '#fff',
              selectedDayBackgroundColor: BTN,
              todayTextColor: '#60A5FA',
            }}
            style={{ borderRadius: 12, overflow: 'hidden' }}
          />
          <Text style={{ color: '#9AA0A6', marginTop: 8 }}>İzin verilen aralık: {minDate || '—'} → {maxDate || '—'}</Text>
        </View>
      </Modal>
    </View>
  );
}

/* ---------------------------- validation helpers --------------------------- */
function validate(items, range) {
  if (!range?.start || !range?.end) return 'Lütfen önce bu şehir için başlangıç ve bitiş tarihlerini seçin.';
  if (!items.length) return null; // Önerilerden seçmeden geçmek isteyebilir → hata vermeyelim
  for (const it of items) {
    if (!it.place?.name) return 'Seçilen konaklamalardan birinde tesis adı eksik.';
    if (!it.start || !it.end) return 'Her konaklama için giriş/çıkış tarihlerini girin.';
    if (it.start < range.start || it.end > range.end) return 'Konaklama tarihleri, bu şehrin tarih aralığı dışında.';
    if (it.end <= it.start) return 'Check-out, check-in tarihinden sonra olmalı.';
  }
  return null;
}

/* ---------------------------------- styles --------------------------------- */
const styles = StyleSheet.create({
  note: { color: '#A8A8B3' },

  suggestCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, backgroundColor: '#0B0D12', gap: 8 },
  suggestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestTitle: { color: '#fff', fontWeight: '700' },
  suggestLoading: { alignItems: 'center', paddingVertical: 12 },
  suggestEmpty: { alignItems: 'center', paddingVertical: 12 },
  suggestItem: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  suggestName: { color: '#fff', fontWeight: '700' },
  suggestSub: { color: '#A8A8B3', marginTop: 2 },
  limitChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },

  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, backgroundColor: '#0B0D12', gap: 8 },
  placeTitle: { color: '#fff', fontWeight: '700' },

  label: { fontSize: 13, color: '#A8A8B3', marginBottom: 6 },

  selectShell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D0F14' },
  selectShellText: { color: '#fff' },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },
  addBtn: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D1117', alignSelf: 'flex-start' },

  error: { color: '#F87171', marginTop: 8, fontWeight: '700' },

  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { position: 'absolute', left: 16, right: 16, top: '18%', bottom: '18%', borderRadius: 16, backgroundColor: '#0D0F14', padding: 12, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },
});
