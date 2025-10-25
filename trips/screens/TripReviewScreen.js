// trips/screens/TripReviewScreen.js
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, DeviceEventEmitter, Platform, ToastAndroid } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';

import { listTripsLocal, getTripLocal, patchTripLocal } from '../../app/lib/tripsLocal';
import { generatePlan } from '../services/planService';
import { savePlan } from '../shared/plansRepo';
import { resolvePlacesBatch } from '../services/placeResolver';
import { API_BASE } from '../../app/lib/api';

const BORDER = '#23262F';
const FG = '#EAEAEA';
const MUTED = '#9CA3AF';
const ACCENT = '#5EEAD4';
const LINK = '#0EA5E9';
const EVT_TRIP_META_UPDATED = 'TRIP_META_UPDATED';

/* ---------------- canonical helpers (client ile aynı mantık) ---------------- */
const round5 = (x) => Math.round(Number(x) * 1e5) / 1e5;

function stripBrackets(s = '') {
  return String(s).replace(/\s*[\(\[\{].*?[\)\]\}]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
function removeSuffixes(s = '') {
  const kill = [
    'restaurant','restoran','cafe','kafe','pastane','patisserie','bakery',
    'bar','pub','coffee','kahve','lokanta','büfe','bufe','branch','şubesi','sube',
    'ankara','istanbul','izmir'
  ];
  let t = String(s || '').toLowerCase();
  t = t.replace(/[-–—•|]+/g, ' ');
  for (let i = 0; i < 3; i++) t = t.replace(new RegExp(`\\b(${kill.join('|')})\\b`, 'g'), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length ? t : String(s || '').toLowerCase();
}
function trFold(s = '') {
  const map = { İ:'I', I:'I', ı:'i', Ş:'S', ş:'s', Ğ:'G', ğ:'g', Ü:'U', ü:'U', Ö:'O', ö:'O', Ç:'C', ç:'C' };
  const str = String(s || '');
  try {
    return str
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return str
      .replace(/[İIıŞşĞğÜüÖöÇç]/g, ch => map[ch] || ch)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
function canonicalName(s = '') {
  return trFold(removeSuffixes(stripBrackets(s)));
}

/** Eşleştirme anahtarı: name_norm@round5(seed_lat),round5(seed_lon)
 *  - x._seed_coords varsa onu kullanır (sabit kalır)
 *  - yoksa x.coords/lat/lon düşer
 */
function seedKey(x) {
  const nm = canonicalName(String(x?.name || ''));
  // seed coords → dönüşte resolvePlacesBatch x._seed_coords'ı saklıyor olmalı
  const seed = x?._seed_coords || null;
  const lat = Number(seed?.lat ?? x?.lat ?? x?.coords?.lat);
  const lon = Number(seed?.lng ?? seed?.lon ?? x?.lon ?? x?.coords?.lng ?? x?.coords?.lon);
  const la5 = round5(lat);
  const lo5 = round5(lon);
  return `${nm}@${la5},${lo5}`;
}

/* ---------------- helpers ---------------- */
function ensureIds(t) {
  if (!t) return t;
  const _id = t._id ?? t.id;
  const id = t.id ?? _id;
  return { ...t, _id, id };
}

async function pickMostRecentTripId() {
  const rows = await listTripsLocal().catch(() => []);
  const arr = (rows || []).filter(r => !r?.deleted).map(ensureIds);
  if (!arr.length) return null;
  const drafts = arr.filter(t => t.status === 'draft');
  const pick = (drafts.length ? drafts : arr)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
  return pick?._id ?? pick?.id ?? null;
}

export default function TripReviewScreen() {
  const nav = useNavigation();
  const route = useRoute();

  const [tripId, setTripId] = useState(
    route.params?.tripId ?? route.params?.resumeId ?? route.params?.id ?? null
  );
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booting, setBooting] = useState(!tripId); // parametre yoksa fallback denenecek

  function addDaysISO(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function nightsBetween(start, end) {
  const out=[]; if(!start||!end||start>=end) return out;
  let cur=start; while(cur<end){ out.push(cur); cur=addDaysISO(cur,1); } return out;
}
function segmentsToLodgingsAllCities(trip) {
  const wa = trip?._whereAnswer;
  if (!wa) return [];

  const collect = (segments=[]) => {
    const out = [];
    (segments || []).forEach((seg, idx) => {
      if (!seg?.place?.location || !seg?.start || !seg?.end) return;
      const loc = seg.place.location;
      for (const date of nightsBetween(seg.start, seg.end)) {
        out.push({
          id: seg.id || `lodg:${idx}:${date}`,
          name: seg.place.name || 'Lodging',
          address: seg.place.address || null,
          date,
          location: { lat: loc.lat, lon: (loc.lng ?? loc.lon) },
        });
      }
    });
    return out;
  };

  if (wa.mode === 'single') {
    return collect(trip?._lodgingSingle || []);
  }
  const items = (wa.items || []).filter(it => it.city?.place_id);
  let all = [];
  items.forEach(it => {
    const key = it.city.place_id;
    all = all.concat(collect(trip?._lodgingByCity?.[key] || []));
  });
  return all;
}

  // Parametre yoksa en güncel geziyi otomatik seç
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (tripId) { setBooting(false); return; }
      const guess = await pickMostRecentTripId();
      if (!mounted) return;
      if (guess) setTripId(guess);
      setBooting(false);
    })();
    return () => { mounted = false; };
  }, [tripId]);

  const reload = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);
    try {
      // Önce direkt dene
      let t = await getTripLocal(tripId);
      // Olmazsa, id/_id karışıklığı olabilir → listeden bul
      if (!t) {
        const rows = await listTripsLocal().catch(() => []);
        const match = (rows || []).find(r => r.id === tripId || r._id === tripId);
        if (match?._id) {
          t = await getTripLocal(match._id);
          if (!t) t = ensureIds(match);
          setTripId(match._id);
        }
      }
      setTrip(ensureIds(t) || null);
    } catch (e) {
      console.warn('[TripReview] load error', e);
      Alert.alert('Hata', 'Gezi verisi yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  // Wizard’dan ts paramı ile dönüldüğünde zorla yeniden yükle
  useEffect(() => {
    if (route?.params?.ts) reload();
  }, [route?.params?.ts, reload]);

  const rows = useMemo(() => buildRows(trip), [trip]);

  const onEdit = useCallback((target) => {
    if (!tripId) return;
    const plan = {
      title:    { step: 0, returnAfterStep: 0 },
      where:    { step: 1, returnAfterStep: 4 },
      dates:    { step: 2, returnAfterStep: 4 },
      startEnd: { step: 2, returnAfterStep: 4 },
      lodging:  { step: 3, returnAfterStep: 3 },
      places:   { step: 4, returnAfterStep: 4 },
    }[target];
    if (!plan) return;

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

  // küçük helper – Android’de Toast, iOS’ta Alert
  const notify = useCallback((msg) => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.LONG);
    else Alert.alert('Bilgi', msg);
  }, []);

  /* ---------------- Re-resolve (Yeniden Eşle) ---------------- */
  const reResolve = useCallback(async () => {
    if (!trip) return;

    const all = getPlacesArray(trip);
    if (!all.length) {
      Alert.alert('Bilgi', 'Eşlenecek yer bulunamadı.');
      return;
    }

    // Kaynak alanı: places mi selectedPlaces mı?
    const sourceField = Array.isArray(trip?.places) && trip.places.length ? 'places'
                     : (Array.isArray(trip?.selectedPlaces) ? 'selectedPlaces' : 'places');

    const unresolved = all.filter(p => {
      if (p?.place_id) return false;
      const lat = Number(p?.lat ?? p?.coords?.lat);
      const lon = Number(p?.lon ?? p?.coords?.lng ?? p?.coords?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) && (p?.name || '').trim().length > 0;
    });

    if (!unresolved.length) {
      Alert.alert('Tamam', 'Şu an eşleşmeyen kayıt yok.');
      return;
    }

    try {
      setLoading(true);

      const cityName =
        (Array.isArray(trip?.cities) && trip.cities[0]) ||
        (trip?._whereAnswer?.mode === 'single' ? trip?._whereAnswer?.single?.city?.name : null) ||
        '';

      // 1) Batch resolve (cache + fallback)
      const batch = await resolvePlacesBatch({
        items: unresolved,
        city: cityName || ''
      });

      // 2) Eski listeyi SEED-KEY ile birleştir
      const byKey = new Map(batch.map(nn => [seedKey(nn), nn]));
      const merged = all.map(old => {
        if (old?.place_id) return old;
        const kOld = seedKey(old);
        const nn = byKey.get(kOld);
        if (nn?.place_id) {
          // Google koordinatı varsa UI için yaz
          const gLat = Number(nn?.coords?.lat ?? nn?.lat);
          const gLon = Number(nn?.coords?.lng ?? nn?.lon);
          const coordsNew = (Number.isFinite(gLat) && Number.isFinite(gLon)) ? { lat: gLat, lng: gLon } : (old.coords || null);

          return {
            ...old,
            place_id: nn.place_id,
            resolved: true,
            coords: coordsNew || old.coords || null,
            lat: coordsNew?.lat ?? old.lat,
            lon: coordsNew?.lng ?? old.lon,
            opening_hours: nn.opening_hours ?? old.opening_hours ?? null,
            rating: nn.rating ?? old.rating ?? null,
            user_ratings_total: nn.user_ratings_total ?? old.user_ratings_total ?? null,
            price_level: nn.price_level ?? old.price_level ?? null,
            _matched: true,
          };
        }
        return old;
      });

      // 3) Kaynağa geri yaz
      const key = trip._id ?? trip.id;
      await patchTripLocal(key, {
        [sourceField]: merged,
        updatedAt: new Date().toISOString(),
        __dirty: true,
      });

      setTrip(prev => ({ ...(prev || {}), [sourceField]: merged }));
      DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: key, patch: { [sourceField]: merged } });
      Alert.alert('Tamam', 'Yeniden eşleştirme tamamlandı.');
    } catch (e) {
      console.warn('[TripReview] reResolve error', e);
      Alert.alert('Hata', 'Yeniden eşleştirme başarısız.');
    } finally {
      setLoading(false);
    }
  }, [trip]);

  /* ---------------- Finalize ---------------- */
  const finalize = useCallback(async () => {
    if (!trip) return;
    try {
      setSaving(true);

      // 0) Kaynak alan ve şehir adı
      const sourceField =
        Array.isArray(trip?.places) && trip.places.length ? 'places'
        : (Array.isArray(trip?.selectedPlaces) ? 'selectedPlaces' : 'places');
      const allPlaces = getPlacesArray(trip);
      const cityName =
        (Array.isArray(trip?.cities) && trip.cities[0]) ||
        (trip?._whereAnswer?.mode === 'single' ? trip?._whereAnswer?.single?.city?.name : null) ||
        '';

      // 1) EŞLEŞTİR (arka planda sessizce)
      const candidates = allPlaces.filter(p => {
        if (p?.place_id) return false;
        const lat = Number(p?.lat ?? p?.coords?.lat);
        const lon = Number(p?.lon ?? p?.coords?.lng ?? p?.coords?.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) && (p?.name || '').trim().length > 0;
      });

      let mergedPlaces = allPlaces;
      if (candidates.length) {
        const batch = await resolvePlacesBatch({ items: candidates, city: cityName || '' });
        const byKey = new Map(batch.map(nn => [seedKey(nn), nn]));
        mergedPlaces = allPlaces.map(old => {
          if (old?.place_id) return old;
          const nn = byKey.get(seedKey(old));
          if (nn?.place_id) {
            const gLat = Number(nn?.coords?.lat ?? nn?.lat);
            const gLon = Number(nn?.coords?.lng ?? nn?.lon);
            const coordsNew = (Number.isFinite(gLat) && Number.isFinite(gLon)) ? { lat: gLat, lng: gLon } : (old.coords || null);

            return {
              ...old,
              place_id: nn.place_id,
              resolved: true,
              coords: coordsNew || old.coords || null,
              lat: coordsNew?.lat ?? old.lat,
              lon: coordsNew?.lng ?? old.lon,
              opening_hours: nn.opening_hours ?? old.opening_hours ?? null,
              rating: nn.rating ?? old.rating ?? null,
              user_ratings_total: nn.user_ratings_total ?? old.user_ratings_total ?? null,
              price_level: nn.price_level ?? old.price_level ?? null,
              _matched: true,
            };
          }
          return old;
        });
      }

      // 1.5) Bilgilendir
      const stillUnresolved = mergedPlaces.filter(p => !p.place_id && (p?.lat || p?.coords)).length;
      const noCoords = mergedPlaces.filter(p => !p.place_id && !p?.lat && !p?.coords).length;
      if (stillUnresolved > 0 && noCoords === 0) {
        notify('Plan hazır 🎉  Bazı yerlerin bilgileri doğrulanamadı; yine de rotaya esnek olarak ekledik.');
      } else if (noCoords > 0) {
        notify(`Plan hazır 🎉  ${noCoords} yerin konumu bulunamadı, şimdilik plandan çıkarıldı.`);
        mergedPlaces = mergedPlaces.filter(p => p?.coords || (p?.lat != null && p?.lon != null));
      }

      // 1.6) Trip’e yaz (eşleşmiş yerler)
      const key = trip._id ?? trip.id;
      await patchTripLocal(key, {
        [sourceField]: mergedPlaces,
        updatedAt: new Date().toISOString(),
        __dirty: true,
      });

      // 2) Geziyi finalize et → completed (ardından plan)
      const when = new Date().toISOString();
      await patchTripLocal(key, { status: 'completed', wizardStep: null, updatedAt: when, __dirty: true });
      let completedTrip = ensureIds({
        ...trip,
        [sourceField]: mergedPlaces,
        status: 'completed',
        wizardStep: null,
        updatedAt: when
      });

      setTrip(completedTrip);

      // Liste olayını yayınla
      try {
        DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, {
          tripId: key,
          patch: { status: 'completed', wizardStep: null, updatedAt: when },
        });
      } catch {}

      // 3) Plan üret + kaydet (eşleşmiş yerlerle)
      const uiMode = trip?.travelMode || 'walk_transport';
      const routingMode = uiMode === 'car_taxi' ? 'driving' : 'walking';
      
// 🔹 Lodging’leri garanti et (tüm şehirler)
       let lodgingsAll = Array.isArray(completedTrip?.lodgings) ? completedTrip.lodgings : [];
       if (!lodgingsAll.length) {
         lodgingsAll = segmentsToLodgingsAllCities(completedTrip);
         if (lodgingsAll.length) {
           const key2 = completedTrip._id ?? completedTrip.id;
           await patchTripLocal(key2, { lodgings: lodgingsAll, updatedAt: new Date().toISOString(), __dirty: true });
           completedTrip = { ...completedTrip, lodgings: lodgingsAll };
         }
       }

      const prefs = {
        dayStart: '09:30',
        dayEnd: '20:00',
        lunchAround: '13:00',
        dinnerAround: '19:00',
        defaultDurations: { museum: 90, sights: 45, restaurants: 60, cafes: 40, parks: 40, bars: 75 },
        tempo: 'normal',
        travelMode: routingMode,
        mealSearchRadiusMeters: 1200,
        minRating: 4.2,
      };
      const plan = await generatePlan(completedTrip, prefs, { useRealDirections: true });
      await savePlan(plan);

      // 4) Stack reset
      nav.reset({
        index: 1,
        routes: [
          { name: 'TripsHome' },
          { name: 'TripPlans', params: { tripId: completedTrip._id } },
        ],
      });
    } catch (e) {
      console.warn('[TripReview] finalize error', e);
      Alert.alert('Hata', 'Gezi tamamlanırken sorun oluştu.');
    } finally {
      setSaving(false);
    }
  }, [trip, nav]);

  // ---- render guards ----
  if (booting) {
    return (
      <View style={{flex:1,alignItems:'center',justifyContent:'center', backgroundColor:'#0B141E'}}>
        <ActivityIndicator />
        <Text style={{color:'#9CA3AF', marginTop:8}}>Hazırlanıyor…</Text>
      </View>
    );
  }

  if (!tripId) {
    return (
      <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:16, backgroundColor:'#0B141E'}}>
        <Text style={{color:'#fff', fontWeight:'700', marginBottom:6}}>Gezi bulunamadı.</Text>
        <Text style={{color:'#9CA3AF'}}>Lütfen sihirbazdan tekrar deneyin.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{flex:1,alignItems:'center',justifyContent:'center', backgroundColor:'#0B141E'}}>
        <ActivityIndicator />
        <Text style={{color:'#9CA3AF', marginTop:8}}>Yükleniyor…</Text>
      </View>
    );
  }

  if (!trip) {
    return (
      <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:16, backgroundColor:'#0B141E'}}>
        <Text style={{color:'#fff', fontWeight:'700', marginBottom:6}}>Gezi bulunamadı.</Text>
        <Text style={{color:'#9CA3AF'}}>Kayıt erişilemiyor. Lütfen geri dönün.</Text>
      </View>
    );
  }

  // ---- main ----
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
              ) : r.type === 'travelModePretty' ? (
                <TravelModePretty trip={trip} />
              ) : r.type === 'placesGroup' ? (
                <PlacesGrouped trip={trip} onRetry={reResolve} />
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
    { key: 'Ulaşım', type: 'travelModePretty', help: 'Varsayılan mod (harita ve rota)' },
    { key: 'Seçilen Yerler', type: 'placesGroup', action: 'places', help: 'Gezilecek yerler + yeme-içme' },
  ];
}

function TravelModePretty({ trip }) {
  // UI anahtarları: 'walk_transport' | 'car_taxi'
  const mode = trip?.travelMode || 'walk_transport';

  const label = mode === 'car_taxi' ? 'Car & Taxi' : 'Walk & Transportation';
  const icon  = mode === 'car_taxi' ? 'car-outline' : 'walk-outline';
  const tone  = mode === 'car_taxi' ? 'primary' : 'soft';

  return (
    <View style={styles.groupBox}>
      <View style={{ flexDirection:'row', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <Ionicons name={icon} size={16} color={ACCENT} />
        <Badge text={label} tone={tone} />
      </View>
      <Text style={[styles.help, { marginTop:6 }]}>
        Bu seçim rota/harita için varsayılan moddur. (Lodging adımından değiştirilebilir.)
      </Text>
    </View>
  );
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
function diffNights(s, e) {
  if (!s || !e) return 0;
  const sd = new Date(s + 'T00:00:00'); const ed = new Date(e + 'T00:00:00');
  return Math.max(0, Math.round((ed - sd) / 86400000));
}
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
      {!!(trip?.places?.length) && getPlacesArray(trip).some(p => !p.opening_hours) && (
        <Text style={[styles.help,{marginTop:6}]}>Bazı yerlerde açılış-kapanış bilgisi yok; plana esnek yerleştirilecek.</Text>
      )}
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

function PlacesGrouped({ trip, onRetry }) {
  const arr = getPlacesArray(trip);
  if (!arr.length) return <Text style={styles.value}>Seçim yok</Text>;

  const byCat = new Map(GROUPS.map(g => [g.key, []]));
  for (const p of arr) {
    const k = byCat.has(p.category) ? p.category : 'sights';
    byCat.get(k).push(p);
  }

  const total = arr.length;
  const matched = arr.filter(p => p.place_id).length;

  return (
    <View style={styles.groupBox}>
      {GROUPS.map((g) => {
        const items = byCat.get(g.key) || [];
        if (!items.length) return null;
        return (
          <View key={g.key} style={styles.groupRow}>
            <Text style={styles.groupTitle}>{g.label}</Text>
            {items.map((p, i) => (
              <View key={`${g.key}-${i}`} style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:2,flexWrap:'wrap'}}>
                <Text style={styles.groupItem}>• {p.name}</Text>
                {/* görünür rozetler */}
                {p.place_id ? <Badge text="Eşleşti" tone="primary" /> : <Badge text="Eşleşmedi" tone="danger" />}
                {!!p.opening_hours && <Badge text="Saat var" tone="soft" />}
              </View>
            ))}
          </View>
        );
      })}

      {__DEV__ && (
        <View style={{marginTop:8, padding:10, borderWidth:1, borderColor:'#1F2937', borderRadius:10}}>
          <Text style={{color:'#EAEAEA', fontWeight:'700'}}>Yer Eşleşmeleri (DEV)</Text>
          <Text style={{color:'#9CA3AF', marginTop:4}}>
            Eşleşen: {matched} / {total}
          </Text>
          <TouchableOpacity
            onPress={onRetry}
            style={{marginTop:8, alignSelf:'flex-start', paddingVertical:8, paddingHorizontal:12, borderRadius:10, borderWidth:1, borderColor:'#2563EB', backgroundColor:'#0E1B2E'}}
          >
            <Text style={{color:'#fff', fontWeight:'700'}}>Yeniden Eşle</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/* ---------------- styles ---------------- */
function Badge({ text, tone = 'primary' }) {
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

  groupBox: { borderWidth: 1, borderColor: '#1F2937', borderRadius: 12, padding: 10, backgroundColor: '#0C1420', gap: 8 },
  lodgeRow: { flexDirection:'row', gap:10, alignItems:'flex-start', paddingVertical:2 },
  lodgeName: { color: '#E5E7EB', fontWeight: '700' },
  lodgeMeta: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  groupRow: { marginBottom: 4 },
  groupTitle: { color: '#D1FAE5', fontWeight: '800', marginBottom: 4 },
  groupItem: { color: FG, marginLeft: 6, marginBottom: 2 },

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

  titlePrettyWrap: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:2 },
  titleIcon: { width:24, height:24, borderRadius:999, borderWidth:1, borderColor:'#1F2937', alignItems:'center', justifyContent:'center', backgroundColor:'#0B1220' },
  bigTitle: { color: '#EAEAEA', fontWeight:'900', fontSize:16 },

  whereLabel: { color: '#B3EDE3', fontWeight:'800' },
});
