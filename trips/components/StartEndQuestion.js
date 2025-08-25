import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Pressable,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { listHubsForCity } from '../services/geoService';

const BORDER = '#23262F';
const BTN = '#2563EB';

const TYPE_MAP = {
  airport: { mode: 'plane', label: 'Havalimanı' },
  train:   { mode: 'train', label: 'Tren Garı' },
  bus:     { mode: 'bus',   label: 'Otogar' },
  map:     { mode: 'custom', label: 'Haritadan Seç' },
};

const TIME_SLOTS = (() => {
  const arr = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 30) {
    arr.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
  }
  return arr;
})();

export default function StartEndQuestion({
  cityName,
  cityCenter,
  value,
  onChange,
  onMapPick,
}) {
  const defaultStart = { type: null, hub: null, date: null, time: '09:00' };
  const defaultEnd   = { type: null, hub: null, date: null, time: '17:00' };

  const [start, setStart] = useState(value?.start || defaultStart);
  const [end,   setEnd]   = useState(value?.end   || defaultEnd);

  // Parent value değiştiğinde (örn. Haritadan Seç -> geri dönüş) iç state’i senkronize et
  useEffect(() => { setStart(value?.start || defaultStart); }, [
    value?.start?.type, value?.start?.hub?.place_id, value?.start?.date, value?.start?.time
  ]);
  useEffect(() => { setEnd(value?.end || defaultEnd); }, [
    value?.end?.type, value?.end?.hub?.place_id, value?.end?.date, value?.end?.time
  ]);

  // Değişiklikleri parent’a bildir
  useEffect(() => { onChange?.({ start, end }); }, [start, end]); // eslint-disable-line

  return (
    <View style={{ gap: 14 }}>
      <Card title={`${cityName} • Başlangıç`}>
        <PointPicker
          label="Nereden?"
          cityName={cityName}
          cityCenter={cityCenter}
          selectedType={start.type}
          selectedHub={start.hub}
          onSelectType={async (t) => {
            if (t === 'map') {
              const picked = await onMapPick?.('start');
              setStart(s => ({ ...s, type: 'map', hub: picked || null }));
            } else {
              setStart(s => ({ ...s, type: t, hub: null }));
            }
          }}
          onSelectHub={(hub) => setStart(s => ({ ...s, hub }))}
        />
        <Row>
          <DatePicker label="Tarih" value={start.date} onChange={(d) => setStart(s => ({ ...s, date: d }))} />
          <TimeDropdown label="Saat" value={start.time} onChange={(t) => setStart(s => ({ ...s, time: t }))} />
        </Row>
      </Card>

      <Card title={`${cityName} • Bitiş`}>
        <PointPicker
          label="Nerede bitecek?"
          cityName={cityName}
          cityCenter={cityCenter}
          selectedType={end.type}
          selectedHub={end.hub}
          onSelectType={async (t) => {
            if (t === 'map') {
              const picked = await onMapPick?.('end');
              setEnd(s => ({ ...s, type: 'map', hub: picked || null }));
            } else {
              setEnd(s => ({ ...s, type: t, hub: null }));
            }
          }}
          onSelectHub={(hub) => setEnd(s => ({ ...s, hub }))}
        />
        <Row>
          <DatePicker label="Tarih" value={end.date} onChange={(d) => setEnd(s => ({ ...s, date: d }))} />
          <TimeDropdown label="Saat" value={end.time} onChange={(t) => setEnd(s => ({ ...s, time: t }))} />
        </Row>
      </Card>
    </View>
  );
}

/* -------------------------------- Sub-components ------------------------------- */
function Card({ title, children }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text><View style={{ gap: 10 }}>{children}</View></View>;
}
function Row({ children }) { return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>; }

function PointPicker({ label, cityName, cityCenter, selectedType, selectedHub, onSelectType, onSelectHub }) {
  const [hubs, setHubs] = useState([]);
  const [openHubModal, setOpenHubModal] = useState(false);

  async function loadHubsByType(typeKey) {
    const mode = TYPE_MAP[typeKey]?.mode;
    if (!mode || mode === 'custom' || !cityCenter) { setHubs([]); return; }
    setHubs([]); // önce temizle (eski liste flash yapmasın)
    const res = await listHubsForCity({ lat: cityCenter.lat, lng: cityCenter.lng, mode });
    const filtered = normalizeHubsForType(typeKey, res || [], cityName, cityCenter);
    setHubs(filtered);
    // tek seçenek kaldıysa otomatik seç
    if (filtered.length === 1) onSelectHub?.(toHubShape(filtered[0]));
  }

  useEffect(() => {
    if (selectedType && selectedType !== 'map') loadHubsByType(selectedType);
  }, [selectedType]); // eslint-disable-line

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>

      {/* Tip butonları */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(TYPE_MAP).map(([k, v]) => (
          <TouchableOpacity key={k} onPress={() => onSelectType(k)} style={[styles.modeBtn, selectedType === k && styles.modeBtnActive]}>
            <Text style={styles.modeText}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Hub seçimi (airport/train/bus) */}
      {selectedType && selectedType !== 'map' && (
        <TouchableOpacity onPress={() => setOpenHubModal(true)} style={styles.selectShell}>
          <Text style={styles.selectShellText}>
            {selectedHub?.name || `${TYPE_MAP[selectedType].label} seçin`}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </TouchableOpacity>
      )}

      <Modal visible={openHubModal} transparent animationType="fade" onRequestClose={() => setOpenHubModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenHubModal(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{TYPE_MAP[selectedType || 'airport']?.label} Seçin</Text>
          <FlatList
            data={hubs}
            keyExtractor={(it) => it.place_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => { onSelectHub(toHubShape(item)); setOpenHubModal(false); }}
              >
                <Text style={styles.optionText}>{item.name}</Text>
                {item.meta && <Text style={{ color:'#9AA0A6', fontSize:12 }}>{item.meta}</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={{ padding: 10, gap: 6 }}>
                <Text style={{ color: '#9AA0A6' }}>Uygun nokta bulunamadı.</Text>
                <Text style={{ color: '#9AA0A6' }}>“Haritadan Seç” ile manuel nokta belirleyebilirsiniz.</Text>
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
          <TouchableOpacity onPress={() => setOpenHubModal(false)} style={[styles.smallBtn, { marginTop: 8 }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function DatePicker({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const marked = useMemo(() => (value ? { [value]: { selected: true, selectedColor: BTN, selectedTextColor: '#fff' } } : {}), [value]);

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
          <Text style={styles.modalTitle}>Tarih Seçin</Text>
          <Calendar
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
        </View>
      </Modal>
    </View>
  );
}

function TimeDropdown({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.selectShell}>
        <Text style={styles.selectShellText}>{value}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Saat Seçin</Text>
          <FlatList
            data={TIME_SLOTS}
            keyExtractor={(it) => it}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.optionRow} onPress={() => { onChange(item); setOpen(false); }}>
                <Text style={styles.optionText}>{item}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            initialScrollIndex={Math.max(0, TIME_SLOTS.findIndex(t => t === value))}
            getItemLayout={(_, idx) => ({ length: 44, offset: 44 * idx, index: idx })}
          />
        </View>
      </Modal>
    </View>
  );
}

/* --------------------------------- Filtering logic --------------------------------- */
// listHubsForCity() sonuçlarını şehir odaklı temizlemek için heuristik filtre
function normalizeHubsForType(typeKey, hubs, cityName, cityCenter) {
  const nameLC = (s) => (s || '').toString().toLowerCase();
  const strip = (s) => s?.normalize?.('NFD')?.replace(/[\u0300-\u036f]/g, '') || s || '';
  const cityToken = nameLC(strip(cityName || ''));

  const withDistance = hubs.map(h => ({
    ...h,
    _d: h?.location && cityCenter ? haversine(cityCenter, h.location) : null, // km
    _name: nameLC(h.name),
  }));

  let inc = [], exc = [], maxKm = 30;
  if (typeKey === 'airport') {
    inc = ['havaliman', 'havaalan', 'airport', 'intl', 'international'];
    exc = ['helipad', 'heliport', 'uçuş akademi', 'private'];
    maxKm = 70;
  } else if (typeKey === 'bus') {
    inc = ['otogar', 'terminal', 'otob', 'bus terminal'];
    exc = ['durak', 'durağı', 'stop', 'metro', 'tram', 'metrobüs'];
    maxKm = 20;
  } else if (typeKey === 'train') {
    inc = ['gar', 'tren', 'train station', 'yht', 'tcdd', 'istasyon'];
    exc = ['metro', 'marmaray', 'tram', 'subway', 'light rail', 'funiküler'];
    maxKm = 20;
  }

  // 1) isim filtreleri
  let filtered = withDistance.filter(h => {
    const n = h._name;
    const okInc = inc.some(k => n.includes(k));
    const bad = exc.some(k => n.includes(k));
    return okInc && !bad;
  });

  // 2) mesafe filtre
  filtered = filtered.filter(h => (h._d == null) || h._d <= maxKm);

  // 3) skorla: şehir adı geçen > daha yakın > uluslararası anahtar kelime
  filtered.forEach(h => {
    let score = 0;
    if (cityToken && h._name.includes(cityToken)) score += 5;
    if (h._d != null) score += Math.max(0, (maxKm - h._d) / maxKm) * 4;
    if (typeKey === 'airport' && (h._name.includes('intl') || h._name.includes('international'))) score += 1.5;
    h._score = score;
  });

  filtered.sort((a,b) => b._score - a._score);

  // 4) gereksiz alanları temizle + meta
  return filtered.map(h => ({
    name: h.name,
    place_id: h.place_id,
    location: h.location,
    meta: h._d != null ? `${h._d.toFixed(1)} km` : undefined,
  }));
}

function toHubShape(item) {
  return { name: item.name, place_id: item.place_id, location: item.location };
}

function haversine(a, b) {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function toRad(deg) { return deg * Math.PI / 180; }

/* --------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  card: { borderBottomWidth: 1, borderColor: BORDER, padding: 12, borderRadius: 12, backgroundColor: '#0B0D12' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },

  label: { fontSize: 13, color: '#A8A8B3', marginBottom: 6 },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#0D0F14' },
  modeBtnActive: { borderColor: BTN, backgroundColor: '#0E1B2E' },
  modeText: { color: '#fff' },

  selectShell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D0F14' },
  selectShellText: { color: '#fff' },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },

  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { position: 'absolute', left: 16, right: 16, top: '18%', bottom: '18%', borderRadius: 16, backgroundColor: '#0D0F14', padding: 12, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },

  optionRow: { paddingVertical: 11, paddingHorizontal: 10 },
  optionText: { fontSize: 15, color: '#fff' },
  separator: { height: 1, backgroundColor: BORDER },
});
