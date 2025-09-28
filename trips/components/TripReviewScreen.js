import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { getTripLocal, saveTripLocal } from '../../app/lib/tripsLocal';

const BORDER = '#23262F';
const FG = '#EAEAEA';
const MUTED = '#9CA3AF';
const ACCENT = '#5EEAD4';
const LINK = '#0EA5E9';

export default function TripReviewScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const tripId = route.params?.tripId || route.params?.resumeId;

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      const t = await getTripLocal(tripId);
      setTrip(t || null);
    } catch (e) {
      console.warn('[TripReview] load error', e);
      Alert.alert('Hata', 'Gezi verisi yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const rows = useMemo(() => buildRows(trip), [trip]);

  const onEdit = useCallback((target) => {
    if (!tripId) return;
    const plan = {
      title:    { step: 0, returnAfterStep: 0 }, // Gezi adı → Step 0'da İleri → Review
      where:    { step: 1, returnAfterStep: 4 }, // Lokasyon → 2→3→4 akış, Step 4'te İleri → Review
      dates:    { step: 2, returnAfterStep: 4 }, // Tarih → 3→4 akış, Step 4'te İleri → Review
      startEnd: { step: 2, returnAfterStep: 4 }, // Başlangıç/Bitiş → 3→4 akış, Step 4'te İleri → Review
      lodging:  { step: 3, returnAfterStep: 3 }, // Konaklama → Step 3'te İleri → Review
      places:   { step: 4, returnAfterStep: 4 }, // Yerler → Step 4'te İleri → Review
    }[target];
    if (!plan) return;

    // dates-only / points-only ayrımı (StartEnd ekranda placeholder’lar)
    const fieldEdit =
      target === 'dates'    ? 'datesOnly'  :
      target === 'startEnd' ? 'pointsOnly' : null;

    nav.push('CreateTripWizard', {
      resumeId: tripId,
      jumpToStep: plan.step,
      returnTo: 'TripReview',
      editIntent: { target, returnAfterStep: plan.returnAfterStep, fieldEdit },
    });
  }, [nav, tripId]);

  const finalize = useCallback(async () => {
    if (!trip) return;
    try {
      setSaving(true);
      await saveTripLocal({ ...trip, status: 'active', wizardStep: null });
      nav.navigate('TripsHome', { refresh: Date.now() });
    } catch (e) {
      Alert.alert('Hata', 'Gezi kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  }, [trip, nav]);

  if (!tripId) {
    return (
      <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:16}}>
        <Text style={{color:'#fff'}}>Gezi bulunamadı. Lütfen sihirbazdan tekrar deneyin.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Gözden Geçir</Text>
        {!!trip?.title && <Text style={styles.subtitle}>{trip.title}</Text>}
      </View>

      <ScrollView contentContainerStyle={styles.table}>
        {rows.map((r, idx) => (
          <View key={idx} style={[styles.row, idx === 0 && styles.rowFirst]}>
            <View style={styles.left}>
              <Text style={styles.key}>{r.key}</Text>
              {r.help ? <Text style={styles.help}>{r.help}</Text> : null}
            </View>

            <View style={styles.right}>
              {r.type === 'titlePretty' ? (
                <TitlePretty trip={trip} />
              ) : r.type === 'wherePretty' ? (
                <WherePretty trip={trip} />
              ) : r.type === 'datePretty' ? (
                <DateRangePretty trip={trip} />
              ) : r.type === 'startEndPretty' ? (
                <StartEndPretty trip={trip} />
              ) : r.type === 'lodgingPretty' ? (
                <LodgingsPretty trip={trip} />
              ) : r.type === 'placesGroup' ? (
                <PlacesGrouped trip={trip} />
              ) : (
                <Text style={styles.value}>{r.value || '—'}</Text>
              )}

              {r.action ? (
                <TouchableOpacity style={styles.editBtn} onPress={() => onEdit(r.action)}>
                  <Ionicons name="create-outline" size={16} color={LINK} />
                  <Text style={styles.editText}>Düzenle</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.primaryBtn} onPress={finalize} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#0B141E" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#0B141E" />
              <Text style={styles.primaryBtnText}>Geziyi Tamamla</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/* ---------------- data shaping ---------------- */
function buildRows(trip) {
  if (!trip) return [];
  return [
    { key: 'Gezi Adı', type: 'titlePretty', action: 'title' },
    { key: 'Lokasyon', type: 'wherePretty', action: 'where' },
    { key: 'Tarih Aralığı', type: 'datePretty', action: 'dates' },
    { key: 'Başlangıç & Bitiş', type: 'startEndPretty', action: 'startEnd', help: 'Ulaşım noktaları ve saatler' },
    { key: 'Konaklama', type: 'lodgingPretty', action: 'lodging', help: 'Tarih aralığına göre şehir şehir' },
    { key: 'Seçilen Yerler', type: 'placesGroup', action: 'places', help: 'Gezilecek yerler + yeme-içme' },
  ];
}

/* ---------------- title pretty ---------------- */
function TitlePretty({ trip }) {
  const title = (trip?.title || '').trim() || '—';
  return (
    <View style={styles.titlePrettyWrap}>
      <View style={styles.titleIcon}>
        <Ionicons name="pricetag-outline" size={16} color={ACCENT} />
      </View>
      <Text style={styles.bigTitle} numberOfLines={2}>{title}</Text>
    </View>
  );
}

/* ---------------- where pretty ---------------- */
function getCityNamesFromTrip(trip) {
  if (Array.isArray(trip?.cities) && trip.cities.length) return trip.cities;
  const wa = trip?._whereAnswer;
  if (!wa) return [];
  if (wa.mode === 'single') return [wa.single?.city?.name].filter(Boolean);
  return (wa.items || []).map((it) => it.city?.name).filter(Boolean);
}
function WherePretty({ trip }) {
  const names = getCityNamesFromTrip(trip);
  if (!names.length) return <Text style={styles.value}>—</Text>;

  return (
    <View style={{gap:8}}>
      <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
        <Ionicons name="location-outline" size={16} color={ACCENT} />
        <Text style={styles.whereLabel}>{names.length > 1 ? `${names.length} şehir` : 'Şehir'}</Text>
      </View>
      <View style={{ flexDirection:'row', flexWrap:'wrap', gap:6 }}>
        {names.map((n, i) => <Badge key={`${n}-${i}`} text={n} tone="soft" />)}
      </View>
    </View>
  );
}

/* ---------------- date pretty ---------------- */
function DateRangePretty({ trip }) {
  const wa = trip?._whereAnswer;
  const dr = trip?.dateRange;
  let start = dr?.start || null;
  let end   = dr?.end   || null;

  if (!start || !end) {
    if (wa?.mode === 'single') {
      start = trip?._startEndSingle?.start?.date || null;
      end   = trip?._startEndSingle?.end?.date   || null;
    } else if (wa) {
      const dates = [];
      (wa.items || []).forEach(it => {
        const k  = it?.city?.place_id; const se = trip?._startEndByCity?.[k];
        if (se?.start?.date) dates.push(se.start.date);
        if (se?.end?.date)   dates.push(se.end.date);
      });
      if (dates.length) { dates.sort(); start = dates[0]; end = dates[dates.length-1]; }
    }
  }

  const nights = diffNights(start, end);
  return (
    <View style={styles.groupBox}>
      <View style={{ flexDirection:'row', gap:8, flexWrap:'wrap' }}>
        {!!start && <Badge text={`Başlangıç ${start}`} tone="soft" />}
        {!!end   && <Badge text={`Bitiş ${end}`} tone="soft" />}
        {!!(start && end) && <Badge text={`${nights} gece`} />}
      </View>
      {(!start || !end) && <Text style={styles.value}>Tarih aralığı eksik.</Text>}
    </View>
  );
}

/* ---------------- start/end pretty ---------------- */
function StartEndPretty({ trip }) {
  const wa = trip?._whereAnswer;
  if (!wa) return <Text style={styles.value}>—</Text>;

  if (wa.mode === 'single') {
    const se = trip?._startEndSingle || {};
    return (
      <View style={styles.groupBox}>
        <SELine label="Başlangıç" sePoint={se.start} />
        <SELine label="Bitiş" sePoint={se.end} />
      </View>
    );
  }

  const items = (wa.items || []).filter(it => it.city?.name);
  if (!items.length) return <Text style={styles.value}>—</Text>;
  return (
    <View style={{ gap: 10 }}>
      {items.map((it) => {
        const key = it.city.place_id;
        const se = trip?._startEndByCity?.[key];
        return (
          <View key={key} style={styles.cityGroup}>
            <Text style={styles.cityTitle}>{it.city.name}</Text>
            <View style={styles.groupBox}>
              <SELine label="Başlangıç" sePoint={se?.start} />
              <SELine label="Bitiş" sePoint={se?.end} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SELine({ label, sePoint }) {
  const iconName = typeToIcon(sePoint?.type);
  const hub = sePoint?.hub?.name || '—';
  const date = sePoint?.date || '—';
  const time = sePoint?.time || '—';
  return (
    <View style={styles.seRow}>
      <View style={styles.seLabelWrap}>
        <Text style={styles.seLabel}>{label}</Text>
      </View>
      <View style={styles.seBody}>
        <View style={styles.seIconWrap}>
          <Ionicons name={iconName} size={16} color={ACCENT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.seHub} numberOfLines={2}>{hub}</Text>
          <View style={styles.seMetaRow}>
            <Ionicons name="calendar-outline" size={14} color={MUTED} />
            <Text style={styles.seMetaText}>{date}</Text>
            <Ionicons name="time-outline" size={14} color={MUTED} style={{ marginLeft: 8 }} />
            <Text style={styles.seMetaText}>{time}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function typeToIcon(t) {
  switch (t) {
    case 'airport': return 'airplane-outline';
    case 'train':   return 'train-outline';
    case 'bus':     return 'bus-outline';
    case 'map':     return 'location-outline';
    default:        return 'location-outline';
  }
}

/* ---------------- lodging pretty ---------------- */
function LodgingsPretty({ trip }) {
  const wa = trip?._whereAnswer;
  if (!wa) return <Text style={styles.value}>—</Text>;

  // helpers
  const diffNights = (s, e) => {
    if (!s || !e || s >= e) return 0;
    const sd = new Date(s + 'T00:00:00'); const ed = new Date(e + 'T00:00:00');
    return Math.max(0, Math.round((ed - sd) / 86400000));
  };
  const addDaysISO = (s, n) => {
    const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n);
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  };
  const nightsBetween = (s, e) => {
    const out=[]; if(!s||!e||s>=e) return out;
    let cur=s; while(cur<e){ out.push(cur); cur=addDaysISO(cur,1); } return out;
  };
  const coverageInfo = (stays, range) => {
    const needed = nightsBetween(range.start, range.end);
    const covered = new Set();
    for (const s of (stays||[])) {
      if (!s.start || !s.end) continue;
      for (const d of nightsBetween(s.start, s.end)) covered.add(d);
    }
    const missing = needed.filter(d => !covered.has(d));
    return { missingCount: missing.length };
  };

  if (wa.mode === 'single') {
    const city = wa.single?.city?.name || '';
    const range = {
      start: trip?._startEndSingle?.start?.date || trip?.dateRange?.start || null,
      end:   trip?._startEndSingle?.end?.date   || trip?.dateRange?.end   || null,
    };
    const stays = (trip?._lodgingSingle || []).map(x => ({
      name: x?.place?.name || '—', start: x?.start, end: x?.end,
    }));
    const fallback = Array.isArray(trip?.lodgings) && !stays.length
      ? trip.lodgings.map(l => ({ name: l?.name || '—', start: l?.checkIn, end: l?.checkOut }))
      : [];
    const list = stays.length ? stays : fallback;
    const cov = (range.start && range.end) ? coverageInfo(list, range) : { missingCount: 0 };

    return (
      <View style={styles.groupBox}>
        <LodgingCityBlock city={city} list={list} range={range} cov={cov} />
      </View>
    );
  }

  const items = (wa.items || []).filter(it => it.city?.name);
  if (!items.length) return <Text style={styles.value}>—</Text>;

  return (
    <View style={{ gap: 10 }}>
      {items.map((it) => {
        const key = it.city.place_id;
        const city = it.city.name;
        const se = trip?._startEndByCity?.[key];
        const range = { start: se?.start?.date || null, end: se?.end?.date || null };
        const stays = (trip?._lodgingByCity?.[key] || []).map(x => ({
          name: x?.place?.name || '—', start: x?.start, end: x?.end,
        }));
        const cov = (range.start && range.end) ? coverageInfo(stays, range) : { missingCount: 0 };

        return (
          <View key={key} style={styles.cityGroup}>
            <Text style={styles.cityTitle}>{city}</Text>
            <View style={styles.groupBox}>
              <LodgingCityBlock city={city} list={stays} range={range} cov={cov} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function LodgingCityBlock({ city, list, range, cov }) {
  const totalNights = (range.start && range.end) ? (new Date(range.end) - new Date(range.start)) / 86400000 : 0;
  const missing = cov?.missingCount || 0;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <Badge text={`${city || '—'}`} tone="soft" />
        {!!range.start && !!range.end && <Badge text={`${range.start} → ${range.end}`} />}
        {!!range.start && !!range.end && <Badge text={`${totalNights} gece`} />}
        {missing > 0 && <Badge text={`Eksik ${missing} gece`} tone="danger" />}
      </View>

      {list && list.length ? (
        list.map((s, i) => (
          <View key={`${s.name}-${i}`} style={styles.lodgeRow}>
            <Ionicons name="bed-outline" size={16} color="#93C5FD" style={{ marginTop: 2 }} />
            <View style={{ flex:1 }}>
              <Text style={styles.lodgeName} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.lodgeMeta}>
                {(s.start && s.end) ? `${s.start} → ${s.end} • ${Math.max(0, (new Date(s.end)-new Date(s.start))/86400000)} gece` : '—'}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.value}>Kayıt yok.</Text>
      )}
    </View>
  );
}

/* ---------------- places grouped ---------------- */
const GROUPS = [
  { key: 'restaurants', label: 'Restoranlar' },
  { key: 'cafes',       label: 'Kafeler' },
  { key: 'bars',        label: 'Barlar' },
  { key: 'sights',      label: 'Turistik Yerler' },
  { key: 'museums',     label: 'Müzeler' },
  { key: 'parks',       label: 'Parklar' },
];

function getPlacesArray(trip) {
  return Array.isArray(trip?.places) && trip.places.length
    ? trip.places
    : (Array.isArray(trip?.selectedPlaces) ? trip.selectedPlaces : []);
}

function PlacesGrouped({ trip }) {
  const arr = getPlacesArray(trip);
  if (!arr.length) return <Text style={styles.value}>Seçim yok</Text>;

  const byCat = new Map(GROUPS.map(g => [g.key, []]));
  for (const p of arr) {
    const k = byCat.has(p.category) ? p.category : 'sights';
    byCat.get(k).push(p);
  }

  return (
    <View style={styles.groupBox}>
      {GROUPS.map((g) => {
        const items = byCat.get(g.key) || [];
        if (!items.length) return null;
        return (
          <View key={g.key} style={styles.groupRow}>
            <Text style={styles.groupTitle}>{g.label}</Text>
            {items.map((p, i) => (
              <Text key={`${g.key}-${i}`} style={styles.groupItem}>• {p.name}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/* ---------------- utils ---------------- */
function diffNights(s, e) {
  if (!s || !e) return 0;
  const sd = new Date(s + 'T00:00:00'); const ed = new Date(e + 'T00:00:00');
  return Math.max(0, Math.round((ed - sd) / 86400000));
}

/* ---------------- styles ---------------- */
function Badge({ text, tone = 'primary'|'soft' }) {
  const map = {
    primary: { bg: '#0B1220', br: '#1F2937', fg: '#A7F3D0' },
    soft:    { bg: '#0B1220', br: '#1F2937', fg: '#D1FAE5' },
    danger:  { bg: '#2A0F13', br: '#7F1D1D', fg: '#FCA5A5' },
  }[tone] || { bg: '#0B1220', br: '#1F2937', fg: '#D1FAE5' };
  return (
    <View style={{ paddingHorizontal:8, paddingVertical:4, borderRadius:999, borderWidth:1, backgroundColor:map.bg, borderColor:map.br }}>
      <Text style={{ color: map.fg, fontWeight:'800', fontSize:12 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B141E' },
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  title: { color: FG, fontSize: 18, fontWeight: '700' },
  subtitle: { color: MUTED, marginTop: 4 },

  table: { padding: 12 },
  row: { borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 12, marginBottom: 10, backgroundColor: '#0F1824' },
  rowFirst: { marginTop: 6 },
  left: { marginBottom: 6 },
  right: { gap: 8 },

  key: { color: FG, fontWeight: '600', marginBottom: 2 },
  help: { color: MUTED, fontSize: 12 },

  value: { color: FG, paddingRight: 12 },

  editBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#1F2937', backgroundColor: '#0B1220' },
  editText: { color: LINK, fontWeight: '600', marginLeft: 4 },

  primaryBtn: { marginTop: 12, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#34D399', borderWidth: 1, borderColor: '#065F46', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  primaryBtnText: { color: '#0B141E', fontWeight: '900' },

  // grouped box & lists
  groupBox: { borderWidth: 1, borderColor: '#1F2937', borderRadius: 12, padding: 10, backgroundColor: '#0C1420', gap: 8 },
  lodgeRow: { flexDirection:'row', gap:10, alignItems:'flex-start', paddingVertical:2 },
  lodgeName: { color: '#E5E7EB', fontWeight: '700' },
  lodgeMeta: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  groupRow: { marginBottom: 4 },
  groupTitle: { color: '#D1FAE5', fontWeight: '800', marginBottom: 4 },
  groupItem: { color: FG, marginLeft: 6, marginBottom: 2 },

  // start/end pretty
  cityGroup: { gap: 6 },
  cityTitle: { color: '#FDE68A', fontWeight: '800' },
  seRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  seLabelWrap: { width: 84, paddingTop: 2 },
  seLabel: { color: '#C7D2FE', fontWeight: '800' },
  seBody: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  seIconWrap: { width: 24, alignItems: 'center', paddingTop: 2 },
  seHub: { color: FG, fontWeight: '700' },
  seMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  seMetaText: { color: MUTED, marginLeft: 4 },

  // title pretty
  titlePrettyWrap: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:2 },
  titleIcon: { width:24, height:24, borderRadius:999, borderWidth:1, borderColor:'#1F2937', alignItems:'center', justifyContent:'center', backgroundColor:'#0B1220' },
  bigTitle: { color: '#EAEAEA', fontWeight:'900', fontSize:16 },

  // where pretty
  whereLabel: { color: '#B3EDE3', fontWeight:'800' },
});
