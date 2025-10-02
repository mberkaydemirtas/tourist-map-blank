// trips/CreateTripWizardScreen.js
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert, StyleSheet, Text, TextInput, TouchableOpacity, View, FlatList,
  DeviceEventEmitter, InteractionManager,
} from 'react-native';
const EVT_CLOSE_DROPDOWNS = 'CLOSE_ALL_DROPDOWNS';
const EVT_TRIP_META_UPDATED = 'TRIP_META_UPDATED';
import { useNavigation, useRoute } from '@react-navigation/native';

// Local-first storage
import { createTripLocal, saveTripLocal, getTripLocal, patchTripLocal } from '../app/lib/tripsLocal';

// Soru bileşenleri
import WhereToQuestion from './screens/WhereToQuestion';
import StartEndQuestion from './screens/StartEndQuestion';
import LodgingQuestion from './screens/LodgingQuestion';
import TripListQuestion from './screens/TripListQuestion';

// Harita köprüsü
import { useTripsExploreBridge } from '../bridges/useTripsExploreBridge';

const BORDER = '#23262F';
const BTN = '#2563EB';

/* ---------------------- Yardımcılar: Gün listesi & DP ---------------------- */
function ensureIdsDoc(t) {
  if (!t) return t;
  const id  = t.id  ?? t._id;
  const _id = t._id ?? id;
  return { ...t, id, _id };
}

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

/** Yeni tarih aralığına göre dailyPlan kurar/yeniler. Eski dailyPlan varsa aynı index'teki günleri korur. */
function buildDailyPlan(startDate, endDate, prevDP = []) {
  const days = dateRangeDays(startDate, endDate);
  if (!days.length) return [];
  const next = days.map((d, i) => {
    const prev = prevDP[i];
    return {
      date: d,
      visits: Array.isArray(prev?.visits) ? prev.visits : [],
    };
  });
  return next;
}

/* ---------------------- Lokasyon yardımcıları ---------------------- */
function cityKeysOf(whereAnswer) {
  if (!whereAnswer) return [];
  if (whereAnswer.mode === 'single') return [whereAnswer?.single?.city?.place_id].filter(Boolean);
  return (whereAnswer?.items || []).map(it => it?.city?.place_id).filter(Boolean);
}
function shallowEqualArr(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export default function CreateTripWizardScreen() {
  const nav = useNavigation();
  const route = useRoute();

  // Review'den geri dönüş
  const jumpToStep = route?.params?.jumpToStep;
  const returnTo   = route?.params?.returnTo ?? null;
  const editIntent = route?.params?.editIntent ?? null;
  const openedForEdit = returnTo === 'TripReview' || !!editIntent;

  // jumpToStep'i sadece ilk kez uygula
  const appliedJumpOnce = useRef(false);

  // NEW: Step 0 — Trip name
  const [tripTitle, setTripTitle] = useState('');
  const uiTitle = (tripTitle || '').trim() || 'Yeni Gezi';
  const [step, setStep] = useState(0);

  // Step 1 — Nereye gidiyorsun?
  const [whereAnswer, setWhereAnswer] = useState(null);

  // Step 2 — Başlangıç & Bitiş
  const [startEndSingle, setStartEndSingle] = useState(null);
  const [startEndByCity, setStartEndByCity] = useState({});
  const [cityIndex, setCityIndex] = useState(0);

  // Step 3 — Konaklama
  const [lodgingSingle, setLodgingSingle] = useState([]);
  const [lodgingByCity, setLodgingByCity] = useState({});
  const [travelMode, setTravelMode] = useState('walk_transport'); // default seçili


  // Step 4 — Gezilecek Yerler
  const [selectedPlaces, setSelectedPlaces] = useState([]);
  const [dailyPlan, setDailyPlan] = useState([]);

  // Yerel taslak
  const [draft, setDraft] = useState(null);
  const resumeId = route?.params?.resumeId || null;

  // Autosave timer ref (navigate etmeden önce flush edeceğiz)
  const autosaveRef = useRef(null);

  // İlk açılışta istenen adıma zıpla (edit akışında draft.wizardStep uygulanmaz)
  useEffect(() => {
    if (!appliedJumpOnce.current && Number.isInteger(jumpToStep)) {
      setStep(Math.max(0, Math.min(4, jumpToStep)));
      appliedJumpOnce.current = true;
      try { nav.setParams({ jumpToStep: undefined }); } catch {}
    }
  }, [jumpToStep, nav]);

  useEffect(() => {
    (async () => {
      if (resumeId) {
        const t = await getTripLocal(resumeId);
        if (t) {
          setDraft(t);
          if (!openedForEdit && Number.isFinite(t.wizardStep)) {
            setStep(Math.max(0, Math.min(4, t.wizardStep)));
          } else if (!appliedJumpOnce.current && Number.isInteger(jumpToStep)) {
            setStep(Math.max(0, Math.min(4, jumpToStep)));
            appliedJumpOnce.current = true;
            try { nav.setParams({ jumpToStep: undefined }); } catch {}
          }
          if (t.title) setTripTitle(t.title);
          if (t._whereAnswer) setWhereAnswer(t._whereAnswer);
          if (t._startEndSingle) setStartEndSingle(t._startEndSingle);
          if (t._startEndByCity) setStartEndByCity(t._startEndByCity);
          if (t._lodgingSingle) setLodgingSingle(t._lodgingSingle);
          if (t._lodgingByCity) setLodgingByCity(t._lodgingByCity);
          if (Array.isArray(t.dailyPlan)) setDailyPlan(t.dailyPlan);
          if (Array.isArray(t.places)) setSelectedPlaces(t.places);
          return;
        }
      }
      const tRaw = await createTripLocal({ title: 'New Trip', status: 'draft', wizardStep: 0 });
      const t = ensureIdsDoc(tRaw);
      setDraft(t);

    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, openedForEdit]);

  /* ---- İSİM: anında kaydet + Trips listesine canlı yansıt ---- */
useEffect(() => {
  const key = draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;
  if (!key) return;

  const t = (tripTitle || '').trim();
  if (t.length < 2) return;

  const h = setTimeout(() => {
    patchTripLocal(key, { title: t }).catch(() => {});
    DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: key, patch: { title: t } });
  }, 250);

  return () => clearTimeout(h);
}, [tripTitle, draft?.id, draft?._id, route?.params?.resumeId]);


  /* ---- Lokasyon patch + canlı bildirim ---- */
useEffect(() => {
  const key = draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;
  if (!key) return;

  const cities =
    whereAnswer?.mode === 'single'
      ? [whereAnswer?.single?.city?.name].filter(Boolean)
      : (whereAnswer?.items || []).map(it => it?.city?.name).filter(Boolean);

  if (!cities.length) return;

  patchTripLocal(key, { cities }).catch(() => {});
  DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: key, patch: { cities } });
}, [draft?.id, draft?._id, route?.params?.resumeId, whereAnswer?.mode, whereAnswer?.single?.city?.name, whereAnswer?.items]);

  /* ---- Lokasyon değişimini yalnızca Step 1'de kullanıcı “İleri” deyince commit et ---- */
  const committedCityKeysRef = useRef([]);
  useEffect(() => {
    if (!whereAnswer) return;
    if (committedCityKeysRef.current.length === 0) {
      committedCityKeysRef.current = cityKeysOf(whereAnswer);
    }
  }, [whereAnswer]);

  /* ---- Global tarih aralığını türetip kaydet ---- */
useEffect(() => {
  const key = draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;
  if (!key) return;

  const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
  if (!range.start && !range.end) return;

  patchTripLocal(key, { dateRange: range }).catch(() => {});
  DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: key, patch: { dateRange: range } });
}, [draft?.id, draft?._id, route?.params?.resumeId, whereAnswer, startEndSingle?.start?.date, startEndSingle?.end?.date, startEndByCity]);

  /* ---- Çok-şehir adımında index koruması ---- */
  useEffect(() => {
    if (whereAnswer?.mode !== 'multi') return;
    const max = Math.max(0, (whereAnswer?.items || []).filter(it => it?.city?.name).length - 1);
    if (cityIndex > max) setCityIndex(0);
  }, [whereAnswer, cityIndex]);

  // Segments <-> Stays
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

  // Türev state (aktif şehir)
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
    },
  });

  /* -------------------------- STEP VALIDATION -------------------------- */
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

  const step2Valid = useMemo(() => {
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

  // İleri buton durumu
  const canNext = useMemo(() => {
    if (step === 0) {
      return (tripTitle || '').trim().length >= 2;
    }
    if (step === 1) {
      if (!whereAnswer) return false;
      if (whereAnswer.mode === 'single') return !!(whereAnswer.single?.countryCode && whereAnswer.single?.city?.name);
      return (whereAnswer.items || []).some(it => it.countryCode && it.city?.name);
    }
    if (step === 2) return step2Valid;
    if (step === 3) {
      if (!whereAnswer) return false;
      const rangeOk = (segs, rng) =>
        segs.length > 0 &&
        segs.every(s =>
          s.place?.name &&
          s.start && s.end &&
          rng.start && rng.end &&
          s.start >= rng.start && s.end <= rng.end && s.end > s.start
        );

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
  }, [step, tripTitle, whereAnswer, step2Valid, lodgingSingle, lodgingByCity, activeRange, startEndByCity]);

  const safeStepChange = (updater) => {
    DeviceEventEmitter.emit(EVT_CLOSE_DROPDOWNS);
    requestAnimationFrame(() => {
      InteractionManager.runAfterInteractions(() => {
        updater();
      });
    });
  };

  // aktif trip anahtarını tek yerden resolve et
const tripKeyId = useCallback(() => {
  return draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;
}, [draft?.id, draft?._id, route?.params?.resumeId]);

// TITLE'I KESİN KAYDET + CANLI PATCH
const flushTitleNow = useCallback(async () => {
  const key = tripKeyId();
  const t = (tripTitle || '').trim();
  if (!key || !t) return;

  // 1) önce state'i güncelle ki üst başlık anında değişsin
  setDraft(prev => (prev ? { ...prev, title: t } : prev));

  // 2) storage'a yaz (id/_id ne olursa olsun upsert dene)
  try {
    await patchTripLocal(key, { title: t, status: 'draft' });
  } catch {
    try {
      await saveTripLocal({ ...(draft || {}), id: draft?.id || key, _id: draft?._id || key, title: t, status: 'draft' });
    } catch {}
  }

  // 3) TripsList ekranı canlı güncellensin
  try {
    DeviceEventEmitter.emit('TRIP_META_UPDATED', { tripId: key, patch: { title: t } });
  } catch {}
}, [tripKeyId, tripTitle, draft]);

  // Review'a gitmeden hemen önce KESİN yaz
  const persistFullDraftBeforeReview = useCallback(async (id) => {
    // autosave beklemesin
    if (autosaveRef.current) {
      clearTimeout(autosaveRef.current);
      autosaveRef.current = null;
    }

    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const cities =
      whereAnswer?.mode === 'single'
        ? [whereAnswer?.single?.city?.name].filter(Boolean)
        : (whereAnswer?.items || []).map(it => it?.city?.name).filter(Boolean);

    const payload = {
      title: (tripTitle || '').trim() || 'New Trip',
      wizardStep: 4,
      cities,
      dateRange: { start: range.start, end: range.end },
      _whereAnswer: whereAnswer,
      _startEndSingle: startEndSingle,
      _startEndByCity: startEndByCity,
      _lodgingSingle: lodgingSingle,
      _lodgingByCity: lodgingByCity,
      dailyPlan,
      places: selectedPlaces,
      travelMode,
    };

    await patchTripLocal(id, payload).catch(() => {});
    setDraft(prev => (prev ? { ...prev, ...payload } : prev));
    DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: id, patch: payload });
  }, [whereAnswer, startEndSingle, startEndByCity, lodgingSingle, lodgingByCity, dailyPlan, selectedPlaces, tripTitle, travelMode]);

  // NEXT
async function next() {
  if (!canNext) {
    Alert.alert('Eksik bilgi', 'Devam etmek için bu adımı tamamlayın.');
    return;
  }

  // aktif trip anahtarı (_id || id || resumeId)
  const tripKey = draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;

  // Step 1'de şehir seti değiştiyse resetle
  if (step === 1) {
    const newKeys  = cityKeysOf(whereAnswer);
    const prevKeys = committedCityKeysRef.current;
    if (!shallowEqualArr(newKeys, prevKeys)) {
      setStartEndSingle(null);
      setStartEndByCity({});
      setLodgingSingle([]);
      setLodgingByCity({});
      setSelectedPlaces([]);
      setDailyPlan([]);
      setCityIndex(0);

      if (tripKey) {
        try {
          await patchTripLocal(tripKey, {
            _startEndSingle: null,
            _startEndByCity: {},
            _lodgingSingle: [],
            _lodgingByCity: {},
            places: [],
            dailyPlan: [],
            dateRange: { start: null, end: null },
          });
        } catch {}
      }
      committedCityKeysRef.current = newKeys;
    }
  }

  // STEP 0 → başlık kesin kaydedilsin (fallback + canlı patch)
  if (step === 0 && tripKey) {
    const t = (tripTitle || '').trim();
    if (t) {
      // local state
      setDraft(prev => (prev ? { ...prev, title: t } : prev));
      // storage
      try {
        await patchTripLocal(tripKey, { title: t });
      } catch {
        try {
          await saveTripLocal({
            ...(draft || {}),
            id: draft?.id || tripKey,
            _id: draft?._id || tripKey,
            title: t,
            status: 'draft',
          });
        } catch {}
      }
      // listede canlı güncelle
      try {
        DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: tripKey, patch: { title: t } });
      } catch {}
    }
  }

  // --- SNAPSHOT FLUSH: "İleri" anında mevcut adımın verisini yaz ---
  if (tripKey) {
    const nextStep = Math.min(4, step + 1);
    const patchNow = { wizardStep: nextStep };

    // STEP 1 → lokasyon özeti
    if (step === 1) {
      patchNow._whereAnswer = whereAnswer;
      patchNow.cities =
        whereAnswer?.mode === 'single'
          ? [whereAnswer?.single?.city?.name].filter(Boolean)
          : (whereAnswer?.items || []).map(it => it?.city?.name).filter(Boolean);
    }

    // STEP 2 → tarih aralığı
    if (step === 2) {
      patchNow._startEndSingle = startEndSingle;
      patchNow._startEndByCity = startEndByCity;
      const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
      patchNow.dateRange = { start: range.start, end: range.end };
    }

    // STEP 3 → konaklama
    if (step === 3) {
      patchNow._lodgingSingle = lodgingSingle;
      patchNow._lodgingByCity = lodgingByCity;
    }

    try {
      await patchTripLocal(tripKey, patchNow);
      setDraft(prev => (prev ? { ...prev, ...patchNow } : prev));
      // canlı liste patch (başlıca cities/dates)
      const livePatch = {};
      if (patchNow.cities) livePatch.cities = patchNow.cities;
      if (patchNow.dateRange) livePatch.dateRange = patchNow.dateRange;
      if (Object.keys(livePatch).length) {
        DeviceEventEmitter.emit(EVT_TRIP_META_UPDATED, { tripId: tripKey, patch: livePatch });
      }
    } catch {}
  }

  // Step 4 → Review (tam snapshot + ts)
  if (step === 4) {
    if (tripKey) {
      await persistFullDraftBeforeReview(tripKey);
      nav.navigate('TripReview', { tripId: tripKey, ts: Date.now() });
    } else {
      nav.navigate('TripReview');
    }
    return;
  }

  // Review’den gelen edit akışı: hedef adıma ulaştıysak Review’a dön
  if (returnTo === 'TripReview' && editIntent && Number.isInteger(editIntent.returnAfterStep)) {
    if (step === editIntent.returnAfterStep) {
      if (tripKey) nav.navigate('TripReview', { tripId: tripKey, ts: Date.now() });
      else nav.navigate('TripReview');
      return;
    }
  }

  // Normal ileri
  safeStepChange(() => setStep(s => Math.min(4, s + 1)));
}

  // Konaklama editinde “geri”yi Start&End’e değil Review’a al (silme YOK)
  const back = () => {
    if (openedForEdit && editIntent?.target === 'lodging' && step === 3) {
      const id = draft?._id || route?.params?.resumeId;
      if (id) nav.navigate('TripReview', { tripId: id, ts: Date.now() });
      else nav.navigate('TripReview');
      return;
    }
    safeStepChange(() => setStep(s => Math.max(0, s - 1)));
  };

  // Donanım geri/gesture
  useEffect(() => {
    const unsub = nav.addListener('beforeRemove', (e) => {
      if (openedForEdit && editIntent?.target === 'lodging' && step === 3) {
        e.preventDefault();
        const id = draft?._id || route?.params?.resumeId;
        if (id) nav.navigate('TripReview', { tripId: id, ts: Date.now() });
        else nav.navigate('TripReview');
        } else {
          const key = draft?.id ?? draft?._id ?? null;
          if (key) patchTripLocal(key, { wizardStep: step }).catch(() => {});
        }
    });
    return unsub;
  }, [nav, draft?._id, step, openedForEdit, editIntent?.target]);

  // TripListQuestion adımına girerken dailyPlan güncelle
  useEffect(() => {
    if (step !== 4) return;
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const nextDP = buildDailyPlan(range.start, range.end, dailyPlan);
    setDailyPlan(nextDP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, whereAnswer, startEndSingle, startEndByCity]);

  // Autosave (debounce)
useEffect(() => {
  const key = draft?.id ?? draft?._id ?? route?.params?.resumeId ?? null;
  if (!key) return;

  if (autosaveRef.current) {
    clearTimeout(autosaveRef.current);
    autosaveRef.current = null;
  }

  autosaveRef.current = setTimeout(() => {
    const payload = {
      title: (tripTitle || '').trim() || draft?.title || 'New Trip',
      wizardStep: step,
      _whereAnswer: whereAnswer,
      _startEndSingle: startEndSingle,
      _startEndByCity: startEndByCity,
      _lodgingSingle: lodgingSingle,
      _lodgingByCity: lodgingByCity,
      dailyPlan,
      places: selectedPlaces,
      travelMode,
    };
    patchTripLocal(key, payload)
      .then((res) => setDraft(prev => ensureIdsDoc(res || prev)))
      .catch(() => {});
    autosaveRef.current = null;
  }, 350);

  return () => {
    if (autosaveRef.current) {
      clearTimeout(autosaveRef.current);
      autosaveRef.current = null;
    }
  };
}, [draft?.id, draft?._id, route?.params?.resumeId, step, tripTitle, whereAnswer, startEndSingle, startEndByCity, lodgingSingle, lodgingByCity, dailyPlan, selectedPlaces]);


  // Submit (kullanılmıyor ama dursun)
  const submit = async () => {
    if (!draft) return;
    const range = computeGlobalRange(whereAnswer, startEndSingle, startEndByCity);
    const stays = buildStays(whereAnswer, startEndSingle, startEndByCity, lodgingSingle, lodgingByCity);

    const finalTitle =
      (tripTitle || '').trim() ||
      (whereAnswer?.mode === 'single'
        ? (whereAnswer?.single?.city?.name ? `${whereAnswer.single.city.name} Trip` : 'My Trip')
        : 'My Trip');

    await saveTripLocal({
      ...draft,
      title: finalTitle,
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
      dailyPlan,
      places: selectedPlaces?.map(p => ({
        id: p.id,
        name: p.name,
        coords: p.coords || (p.lat && p.lon ? { lat: p.lat, lng: p.lon } : undefined),
        address: p.address || undefined,
      })) || [],
      status: 'active',
      wizardStep: null,
      _whereAnswer: undefined,
      _startEndSingle: undefined,
      _startEndByCity: undefined,
      _lodgingSingle: undefined,
      _lodgingByCity: undefined,
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

  // Konaklama picker
  function handleLodgingMapPick({ index, center, cityName, startDate, endDate }) {
    return bridge.openPicker({
      which: 'lodging',
      cityKey: activeCityKey,
      center: center || activeCityObj?.center,
      cityName: cityName || activeCityObj?.name,
      sheetInitial: 'half',
      awaitSelection: true,
      presetCategory: 'lodging',
    });
  }

  // Trip nesnesi (TripListQuestion)
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
    if (Array.isArray(nextTrip?.dailyPlan)) setDailyPlan(nextTrip.dailyPlan);
    if (Array.isArray(nextTrip?.selectedPlaces)) setSelectedPlaces(nextTrip.selectedPlaces);
  };

  // Multi-city helpers
  const filteredCities = useMemo(() => (whereAnswer?.items || []).filter(it => it.city?.name), [whereAnswer]);
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
  const titles = ['Gezi Adı', 'Lokasyon', 'Başlangıç & Bitiş', 'Konaklama', 'Gezilecek Yerler'];

  return (
    <View style={styles.container}>
      <Header step={step} titles={titles} title={uiTitle} />

      <FlatList
        data={[{ key: 'content' }]}
        keyExtractor={(it) => it.key}
        renderItem={() => (
          <View style={{ padding: 16 }}>
            {/* STEP 0 — Gezi Adı */}
            {step === 0 && (
              <Card title="Gezi Adı">
                <Text style={{ color: '#A8A8B3' }}>Lütfen geziye bir isim verin (ör. “Ankara + Antalya Sonbahar”).</Text>
                <Input placeholder="Gezi adı" value={tripTitle} onChangeText={setTripTitle} maxLength={80} autoFocus />
                <Text style={{ color: '#6B7280', fontSize: 12 }}>
                  {Math.max(0, 80 - (tripTitle || '').length)} karakter kaldı
                </Text>
              </Card>
            )}

            {/* STEP 1 — Nereye gidiyorsun? */}
            {step === 1 && (
              <Card title="Nereye gidiyorsun?">
                <WhereToQuestion initialMode="single" onChange={setWhereAnswer} />
              </Card>
            )}

            {/* STEP 2 — Başlangıç & Bitiş */}
            {step === 2 && whereAnswer && (
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

            {/* STEP 3 — Konaklama */}
            {step === 3 && whereAnswer && (
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
                      travelMode={travelMode}
                      onChangeMode={setTravelMode}
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
                              travelMode={travelMode}
                              onChangeMode={setTravelMode}
                            />
                          ) : null}
                        </>
                      );
                    })()}
                  </View>
                )}
              </Card>
            )}

            {/* STEP 4 — Gezilecek Yerler */}
            {step === 4 && (
              <Card title="Gezilecek Yerler">
                {whereAnswer?.mode === 'multi' ? (
                  <View style={{ gap: 10 }}>
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
                      listHeight={420}
                      travelMode={travelMode} setTravelMode={setTravelMode} 
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
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 12 }}
      />

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={() => {
          const key = draft?.id ?? draft?._id ?? null;
          if (key) patchTripLocal(key, { wizardStep: step }).catch(()=>{});
          nav.goBack();
        }} style={styles.ghostBtn}>
          <Text style={styles.ghostText}>Vazgeç</Text>
        </TouchableOpacity>

        {!(openedForEdit && editIntent?.target === 'lodging' && step === 3) && step > 0 && (
          <TouchableOpacity onPress={back} style={styles.secondaryBtn}>
            <Text style={styles.secondaryText}>Geri</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity disabled={!canNext} onPress={next} style={[styles.primaryBtn, !canNext && styles.disabled]}>
          <Text style={styles.primaryText}>İleri</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ------------------------------ Helpers/UI ------------------------------ */
function Header({ step, titles, title }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
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
    return { start: singleSE?.start?.date || null, end: singleSE?.end?.date || null };
  }
  const dates = [];
  (where.items || []).forEach(it => {
    const se = multiSE[it.city.place_id];
    if (se?.start?.date) dates.push(se.start.date);
    if (se?.end?.date)   dates.push(se.end.date);
  });
  if (!dates.length) return { start: null, end: null };
  const asc = dates.slice().sort();
  return { start: asc[0] || null, end: asc[asc.length - 1] || null };
}

function buildStays(where, singleSE, multiSE, singleSegs, byCitySegs) {
  const toStay = (cityName, seg) => ({
    id: seg.id,
    city: cityName,
    place: { name: seg.place?.name, place_id: seg.place?.place_id },
    nights: diffNights(seg.start, seg.end),
    checkIn: '14:00',
    checkOut: '11:00',
    dateRange: { start: seg.start, end: seg.end },
  });
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
