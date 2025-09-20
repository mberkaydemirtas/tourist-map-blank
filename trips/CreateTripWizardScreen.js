import React, { useMemo, useState, useRef } from 'react';
import {
  Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList,
  DeviceEventEmitter, InteractionManager,
} from 'react-native';
const EVT_CLOSE_DROPDOWNS = 'CLOSE_ALL_DROPDOWNS';
import { useNavigation, useRoute } from '@react-navigation/native';
import { createTrip } from './services/tripsService';
import { buildInitialDailyPlan, outboundMustArriveBeforeMin } from './shared/types';
import WhereToQuestion from './components/WhereToQuestion';
import StartEndQuestion from './components/StartEndQuestion';
import LodgingQuestion from './components/LodgingQuestion';
import { useTripsExploreBridge } from '../bridges/useTripsExploreBridge';

const BORDER = '#23262F';
const BTN = '#2563EB';

export default function CreateTripWizardScreen() {
  const nav = useNavigation();
  const route = useRoute();

  const [step, setStep] = useState(0);

  // Step 0 — Nereye gidiyorsun?
  const [whereAnswer, setWhereAnswer] = useState(null); // { mode: 'single'|'multi', single?, items? }

  // Step 1 — Başlangıç & Bitiş (tek ya da tüm şehirler)
  // single: { start, end }; multi: { [place_id]: { start, end } }
  const [startEndSingle, setStartEndSingle] = useState(null);
  const [startEndByCity, setStartEndByCity] = useState({});
  const [cityIndex, setCityIndex] = useState(0);

  // Step 2 — Konaklama (Wizard state'i hâlâ eski shape: { place, start, end })
  const [lodgingSingle, setLodgingSingle] = useState([]); // [{ place, start, end }, ...]
  const [lodgingByCity, setLodgingByCity] = useState({}); // { [cityKey]: [{...}] }

  // --- Helpers: LodgingQuestion <-> Wizard shape dönüşümleri ---
  const staysFromSegments = (segs = []) => segs.map((s, i) => ({
    id: s.id || `${s?.place?.place_id || 'seg'}_${i}`,
    place: s.place || null,
    startDate: s.start || null,
    endDate: s.end || null,
  }));
  const segmentsFromStays = (stays = []) => stays.map(s => ({
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

  // Map ↔ Wizard köprüsü
  const bridge = useTripsExploreBridge({
    nav,
    route,
    onPick: (pick) => {
      // Plan A: Lodging seçimleri Promise ile döneceği için burada İŞLEMEYELİM.
      // Başlangıç/Bitiş seçimlerini ise mevcut akış gibi güncellemeye devam edelim.
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
      // NOT: pick.which === 'lodging' burada bilerek no-op (Plan A)
    },
  });

  // Step 1 valid?
  const step1Valid = useMemo(() => {
    if (!whereAnswer) return false;
    if (whereAnswer.mode === 'single') {
      const v = startEndSingle;
      return !!(
        v?.start?.type && v?.start?.hub && v?.start?.date && v?.start?.time &&
        v?.end?.type && v?.end?.hub && v?.end?.date && v?.end?.time
      );
    } else {
      const arr = (whereAnswer.items || []).filter(it => it.city?.name);
      if (!arr.length) return false;
      return arr.every(it => {
        const se = startEndByCity[it.city.place_id];
        return !!(
          se?.start?.type && se?.start?.hub && se?.start?.date && se?.start?.time &&
          se?.end?.type && se?.end?.hub && se?.end?.date && se?.end?.time
        );
      });
    }
  }, [whereAnswer, startEndSingle, startEndByCity]);

  // Gece sayısı (global)
  const nights = useMemo(() => {
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    if (!range.start || !range.end) return 0;
    return diffNights(range.start, range.end);
  }, [whereAnswer, startEndSingle, startEndByCity]);

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
    safeStepChange(() => setStep(s => Math.min(3, s + 1)));
  };
  const back = () => { safeStepChange(() => setStep(s => Math.max(0, s - 1))); };

  // Submit
  const submit = async () => {
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const inbound = computeInbound(whereAnswer, startEndSingle, startEndByCity);
    const outbound = computeOutbound(whereAnswer, startEndSingle, startEndByCity);

    const stays = buildStays(whereAnswer, startEndSingle, startEndByCity, lodgingSingle, lodgingByCity);
    const tripInit = {
      source: 'scratch',
      dateRange: { start: range.start, end: range.end },
      transport: {
        inbound: inbound ? {
          mode: inbound.mode,
          arriveTime: inbound.time,
          hub: inbound.hub ? { name: inbound.hub.name, place_id: inbound.hub.place_id } : undefined,
        } : undefined,
        outbound: outbound ? {
          mode: outbound.mode,
          departTime: outbound.time,
          hub: outbound.hub ? { name: outbound.hub.name, place_id: outbound.hub.place_id } : undefined,
          mustArriveBeforeMin: outboundMustArriveBeforeMin(outbound.mode),
        } : undefined,
      },
      stays,
    };
    const daily = buildInitialDailyPlan(tripInit);
    const created = await createTrip({ ...tripInit, daily });
    nav.navigate('TripEditor', { id: created.id });
  };

  /** START/END için haritadan seçim — köprü üzerinden */
  function handleMapPick(which /* 'start' | 'end' */) {
    return bridge.openStartEndPicker({
      which,
      cityKey: activeCityKey,
      cityObj: activeCityObj,
    });
  }

  /** KONAKLAMA için haritadan seçim — Plan A (awaitSelection:true) */
  function handleLodgingMapPick({ index, center, cityName, startDate, endDate }) {
    return bridge.openPicker({
      which: 'lodging',
      cityKey: activeCityKey,
      center: center || activeCityObj?.center,
      cityName: cityName || activeCityObj?.name,
      sheetInitial: 'half',
      presetCategory: 'lodging',
      awaitSelection: true,
      // search: 'otel', // opsiyonel
    });
  }

  // --- Render
  const titles = ['Lokasyon', 'Başlangıç & Bitiş', 'Konaklama', 'Önizleme'];

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
                              onChange={(next) => setLodgingByCity(prev => ({ ...prev, [activeCityKey]: segmentsFromStays(next) }))}
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

            {/* STEP 3 — Önizleme */}
            {step === 3 && (
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
        {step < 3 ? (
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

function computeInbound(where, singleSE, multiSE) {
  if (!where) return null;
  if (where.mode === 'single') {
    if (!singleSE?.start) return null;
    return { mode: mapTypeToMode(singleSE.start.type), time: singleSE.start.time, hub: singleSE.start.hub };
  }
  const first = (where.items || [])[0];
  const se = first ? multiSE[first.city.place_id] : null;
  return se?.start ? { mode: mapTypeToMode(se.start.type), time: se.start.time, hub: se.start.hub } : null;
}

function computeOutbound(where, singleSE, multiSE) {
  if (!where) return null;
  if (where.mode === 'single') {
    if (!singleSE?.end) return null;
    return { mode: mapTypeToMode(singleSE.end.type), time: singleSE.end.time, hub: singleSE.end.hub };
  }
  const items = (where.items || []);
  const last = items[items.length - 1];
  const se = last ? multiSE[last.city.place_id] : null;
  return se?.end ? { mode: mapTypeToMode(se.end.type), time: se.end.time, hub: se.end.hub } : null;
}

function mapTypeToMode(type) {
  if (type === 'airport') return 'plane';
  if (type === 'train') return 'train';
  if (type === 'bus') return 'bus';
  return 'custom';
}

function buildStays(where, singleSE, multiSE, singleSegs, byCitySegs) {
  const toStay = (cityName, seg) => {
    const nights = diffNights(seg.start, seg.end);
    return {
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
