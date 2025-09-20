// StartEndQuestion.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  InteractionManager,
  DeviceEventEmitter,
} from 'react-native';
import { Calendar } from 'react-native-calendars';

// Şehir bazlı hub katalog
import { getHubs } from '../src/services/hubsCatalog';

const BORDER = '#23262F';
const BTN = '#2563EB';
const EVT_CLOSE_DROPDOWNS = 'CLOSE_ALL_DROPDOWNS';
const AUTO_SELECT_SINGLE = false;

const TYPE_MAP = {
  airport: { mode: 'plane', label: 'Havalimanı' },
  train:   { mode: 'train', label: 'Tren Garı' },
  bus:     { mode: 'bus',   label: 'Otogar' },
  map:     { mode: 'custom', label: 'Haritadan Seç' },
};

const TIME_SLOTS = (() => {
  const arr = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      arr.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return arr;
})();

/* ------------------------------ Date utils & validator ------------------------------ */
const toISO = (d) => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+date)) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** 
 * Validation:
 * - Single segment: start <= end
 * - Multi-city continuity (no overlap):
 *    - If prevSegmentEnd is provided, start >= prevSegmentEnd
 *    - If nextSegmentStart is provided, end <= nextSegmentStart
 */
function validateDates({ startDate, endDate, prevSegmentEnd, nextSegmentStart }) {
  const issues = [];
  const s = toISO(startDate);
  const e = toISO(endDate);
  const prevE = toISO(prevSegmentEnd);
  const nextS = toISO(nextSegmentStart);

  // Required ordering for this segment
  if (s && e && s > e) {
    issues.push({
      code: 'START_AFTER_END',
      message: `Başlangıç (${s}) bitiş (${e}) tarihinden sonraya olamaz.`,
      field: 'start',
    });
  }

  // No overlap with previous segment (allow equal)
  if (prevE && s && s < prevE) {
    issues.push({
      code: 'START_BEFORE_PREV_END',
      message: `Bu şehrin başlangıcı (${s}), önceki segmentin bitişinden (${prevE}) önce olamaz.`,
      field: 'start',
    });
  }

  // No overlap with next segment (allow equal)
  if (nextS && e && e > nextS) {
    issues.push({
      code: 'END_AFTER_NEXT_START',
      message: `Bu şehrin bitişi (${e}), sonraki segmentin başlangıcından (${nextS}) sonra olamaz.`,
      field: 'end',
    });
  }

  return issues;
}

export default function StartEndQuestion({
  countryCode,
  cityName,
  cityCenter,   // { lat, lng }
  value,
  onChange,
  onMapPick,    // (which, { center, cityName }) => Promise<pickedHub|null|undefined>

  /* 🔗 Optional props for multi-city continuity (from parent/wizard):
     - prevSegmentEnd: ISO date (YYYY-MM-DD) → this segment's start must be >= prevSegmentEnd
     - nextSegmentStart: ISO date (YYYY-MM-DD) → this segment's end must be <= nextSegmentStart
     - onValidityChange: (isValid:boolean, issues:Array) => void
  */
  prevSegmentEnd,
  nextSegmentStart,
  onValidityChange,
}) {
  const defaultStart = { type: null, hub: null, date: null, time: '09:00' };
  const defaultEnd   = { type: null, hub: null, date: null, time: '17:00' };

  const [start, setStart] = useState(value?.start || defaultStart);
  const [end,   setEnd]   = useState(value?.end   || defaultEnd);

  // dışarıdan value güncellenirse senkronize et
  useEffect(() => {
    setStart(value?.start || defaultStart);
  }, [value?.start?.type, value?.start?.hub?.place_id, value?.start?.date, value?.start?.time]);

  useEffect(() => {
    setEnd(value?.end || defaultEnd);
  }, [value?.end?.type, value?.end?.hub?.place_id, value?.end?.date, value?.end?.time]);

  // ✅ Derive validation issues
  const issues = useMemo(() => {
    return validateDates({
      startDate: start?.date,
      endDate: end?.date,
      prevSegmentEnd,
      nextSegmentStart,
    });
  }, [start?.date, end?.date, prevSegmentEnd, nextSegmentStart]);

  const hasErrors = issues.length > 0;

  // üst bileşene bildir (value + validity)
  useEffect(() => {
    onChange?.({ start, end });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  useEffect(() => {
    onValidityChange?.(!hasErrors, issues);
  }, [hasErrors, issues, onValidityChange]);

  // Calendar hints:
  // - Start date: cannot be before prevSegmentEnd (if given), and not after chosen end
  // - End date: cannot be before chosen start, and not after nextSegmentStart (if given)
  const startMinDate = prevSegmentEnd || undefined;
  const startMaxDate = end?.date || undefined;

  const endMinDate = start?.date || undefined;
  const endMaxDate = nextSegmentStart || undefined;

  return (
    <View style={{ gap: 14 }}>
      {/* 🔔 Error banner (shows all current issues) */}
      {hasErrors && (
        <View style={styles.errorBanner}>
          {issues.map((it, i) => (
            <Text key={`${it.code}-${i}`} style={styles.errorText}>• {it.message}</Text>
          ))}
        </View>
      )}

      <Card title={`${cityName} • Başlangıç`}>
        <PointPicker
          label="Nereden?"
          countryCode={countryCode}
          cityName={cityName}
          cityCenter={cityCenter}
          selectedType={start.type}
          selectedHub={start.hub}
          onSelectType={async (t) => {
            if (t === 'map') {
              try {
                const hasValidCenter =
                  cityCenter &&
                  Number.isFinite(Number(cityCenter.lat)) &&
                  Number.isFinite(Number(cityCenter.lng));
                const center = hasValidCenter
                  ? { lat: Number(cityCenter.lat), lng: Number(cityCenter.lng) }
                  : undefined;

                const picked = await onMapPick?.('start', { center, cityName });
                if (picked === undefined) return; // kullanıcı iptal etti
                setStart((s) => ({ ...s, type: 'map', hub: picked || null }));
              } catch {
                // sessiz geç
              }
            } else {
              if (start.type === t) return;
              setStart((s) => ({ ...s, type: t, hub: null }));
            }
          }}
          onSelectHub={(hub) => setStart((s) => ({ ...s, hub }))}
          onClear={() => setStart((s) => ({ ...s, hub: null }))}
        />
        <Row>
          <DatePicker
            label="Tarih"
            value={start.date}
            minDate={startMinDate}
            maxDate={startMaxDate}
            onChange={(d) => setStart((s) => ({ ...s, date: d }))}
            fieldInvalid={issues.some(x => x.field === 'start')}
          />
          <TimeDropdown
            label="Saat"
            value={start.time}
            onChange={(t) => setStart((s) => ({ ...s, time: t }))}
          />
        </Row>
      </Card>

      <Card title={`${cityName} • Bitiş`}>
        <PointPicker
          label="Nerede bitecek?"
          countryCode={countryCode}
          cityName={cityName}
          cityCenter={cityCenter}
          selectedType={end.type}
          selectedHub={end.hub}
          onSelectType={async (t) => {
            if (t === 'map') {
              try {
                const hasValidCenter =
                  cityCenter &&
                  Number.isFinite(Number(cityCenter.lat)) &&
                  Number.isFinite(Number(cityCenter.lng));
                const center = hasValidCenter
                  ? { lat: Number(cityCenter.lat), lng: Number(cityCenter.lng) }
                  : undefined;

                const picked = await onMapPick?.('end', { center, cityName });
                if (picked === undefined) return;
                setEnd((s) => ({ ...s, type: 'map', hub: picked || null }));
              } catch {}
            } else {
              if (end.type === t) return;
              setEnd((s) => ({ ...s, type: t, hub: null }));
            }
          }}
          onSelectHub={(hub) => setEnd((s) => ({ ...s, hub }))}
          onClear={() => setEnd((s) => ({ ...s, hub: null }))}
        />
        <Row>
          <DatePicker
            label="Tarih"
            value={end.date}
            minDate={endMinDate}
            maxDate={endMaxDate}
            onChange={(d) => setEnd((s) => ({ ...s, date: d }))}
            fieldInvalid={issues.some(x => x.field === 'end')}
          />
          <TimeDropdown
            label="Saat"
            value={end.time}
            onChange={(t) => setEnd((s) => ({ ...s, time: t }))}
          />
        </Row>
      </Card>
    </View>
  );
}

/* -------------------------------- Sub-components ------------------------------- */
function Card({ title, children }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}
function Row({ children }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

function PointPicker({
  label,
  countryCode,
  cityName,
  cityCenter,
  selectedType,
  selectedHub,
  onSelectType,
  onSelectHub,
  onClear,
}) {
  const [openHubModal, setOpenHubModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hubs, setHubs] = useState([]);
  const [filter, setFilter] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // tüm dropdownları kapat
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => {
      if (mountedRef.current) setOpenHubModal(false);
    });
    return () => sub.remove();
  }, []);

  // tip 'map' olursa veya temizlenirse modalı kapat
  useEffect(() => {
    if (selectedType === 'map' || !selectedType) setOpenHubModal(false);
  }, [selectedType]);

  // basit cache
  const cacheRef = useRef(new Map());
  const keyBase = useMemo(() => {
    const cc = String(countryCode || '').toUpperCase();
    const adminOrCity = cityName || 'unknown';
    return `${cc}|${adminOrCity}`;
  }, [countryCode, cityName]);

  const normStr = (v) => (v ?? '').toString().trim();

  async function ensureHubs(typeKey) {
    const modeKey = TYPE_MAP[typeKey]?.mode;
    if (!modeKey || modeKey === 'custom') {
      setHubs([]);
      return;
    }

    const cacheKey = `${keyBase}|${typeKey}`;
    if (cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey);
      if (mountedRef.current) setHubs(cached);
      return;
    }

    setLoading(true);
    try {
      const cc = String(countryCode || '').toUpperCase();
      const admin = cc === 'TR' ? normStr(cityName) || null : null;
      const city = cc === 'TR' ? null : normStr(cityName) || null;

      let rawAll = null;
      try {
        if (typeof getHubs === 'function') {
          rawAll = getHubs({ country: cc, admin, city });
        }
      } catch (e) {
        console.error('[getHubs] threw:', e?.message || e);
      }
      if (!rawAll || typeof rawAll !== 'object') {
        rawAll = { plane: [], train: [], bus: [] };
      }

      const sourceArr = Array.isArray(rawAll?.[modeKey]) ? rawAll[modeKey] : [];

      let mapped = (sourceArr || [])
        .map((h, idx) => {
          const lat = Number(h?.lat ?? h?.latitude);
          const lng = Number(h?.lng ?? h?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          const name = normStr(h?.name) || `#${idx}`;
          const pid =
            normStr(h?.place_id) || `${cc}|${normStr(cityName)}|${modeKey}|${idx}`;
          return { name, place_id: pid, location: { lat, lng } };
        })
        .filter(Boolean);

      let filtered = [];
      try {
        filtered = normalizeHubsForType(typeKey, mapped, cityName, cityCenter);
      } catch (e) {
        console.error('[normalizeHubsForType] error:', e?.message || e);
        filtered = mapped;
      }

      cacheRef.current.set(cacheKey, filtered);
      if (mountedRef.current) {
        setHubs(filtered);
        if (filtered.length === 1 && AUTO_SELECT_SINGLE)
          onSelectHub?.(toHubShape(filtered[0]));
      }
    } catch (e) {
      console.error('[PointPicker.ensureHubs] error:', e);
      if (mountedRef.current) setHubs([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  // TIP değiştiğinde: filtre sıfırla + veri getir
  useEffect(() => {
    setFilter('');
    setHubs([]);
    if (selectedType && selectedType !== 'map') {
      InteractionManager.runAfterInteractions(() => {
        if (mountedRef.current) ensureHubs(selectedType);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, keyBase]);

  // Modal içi arama
  const filteredHubs = useMemo(() => {
    if (!filter.trim()) return hubs;
    const q = norm(filter);
    const starts = [];
    const contains = [];
    hubs.forEach((h) => {
      const n = norm(h.name);
      if (n.startsWith(q)) starts.push(h);
      else if (n.includes(q)) contains.push(h);
    });
    return [...starts, ...contains];
  }, [hubs, filter]);

  const closeHub = () => {
    if (mountedRef.current) setOpenHubModal(false);
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>

      {/* Tip butonları */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(TYPE_MAP).map(([k, v]) => (
          <TouchableOpacity
            key={k}
            onPress={() => onSelectType(k)}
            style={[styles.modeBtn, selectedType === k && styles.modeBtnActive]}
          >
            <Text style={styles.modeText}>{v.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* “Haritadan Seç” */}
      {selectedType === 'map' && (
        <TouchableOpacity onPress={() => onSelectType('map')} style={styles.selectShell}>
          <Text style={styles.selectShellText}>
            {selectedHub?.name || 'Haritadan seç'}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </TouchableOpacity>
      )}

      {/* Hub seçimi (airport/train/bus) */}
      {selectedType && selectedType !== 'map' && (
        <TouchableOpacity
          onPress={() => setOpenHubModal(true)}
          style={styles.selectShell}
        >
          <Text style={styles.selectShellText}>
            {selectedHub?.name || `${TYPE_MAP[selectedType].label} seçin`}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </TouchableOpacity>
      )}

      {/* Seçimi temizle */}
      {!!selectedHub && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity
            onPress={onClear}
            style={[styles.smallBtn, { borderColor: '#EF4444' }]}
          >
            <Text style={{ color: '#EF4444', fontWeight: '700' }}>
              Seçimi Temizle
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {openHubModal && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          hardwareAccelerated
          onRequestClose={closeHub}
          onDismiss={closeHub}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeHub} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {TYPE_MAP[selectedType || 'airport']?.label} Seçin
            </Text>

            {/* Arama kutusu */}
            <TextInput
              placeholder="İsimle ara (örn. Esenboğa)"
              placeholderTextColor="#6B7280"
              value={filter}
              onChangeText={setFilter}
              style={styles.searchInput}
            />

            {loading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ color: '#9AA0A6', marginTop: 8 }}>Yükleniyor…</Text>
              </View>
            ) : (
              <FlatList
                data={filteredHubs.slice(0, 300)}
                keyExtractor={(it, i) => String(it?.place_id ?? i)}
                removeClippedSubviews
                keyboardShouldPersistTaps="always"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      onSelectHub(toHubShape(item));
                      requestAnimationFrame(() => {
                        if (mountedRef.current) setOpenHubModal(false);
                      });
                    }}
                  >
                    <Text style={styles.optionText}>{item.name}</Text>
                    {item.meta && (
                      <Text style={{ color: '#9AA0A6', fontSize: 12 }}>
                        {item.meta}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                contentContainerStyle={{ paddingBottom: 12 }}
              />
            )}

            <TouchableOpacity onPress={closeHub} style={[styles.smallBtn, { marginTop: 8 }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </View>
  );
}

function DatePicker({ label, value, onChange, minDate, maxDate, fieldInvalid }) {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const marked = useMemo(() => {
    const base = value
      ? { [value]: { selected: true, selectedColor: BTN, selectedTextColor: '#fff' } }
      : {};
    return base;
  }, [value]);

  // global kapatma
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => {
      if (mountedRef.current) setOpen(false);
    });
    return () => sub.remove();
  }, []);

  const closeDate = () => {
    if (mountedRef.current) setOpen(false);
  };

  const disabledRange = (day) => {
    // Visual guard only; hard checks come from validator
    const ds = day?.dateString;
    if (minDate && ds < minDate) return true;
    if (maxDate && ds > maxDate) return true;
    return false;
  };

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={[styles.selectShell, fieldInvalid && styles.invalidBorder]}>
        <Text style={styles.selectShellText}>{value || 'Tarih seçin'}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          hardwareAccelerated
          onRequestClose={closeDate}
          onDismiss={closeDate}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeDate} />
          <View style={[styles.modalCard, { top: '12%', bottom: '12%' }]}>
            <Text style={styles.modalTitle}>Tarih Seçin</Text>
            <Calendar
              markedDates={marked}
              onDayPress={(d) => {
                if (!disabledRange(d)) {
                  onChange(d.dateString);
                  closeDate();
                }
              }}
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
            {!!(minDate || maxDate) && (
              <Text style={styles.hintText}>
                {minDate && `En erken: ${minDate}`}{minDate && maxDate && ' • '}{maxDate && `En geç: ${maxDate}`}
              </Text>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

function TimeDropdown({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => {
      if (mountedRef.current) setOpen(false);
    });
    return () => sub.remove();
  }, []);

  const closeTime = () => {
    if (mountedRef.current) setOpen(false);
  };

  const initialIndex = useMemo(() => {
    const idx = TIME_SLOTS.indexOf(value);
    return idx >= 0 ? idx : undefined;
  }, [value]);

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.selectShell}>
        <Text style={styles.selectShellText}>{value}</Text>
        <Text style={styles.caret}>▾</Text>
      </TouchableOpacity>

      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          hardwareAccelerated
          onRequestClose={closeTime}
          onDismiss={closeTime}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeTime} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Saat Seçin</Text>
            <FlatList
              data={TIME_SLOTS}
              keyExtractor={(it, i) => String(it ?? i)}
              removeClippedSubviews
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => {
                    onChange(item);
                    closeTime();
                  }}
                >
                  <Text style={styles.optionText}>{item}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, idx) => ({
                length: 44,
                offset: 44 * idx,
                index: idx,
              })}
              initialNumToRender={20}
              maxToRenderPerBatch={20}
              windowSize={8}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}

/* --------------------------------- Filtering logic --------------------------------- */
function trFold(s) {
  const map = {
    İ: 'i', I: 'i', ı: 'i',
    Ş: 's', ş: 's',
    Ğ: 'g', ğ: 'g',
    Ü: 'u', ü: 'u',
    Ö: 'o', ö: 'o',
    Ç: 'c', ç: 'c',
  };
  return String(s ?? '').replace(/[İIıŞşĞğÜüÖöÇç]/g, (ch) => map[ch] || ch);
}
function norm(s) {
  return trFold(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeHubsForType(typeKey, hubs, cityName, cityCenter) {
  const nameLC = (s) => (s || '').toString().toLowerCase();
  const strip = (s) => trFold(String(s ?? ''));
  const cityToken = nameLC(strip((cityName ?? '') + ''));

  const withDistance = hubs.map((h) => ({
    ...h,
    _d:
      h?.location?.lat != null &&
      h?.location?.lng != null &&
      cityCenter
        ? haversine(cityCenter, h.location)
        : null,
    _name: nameLC(h.name || ''),
  }));

  let inc = [],
    exc = [],
    maxKm = 30;
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

  const isBad = (n) => exc.some((k) => n.includes(k));
  const matchesInc = (n) => inc.some((k) => n.includes(k));

  // 1) sıkı filtre
  let filtered = withDistance.filter((h) => matchesInc(h._name) && !isBad(h._name));
  filtered = filtered.filter((h) => (h._d != null ? h._d <= maxKm : true));

  // 2) gerekirse gevşet
  if (filtered.length === 0) {
    filtered = withDistance
      .filter((h) => !isBad(h._name))
      .filter((h) => h._d == null || h._d <= maxKm);
  }

  // 3) skorla
  filtered.forEach((h) => {
    let score = 0;
    if (cityToken && h._name.includes(cityToken)) score += 5;
    if (h._d != null) score += Math.max(0, (maxKm - h._d) / maxKm) * 4;
    if (matchesInc(h._name)) score += 1.5;
    h._score = score;
  });

  filtered.sort((a, b) => b._score - a._score);

  return filtered.map((h) => ({
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
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/* --------------------------------- Styles --------------------------------- */
const styles = StyleSheet.create({
  card: {
    borderBottomWidth: 1,
    borderColor: BORDER,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0B0D12',
  },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 8 },

  label: { fontSize: 13, color: '#A8A8B3', marginBottom: 6 },
  modeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: '#0D0F14',
  },
  modeBtnActive: { borderColor: BTN, backgroundColor: '#0E1B2E' },
  modeText: { color: '#fff' },

  selectShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#0D0F14',
  },
  selectShellText: { color: '#fff' },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },

  smallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#0D0F14',
  },

  modalBackdrop: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: '14%',
    bottom: '14%',
    borderRadius: 16,
    backgroundColor: '#0D0F14',
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },

  searchInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    marginBottom: 8,
    backgroundColor: '#0D0F14',
  },

  optionRow: { paddingVertical: 11, paddingHorizontal: 10 },
  optionText: { fontSize: 15, color: '#fff' },
  separator: { height: 1, backgroundColor: BORDER },

  /* 🔔 Validation UI */
  errorBanner: {
    borderWidth: 1,
    borderColor: '#F87171',
    backgroundColor: '#2A0F13',
    padding: 10,
    borderRadius: 10,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, lineHeight: 18 },
  invalidBorder: { borderColor: '#F87171' },

  /* Hint for min/max */
  hintText: { color: '#9AA0A6', fontSize: 12, marginTop: 8, textAlign: 'center' },
});
