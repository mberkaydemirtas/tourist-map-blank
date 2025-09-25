import React, { useMemo, useState, useEffect } from 'react';
import {
  Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList,
  DeviceEventEmitter, InteractionManager,
} from 'react-native';
const EVT_CLOSE_DROPDOWNS = 'CLOSE_ALL_DROPDOWNS';
import { useNavigation, useRoute } from '@react-navigation/native';

// Local-first storage
import { createTripLocal, saveTripLocal } from '../app/lib/tripsLocal';

// Soru bileşenleri
import WhereToQuestion from './components/WhereToQuestion';
import StartEndQuestion from './components/StartEndQuestion';
import LodgingQuestion from './components/LodgingQuestion';
import TripListQuestion from './components/TripListQuestion';

// Harita köprüsü
import { useTripsExploreBridge } from '../bridges/useTripsExploreBridge';

const BORDER = '#23262F';
const BTN = '#2563EB';

/* ---------------------- Yardımcılar: Gün listesi & DP ---------------------- */
function dateRangeDays(startISO, endISO) {
  if (!startISO || !endISO) return [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const days = [];
  const d = new Date(start);
  while (d <= end) {
    days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/** Yeni tarih aralığına göre dailyPlan kurar/yeniler.
 *  Eski dailyPlan varsa, aynı index'teki günler korunur.
 */
function buildDailyPlan(startDate, endDate, prevDP = []) {
  const days = dateRangeDays(startDate, endDate);
  if (!days.length) return [];
  const next = days.map((d, i) => {
    const prev = prevDP[i];
    return {
      date: d,
      visits: Array.isArray(prev?.visits) ? prev.visits : [], // { id,name,lat,lng,address }
    };
  });
  return next;
}

export default function CreateTripWizardScreen() {
  const nav = useNavigation();
  const route = useRoute();

  const [step, setStep] = useState(0);

  // Step 0 — Nereye gidiyorsun?
  const [whereAnswer, setWhereAnswer] = useState(null); // { mode: 'single'|'multi', single?, items? }

  // Step 1 — Başlangıç & Bitiş
  const [startEndSingle, setStartEndSingle] = useState(null);
  const [startEndByCity, setStartEndByCity] = useState({});
  const [cityIndex, setCityIndex] = useState(0);

  // Step 2 — Konaklama
  const [lodgingSingle, setLodgingSingle] = useState([]); // [{ place, start, end }, ...]
  const [lodgingByCity, setLodgingByCity] = useState({}); // { [cityKey]: [{...}] }

  // Step 3 — Gezilecek Yerler (TripListQuestion) için günlük plan
  const [selectedPlaces, setSelectedPlaces] = useState([]);
  const [dailyPlan, setDailyPlan] = useState([]); // [{ date:'YYYY-MM-DD', visits:[{id,name,lat,lng,address}] }]

  // Yerel taslak — wizard’a girince bir kez oluştur
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    (async () => {
      const t = await createTripLocal({ title: 'New Trip' });
      setDraft(t);
    })();
  }, []);

  // Step 2'ye girildiğinde, multi-city ise ilk şehre dön
  useEffect(() => {
    if (step === 2 && whereAnswer?.mode === 'multi') setCityIndex(0);
  }, [step, whereAnswer?.mode]);

  // ✅ Step 3'e girildiğinde de multi-city ise ilk şehre dön (Ankara → … → Antalya)
  useEffect(() => {
    if (step === 3 && whereAnswer?.mode === 'multi') setCityIndex(0);
  }, [step, whereAnswer?.mode]);

  // Segments <-> Stays (ID’yi koru)
  const staysFromSegments = (segs = []) => segs.map((s, i) => ({
    id: s.id || `${s?.place?.place_id || 'seg'}_${i}`,
    place: s.place || null,
    startDate: s.start || null,
    endDate: s.end || null,
  }));
  const segmentsFromStays = (stays = []) => stays.map(s => ({
    id: s.id,
    place: s.place || null,
    start: s.startDate || null,
    end: s.endDate || null,
  }));

  // Türev state (aktif şehir objesi & key)
  const activeCityObj = useMemo(() => {
    if (whereAnswer?.mode === 'single') {
      return whereAnswer.single?.city
        ? { ...whereAnswer.single.city, country: whereAnswer.single.countryCode }
        : null;
    }
    const arr = (whereAnswer?.items || []).filter(it => it.city?.name);
    return arr[cityIndex]?.city ? { ...arr[cityIndex].city, country: arr[cityIndex].countryCode } : null;
  }, [whereAnswer, cityIndex]);

  const activeCityKey = useMemo(() => {
    if (!whereAnswer) return null;
    if (whereAnswer.mode === 'single') return whereAnswer.single?.city?.place_id || null;
    const arr = (whereAnswer.items || []).filter(it => it.city?.name);
    return arr[cityIndex]?.city?.place_id || null;
  }, [whereAnswer, cityIndex]);

  const activeRange = useMemo(() => {
    if (!whereAnswer || !activeCityKey) return { start: null, end: null };
    if (whereAnswer.mode === 'single') {
      return { start: startEndSingle?.start?.date || null, end: startEndSingle?.end?.date || null };
    } else {
      const se = startEndByCity[activeCityKey];
      return { start: se?.start?.date || null, end: se?.end?.date || null };
    }
  }, [whereAnswer, activeCityKey, startEndSingle, startEndByCity]);

  // Harita köprüsü
  const bridge = useTripsExploreBridge({
    nav,
    route,
    
    onPick: (pick) => {
      if (whereAnswer?.mode === 'single') {
        if (pick.which === 'start' || pick.which === 'end') {
          setStartEndSingle(prev => ({
            ...(prev || {}),
            [pick.which]: {
              ...(prev?.[pick.which] || { date: null, time: pick.which === 'start' ? '09:00' : '17:00' }),
              type: 'map',
              hub: pick.hub,
            },
          }));
        }
      } else if (pick.cityKey) {
        if (pick.which === 'start' || pick.which === 'end') {
          setStartEndByCity(prev => ({
            ...prev,
            [pick.cityKey]: {
              ...(prev[pick.cityKey] || {}),
              [pick.which]: {
                ...(prev[pick.cityKey]?.[pick.which] || { date: null, time: pick.which === 'start' ? '09:00' : '17:00' }),
                type: 'map',
                hub: pick.hub,
              },
            },
          }));
        }
      }
      // lodging pick'i LodgingQuestion içinde await ile dönüyor
    },
  });

  /* -------------------------- STEP 1 VALIDATION -------------------------- */
  function seComplete(se) {
    return !!(
      se?.start?.type && se?.start?.hub && se?.start?.date && se?.start?.time &&
      se?.end?.type   && se?.end?.hub   && se?.end?.date   && se?.end?.time
    );
  }
  function seOrderOk(se) {
    const s = se?.start?.date, e = se?.end?.date;
    return !!(s && e && s <= e);
  }

  // Multi-city: komşular arasında çakışma olmasın (start[i+1] ≥ end[i])
  const step1Valid = useMemo(() => {
    if (!whereAnswer) return false;

    if (whereAnswer.mode === 'single') {
      const v = startEndSingle;
      return seComplete(v) && seOrderOk(v);
    }

    const items = (whereAnswer.items || []).filter(it => it.city?.name);
    if (!items.length) return false;

    const allCompleteAndOrdered = items.every(it => {
      const se = startEndByCity[it.city.place_id];
      return seComplete(se) && seOrderOk(se);
    });
    if (!allCompleteAndOrdered) return false;

    for (let i = 0; i < items.length - 1; i++) {
      const aKey = items[i].city.place_id;
      const bKey = items[i + 1].city.place_id;
      const aEnd = startEndByCity[aKey]?.end?.date;
      const bStart = startEndByCity[bKey]?.start?.date;
      if (aEnd && bStart && bStart < aEnd) return false;
    }
    return true;
  }, [whereAnswer, startEndSingle, startEndByCity]);

  // Gece sayısı (global)
  const nights = useMemo(() => {
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    if (!range.start || !range.end) return 0;
    return diffNights(range.start, range.end);
  }, [whereAnswer, startEndSingle, startEndByCity]);

  // İleri buton durumu
  const canNext = useMemo(() => {
    if (step === 0) {
      if (!whereAnswer) return false;
      if (whereAnswer.mode === 'single') return !!(whereAnswer.single?.countryCode && whereAnswer.single?.city?.name);
      return (whereAnswer.items || []).some(it => it.countryCode && it.city?.name);
    }
    if (step === 1) return step1Valid;
    if (step === 2) {
      if (!whereAnswer) return false;
      const rangeOk = (segs, rng) =>
        segs.length > 0 &&
        segs.every(s => s.place?.name && s.start && s.end && rng.start && rng.end && s.start >= rng.start && s.end <= rng.end && s.end > s.start);

      if (whereAnswer.mode === 'single') return rangeOk(lodgingSingle, activeRange);

      const arr = (whereAnswer.items || []).filter(it => it.city?.name);
      return arr.every(it => {
        const key = it.city.place_id;
        const rng = { start: startEndByCity[key]?.start?.date, end: startEndByCity[key]?.end?.date };
        const segs = lodgingByCity[key] || [];
        return rangeOk(segs, rng);
      });
    }
    // Step 3 (TripListQuestion) için zorunluluk yok; kullanıcı boş bırakabilir.
    return true;
  }, [step, whereAnswer, step1Valid, lodgingSingle, lodgingByCity, activeRange, startEndByCity]);

  const safeStepChange = (updater) => {
    DeviceEventEmitter.emit(EVT_CLOSE_DROPDOWNS);
    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        updater();
      });
    });
  };

  const next = () => {
    if (!canNext) return Alert.alert('Eksik bilgi', 'Devam etmek için bu adımı tamamlayın.');
    safeStepChange(() => setStep(s => Math.min(4, s + 1))); // 0..4
  };
  const back = () => { safeStepChange(() => setStep(s => Math.max(0, s - 1))); };

  // TripListQuestion adımına girerken dailyPlan'i kur
  useEffect(() => {
    if (step !== 3) return;
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const nextDP = buildDailyPlan(range.start, range.end, dailyPlan);
    setDailyPlan(nextDP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, whereAnswer, startEndSingle, startEndByCity]);

  // Submit — yerelde kaydet ve TripsHome'a dön
  const submit = async () => {
    if (!draft) return;

    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const stays = buildStays(whereAnswer, startEndSingle, startEndByCity, lodgingSingle, lodgingByCity);

    await saveTripLocal({
      ...draft,
      title: draft.title || (whereAnswer?.mode === 'single'
        ? (whereAnswer?.single?.city?.name ? `${whereAnswer.single.city.name} Trip` : 'My Trip')
        : 'My Trip'),
      cities: whereAnswer?.mode === 'single'
        ? [whereAnswer?.single?.city?.name].filter(Boolean)
        : (whereAnswer?.items || []).map(it => it.city?.name).filter(Boolean),
      dateRange: { start: range.start, end: range.end },
      lodgings: stays.map(s => ({
        id: s.id || undefined,
        name: s.place?.name,
        checkIn: s.dateRange?.start || null,
        checkOut: s.dateRange?.end || null,
      })),
      // TripListQuestion çıktısı:
      dailyPlan, // [{date, visits:[{id,name,lat,lng,address}]}]
      places: selectedPlaces?.map(p => ({
        id: p.id,
        name: p.name,
        coords: p.coords || (p.lat && p.lon ? { lat: p.lat, lng: p.lon } : undefined),
        address: p.address || undefined,
      })) || [],
    });

    nav.navigate('TripsHome', { refresh: Date.now() });
  };

  /** START/END için haritadan seçim — köprü üzerinden */
  function handleMapPick(which /* 'start' | 'end' */) {
    return bridge.openStartEndPicker({
      which,
      cityKey: activeCityKey,
      cityObj: activeCityObj,
    });
  }

   // LodgingQuestion bir Promise bekliyor → picker'ı awaitSelection: true ile aç!
   function handleLodgingMapPick({ index, center, cityName, startDate, endDate }) {
     return bridge.openPicker({
       which: 'lodging',
       cityKey: activeCityKey,
       center: center || activeCityObj?.center,
       cityName: cityName || activeCityObj?.name,
       sheetInitial: 'half',
       awaitSelection: true,      // ✅ SEÇİMİ BEKLE
       presetCategory: 'lodging', // ✅ Otel/konaklama kategorisi açık gelsin
     });
   }

  // Trip nesnesi (TripListQuestion'a verilecek minimum alanlar)
  const rangeForTrip = useMemo(
    () => computeGlobalRange(whereAnswer, startEndSingle, startEndByCity),
    [whereAnswer, startEndSingle, startEndByCity]
  );
  const tripForList = useMemo(() => ({
    startDate: rangeForTrip.start || null,
    endDate: rangeForTrip.end || null,
     dailyPlan,
     selectedPlaces,
   }), [rangeForTrip.start, rangeForTrip.end, dailyPlan, selectedPlaces]);

  const setTripFromList = (nextTrip) => {
    if (Array.isArray(nextTrip?.dailyPlan)) {
      setDailyPlan(nextTrip.dailyPlan);
    }
    if (Array.isArray(nextTrip?.selectedPlaces)) {
      setSelectedPlaces(nextTrip.selectedPlaces);
    }
  };

  // --- Multi-city helpers for Step 3 flow (Ankara → Antalya → …)
  const filteredCities = useMemo(
    () => (whereAnswer?.items || []).filter(it => it.city?.name),
    [whereAnswer]
  );
  const cityNames = filteredCities.map(it => it.city.name);
  const cityCount = cityNames.length;
  const isFirstCity = cityIndex === 0;
  const isLastCity  = cityIndex === Math.max(0, cityCount - 1);

  const goPrevCityOrBack = () => {
    if (whereAnswer?.mode === 'multi' && !isFirstCity) setCityIndex(i => Math.max(0, i - 1));
    else back();
  };
  const goNextCityOrStep = () => {
    if (whereAnswer?.mode === 'multi' && !isLastCity) setCityIndex(i => Math.min(cityCount - 1, i + 1));
    else next();
  };

  // --- Render
  const titles = ['Lokasyon', 'Başlangıç & Bitiş', 'Konaklama', 'Gezilecek Yerler', 'Önizleme'];

  return (
    <View style={styles.container}>
      <Header step={step} titles={titles} />

      <FlatList
        data={[{ key: 'content' }]}
        keyExtractor={(it) => it.key}
        renderItem={() => (
          <View style={{ padding: 16 }}>
            {/* STEP 0 — Nereye gidiyorsun? */}
            {step === 0 && (
              <Card title="Nereye gidiyorsun?">
                <WhereToQuestion initialMode="single" onChange={setWhereAnswer} />
              </Card>
            )}

            {/* STEP 1 — Başlangıç & Bitiş */}
            {step === 1 && whereAnswer && (
              <Card title="Başlangıç & Bitiş">
                {whereAnswer.mode === 'single' ? (
                  activeCityObj ? (
                    <StartEndQuestion
                      countryCode={activeCityObj.country}
                      cityName={activeCityObj.name}
                      cityCenter={activeCityObj.center}
                      value={startEndSingle}
                      onChange={setStartEndSingle}
                      onMapPick={handleMapPick}
                    />
                  ) : <Text style={{ color: '#A8A8B3' }}>Şehir seçin.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {(() => {
                      const filtered = (whereAnswer.items || []).filter(it => it.city?.name);
                      const cityNames = filtered.map(it => it.city.name);
                      const cityKeys  = filtered.map(it => it.city.place_id);
                      const idx = cityIndex;

                      const prevKey = idx > 0 ? cityKeys[idx - 1] : null;
                      const nextKey = idx < cityKeys.length - 1 ? cityKeys[idx + 1] : null;
                      const prevEnd = prevKey ? startEndByCity[prevKey]?.end?.date : undefined;
                      const nextStart = nextKey ? startEndByCity[nextKey]?.start?.date : undefined;

                      return (
                        <>
                          <Stepper
                            items={cityNames}
                            index={cityIndex}
                            onPrev={() => setCityIndex(i => Math.max(0, i - 1))}
                            onNext={() => setCityIndex(i => Math.min(cityNames.length - 1, i + 1))}
                          />
                          {activeCityObj ? (
                            <StartEndQuestion
                              countryCode={activeCityObj.country}
                              cityName={activeCityObj.name}
                              cityCenter={activeCityObj.center}
                              value={startEndByCity[activeCityKey]}
                              onChange={(v) => setStartEndByCity(prev => ({ ...prev, [activeCityKey]: v }))}
                              onMapPick={handleMapPick}
                              prevSegmentEnd={prevEnd}
                              nextSegmentStart={nextStart}
                            />
                          ) : null}
                        </>
                      );
                    })()}
                  </View>
                )}
              </Card>
            )}

            {/* STEP 2 — Konaklama */}
            {step === 2 && whereAnswer && (
              <Card title="Konaklama">
                {whereAnswer.mode === 'single' ? (
                  activeCityObj ? (
                    <LodgingQuestion
                      cityName={activeCityObj.name}
                      cityCenter={activeCityObj.center}
                      tripRange={{ startDate: activeRange.start, endDate: activeRange.end }}
                      stays={staysFromSegments(lodgingSingle)}
                      onChange={(next) => setLodgingSingle(segmentsFromStays(next))}
                      onMapPick={handleLodgingMapPick}
                    />
                  ) : <Text style={{ color: '#A8A8B3' }}>Önce şehir ve tarihleri seçin.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {(() => {
                      const filtered = (whereAnswer.items || []).filter(it => it.city?.name);
                      const cityNames = filtered.map(it => it.city.name);
                      return (
                        <>
                          <Stepper
                            items={cityNames}
                            index={cityIndex}
                            onPrev={() => setCityIndex(i => Math.max(0, i - 1))}
                            onNext={() => setCityIndex(i => Math.min(cityNames.length - 1, i + 1))}
                          />
                          {activeCityObj ? (
                            <LodgingQuestion
                              cityName={activeCityObj.name}
                              cityCenter={activeCityObj.center}
                              tripRange={{ startDate: activeRange.start, endDate: activeRange.end }}
                              stays={staysFromSegments(lodgingByCity[activeCityKey] || [])}
                              onChange={(next) =>
                                setLodgingByCity(prev => ({ ...prev, [activeCityKey]: segmentsFromStays(next) }))
                              }
                              onMapPick={handleLodgingMapPick}
                            />
                          ) : null}
                        </>
                      );
                    })()}
                  </View>
                )}
              </Card>
            )}

            {/* STEP 3 — Gezilecek Yerler */}
            {step === 3 && (
              <Card title="Gezilecek Yerler">
                {whereAnswer?.mode === 'multi' ? (
                  <View style={{ gap: 10 }}>
                    {/* ✅ Stepper to show "Ankara (1/2) → Antalya (2/2)" */}
                    <Stepper
                      items={cityNames}
                      index={cityIndex}
                      onPrev={() => setCityIndex(i => Math.max(0, i - 1))}
                      onNext={() => setCityIndex(i => Math.min(cityNames.length - 1, i + 1))}
                    />
                    <TripListQuestion
                      trip={tripForList}
                      setTrip={setTripFromList}
                      onBack={goPrevCityOrBack}
                      onNext={goNextCityOrStep}
                      cityName={activeCityObj?.name || ''}
                      cityCenter={activeCityObj?.center || { lat: 39.92077, lng: 32.85411 }}
                      listHeight={420} // separate scroller height
                    />
                  </View>
                ) : (
                  <TripListQuestion
                    trip={tripForList}
                    setTrip={setTripFromList}
                    onBack={back}
                    onNext={next}
                    cityName={activeCityObj?.name || ''}
                    cityCenter={activeCityObj?.center || { lat: 39.92077, lng: 32.85411 }}
                    listHeight={420}
                  />
                )}
              </Card>
            )}

            {/* STEP 4 — Önizleme */}
            {step === 4 && (
              <Card title="Önizleme">
                <Preview
                  where={whereAnswer}
                  singleSE={startEndSingle}
                  multiSE={startEndByCity}
                  nights={nights}
                  staysCount={computeStaysCount(whereAnswer, lodgingSingle, lodgingByCity)}
                />
              </Card>
            )}
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 12 }}
      />

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => nav.goBack()} style={styles.ghostBtn}><Text style={styles.ghostText}>Vazgeç</Text></TouchableOpacity>
        {step > 0 && (<TouchableOpacity onPress={back} style={styles.secondaryBtn}><Text style={styles.secondaryText}>Geri</Text></TouchableOpacity>)}
        {step < 4 ? (
          <TouchableOpacity disabled={!canNext} onPress={next} style={[styles.primaryBtn, !canNext && styles.disabled]}><Text style={styles.primaryText}>İleri</Text></TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={submit} style={styles.primaryBtn}><Text style={styles.primaryText}>Geziyi Oluştur</Text></TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ------------------------------ Helpers/UI ------------------------------ */
function Header({ step, titles }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Start from Scratch</Text>
      <Text style={styles.headerStep}>{titles[step]} ({step + 1}/{titles.length})</Text>
    </View>
  );
}
function Card({ title, children }) { return (<View style={styles.card}><Text style={styles.cardTitle}>{title}</Text><View style={{ gap: 10 }}>{children}</View></View>); }
function Field({ label, children }) { return (<View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text>{children}</View>); }
function Input(props) { return (<TextInput {...props} style={[styles.input, props.editable === false && { backgroundColor: '#16181F', color: '#A8A8B3' }]} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#6B7280" />); }

function Stepper({ items, index, onPrev, onNext }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: '#A8A8B3' }}>
        Şehir {index + 1}/{items.length} • {items[index]}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={onPrev} disabled={index === 0} style={[styles.smallBtn, index === 0 && styles.disabled]}><Text style={{ color: '#fff' }}>← Önceki</Text></TouchableOpacity>
        <TouchableOpacity onPress={onNext} disabled={index === items.length - 1} style={[styles.smallBtn, index === items.length - 1 && styles.disabled]}><Text style={{ color: '#fff' }}>Sonraki →</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function Preview({ where, singleSE, multiSE, nights, staysCount }) {
  const range = computeGlobalRange(where, singleSE, multiSE);
  const lines = [];

  if (where?.mode === 'single' && singleSE) {
    lines.push(`Başlangıç: ${singleSE.start?.date || '-'} ${singleSE.start?.time || '-'} @ ${singleSE.start?.hub?.name || '-'}`);
    lines.push(`Bitiş:     ${singleSE.end?.date || '-'} ${singleSE.end?.time || '-'} @ ${singleSE.end?.hub?.name || '-'}`);
  } else {
    (where?.items || []).forEach(it => {
      const se = multiSE[it.city.place_id];
      if (!se) return;
      lines.push(`[${it.city.name}] Başlangıç: ${se.start?.date || '-'} ${se.start?.time || '-'} @ ${se.start?.hub?.name || '-'}`);
      lines.push(`[${it.city.name}] Bitiş:     ${se.end?.date || '-'} ${se.end?.time || '-'} @ ${se.end?.hub?.name || '-'}`);
    });
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.preview}>{lines.join('\n')}</Text>
      <Text style={styles.preview}>Toplam Gece: {nights}</Text>
      <Text style={styles.preview}>Konaklama Kaydı: {staysCount}</Text>
    </View>
  );
}

/* ------------------------------ Logic utils ----------------------------- */
function diffNights(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  return Math.max(0, Math.round((e - s) / 86400000));
}

function computeGlobalRange(where, singleSE, multiSE) {
  if (!where) return { start: null, end: null };

  if (where.mode === 'single') {
    return {
      start: singleSE?.start?.date || null,
      end:   singleSE?.end?.date   || null,
    };
  }

  const dates = [];
  (where.items || []).forEach(it => {
    const se = multiSE[it.city.place_id];
    if (se?.start?.date) dates.push(se.start.date);
    if (se?.end?.date)   dates.push(se.end.date);
  });
  if (!dates.length) return { start: null, end: null };

  const asc = dates.slice().sort();
  const start = asc[0] || null;
  const end   = asc[asc.length - 1] || null;

  return { start, end };
}

function buildStays(where, singleSE, multiSE, singleSegs, byCitySegs) {
  const toStay = (cityName, seg) => {
    const nights = diffNights(seg.start, seg.end);
    return {
      id: seg.id,
      city: cityName,
      place: { name: seg.place?.name, place_id: seg.place?.place_id },
      nights,
      checkIn: '14:00',
      checkOut: '11:00',
      dateRange: { start: seg.start, end: seg.end },
    };
  };
  const result = [];
  if (!where) return result;
  if (where.mode === 'single') {
    const cityName = where.single?.city?.name || '-';
    (singleSegs || []).forEach(seg => result.push(toStay(cityName, seg)));
  } else {
    (where.items || []).forEach(it => {
      const cityName = it.city?.name;
      const segs = byCitySegs[it.city.place_id] || [];
      segs.forEach(seg => result.push(toStay(cityName, seg)));
    });
  }
  return result;
}

function computeStaysCount(where, singleSegs, byCitySegs) {
  if (!where) return 0;
  if (where.mode === 'single') return (singleSegs || []).length;
  return (where.items || []).reduce((acc, it) => acc + ((byCitySegs[it.city.place_id] || []).length), 0);
}

/* ------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014' },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderColor: BORDER },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  headerStep: { color: '#A8A8B3', marginTop: 2 },

  card: { borderBottomWidth: 1, borderColor: BORDER, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },
  label: { fontSize: 13, color: '#A8A8B3' },
  input: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: '#fff' },

  preview: { fontSize: 14, lineHeight: 20, color: '#fff' },

  footer: { flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: 1, borderColor: BORDER },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  ghostText: { color: BTN, fontWeight: '700' },
  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderColor: BORDER, borderWidth: 1 },
  secondaryText: { color: '#fff', fontWeight: '700' },
  primaryBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: BTN },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },
});
