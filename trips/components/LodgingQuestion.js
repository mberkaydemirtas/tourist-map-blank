import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable } from 'react-native';
import { Calendar } from 'react-native-calendars';

const BORDER = '#23262F';
const BTN = '#2563EB';

/**
 * LodgingQuestion
 * Props:
 * - cityName: string
 * - cityKey: string (place_id)
 * - range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }  // bu şehrin Start/End aralığı
 * - segments: Array<{ place: { name, place_id }, start?: string, end?: string }>
 * - onChange(segments)
 * - onOpenPicker(): dışarıda MapScreen'e navigate edip "lodging" seçimi yaptırır
 */
export default function LodgingQuestion({ cityName, cityKey, range, segments = [], onChange, onOpenPicker }) {
  const [items, setItems] = useState(segments);

  useEffect(() => { setItems(segments); }, [segments]);
  useEffect(() => { onChange?.(items); }, [items]); // eslint-disable-line

  const err = useMemo(() => validate(items, range), [items, range]);

  function addEmptyFromMap() { onOpenPicker?.(); } // otel seçiminden sonra parent yeni item push ediyor
  function removeAt(idx) { setItems(prev => prev.filter((_, i) => i !== idx)); }
  function setDatesAt(idx, next) { setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...next } : it))); }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.note}>Şehir: <Text style={{ fontWeight: '700', color: '#fff' }}>{cityName}</Text> • Tarih aralığı: {range?.start || '—'} → {range?.end || '—'}</Text>

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

      <TouchableOpacity onPress={addEmptyFromMap} style={[styles.addBtn]}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>+ Konaklama Ekle (Haritadan Seç)</Text>
      </TouchableOpacity>

      {!!err && <Text style={styles.error}>{err}</Text>}
    </View>
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
  if (!items.length) return 'En az bir konaklama ekleyin.';
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
