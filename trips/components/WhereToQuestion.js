import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
  FlatList, Pressable, InteractionManager,
} from 'react-native';
import { searchCities, listCountries, getCitiesForCountry } from '../services/geoService';

const BORDER = '#23262F';
const BTN = '#2563EB';

// basit debounce
function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export default function WhereToQuestion({ initialMode = 'single', onChange }) {
  const [mode, setMode] = useState(initialMode);

  // Her zaman dizi döndür (geoService ne döndürürse döndürsün)
  const safeCities = useCallback((countryCode, q) => {
    try {
      const arr = getCitiesForCountry(countryCode, q);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }, []);

  // Ülkeler
  const rawCountries = useMemo(() => listCountries(), []);
  const countryOptions = useMemo(
    () => rawCountries.map((c) => ({ key: c.code, label: c.name })),
    [rawCountries]
  );
  const findLabel = useCallback(
    (code) => rawCountries.find((c) => c.code === code)?.name || code,
    [rawCountries]
  );

  // Tek şehir
  const defaultCountry = rawCountries[0]?.code || 'TR';
  const [singleCountryCode, setSingleCountryCode] = useState(defaultCountry);
  const [singleCityQuery, setSingleCityQuery] = useState('');
  const [singleCityOptions, setSingleCityOptions] = useState(() =>
    safeCities(defaultCountry, '')
  );
  const [singleCity, setSingleCity] = useState(null);

  // Çoklu
  const [rows, setRows] = useState([makeRow()]);
  function makeRow() {
    return {
      id: 'row-' + Math.random().toString(36).slice(2, 9),
      countryCode: null,
      countryLabel: null,
      cityQuery: '',
      cityOptions: [],
      city: null,
    };
  }
  const addRow = () => setRows((prev) => [...prev, makeRow()]);
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const sessionTokenRef = useRef(makeSessionToken());

  /** ───── Tek şehir: şehir dropdown davranışı (debounced) ───── */
  const runSingleCitySearch = useMemo(
    () =>
      debounce(async (q) => {
        setSingleCityQuery(q);
        setSingleCityOptions(safeCities(singleCountryCode, q));
        // Etkileşim sonrası preload (UI bloklanmasın)
        InteractionManager.runAfterInteractions(async () => {
          try {
            await searchCities({ countryCode: singleCountryCode, query: q, sessionToken: sessionTokenRef.current });
          } finally {
            setSingleCityOptions(safeCities(singleCountryCode, q));
          }
        });
      }, 120),
    [singleCountryCode, safeCities]
  );

  async function selectSingleCity(opt) {
    const city = {
      place_id: opt.place_id,
      description: opt.description,
      name: opt.main_text || opt.description,
      center: null, // admins-only
    };
    setSingleCity(city);
    setSingleCityQuery(city.name || '');
    setSingleCityOptions(safeCities(singleCountryCode, city.name || ''));
  }

  // İlk açılış: default ülkeyi preload et (etkileşim sonrası)
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(async () => {
      await searchCities({ countryCode: defaultCountry, query: '', sessionToken: sessionTokenRef.current });
      setSingleCityOptions(safeCities(defaultCountry, ''));
    });
    return () => { task?.cancel?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ülke değişince: önce cache → sonra etkileşim sonrası preload
  useEffect(() => {
    setSingleCity(null);
    setSingleCityQuery('');
    setSingleCityOptions(safeCities(singleCountryCode, ''));
    const task = InteractionManager.runAfterInteractions(async () => {
      try {
        await searchCities({ countryCode: singleCountryCode, query: '', sessionToken: sessionTokenRef.current });
      } finally {
        setSingleCityOptions(safeCities(singleCountryCode, ''));
      }
    });
    return () => { task?.cancel?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleCountryCode, safeCities]);

  /** ───── Çoklu: ülke/şehir ───── */
  function pickRowCountry(rowId, code, label) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, countryCode: code, countryLabel: label, city: null, cityQuery: '', cityOptions: safeCities(code, '') }
          : r
      )
    );
    InteractionManager.runAfterInteractions(async () => {
      try {
        await searchCities({ countryCode: code, query: '', sessionToken: sessionTokenRef.current });
      } finally {
        setRows((prev) =>
          prev.map((r) => (r.id === rowId ? { ...r, cityOptions: safeCities(code, '') } : r))
        );
      }
    });
  }

  const runRowCitySearch = useMemo(
    () =>
      debounce(async (rowId, q) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? { ...r, cityQuery: q, cityOptions: safeCities(r.countryCode, q) }
              : r
          )
        );
        const row = rows.find((r) => r.id === rowId);
        if (!row?.countryCode) return;
        InteractionManager.runAfterInteractions(async () => {
          try {
            await searchCities({ countryCode: row.countryCode, query: q, sessionToken: sessionTokenRef.current });
          } finally {
            setRows((prev) =>
              prev.map((r) =>
                r.id === rowId ? { ...r, cityOptions: safeCities(r.countryCode, q) } : r
              )
            );
          }
        });
      }, 120),
    [rows, safeCities]
  );

  async function pickRowCity(rowId, opt) {
    const city = {
      place_id: opt.place_id,
      description: opt.description,
      name: opt.main_text || opt.description,
      center: null,
    };
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, city, cityQuery: city.name || '' } : r)));
  }

  /** ───── Parent onChange ───── */
  useEffect(() => {
    if (mode === 'single') {
      onChange?.({
        mode: 'single',
        single: {
          countryCode: singleCountryCode,
          countryLabel: findLabel(singleCountryCode),
          city: singleCity,
        },
      });
    } else {
      const items = rows
        .filter((r) => r.countryCode && r.city?.name)
        .map((r) => ({
          countryCode: r.countryCode,
          countryLabel: r.countryLabel || findLabel(r.countryCode),
          city: r.city,
        }));
      onChange?.({ mode: 'multi', items });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, singleCountryCode, singleCity, rows]);

  /* ---------------- UI ---------------- */

  return (
    <View style={{ gap: 12 }}>
      {/* Sekme */}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <SegChip active={mode === 'single'} label="Tek şehir" onPress={() => setMode('single')} />
        <SegChip active={mode === 'multi'} label="Birden çok şehir/ülke" onPress={() => setMode('multi')} />
      </View>

      {mode === 'single' ? (
        <>
          <Field label="Ülke">
            <CountrySelect
              value={singleCountryCode}
              label={findLabel(singleCountryCode)}
              options={countryOptions}
              onPick={(code, label) => setSingleCountryCode(code)}
            />
          </Field>

          <Field label="Şehir (yazdıkça en benzerler üste)">
            <TextInput
              placeholder="Şehir yaz (örn. Paris)"
              placeholderTextColor="#6B7280"
              style={styles.input}
              value={singleCityQuery}
              onChangeText={runSingleCitySearch}
            />
            {Array.isArray(singleCityOptions) && singleCityOptions.length > 0 && (
              <View style={styles.dropdown}>
                <FlatList
                  data={singleCityOptions}
                  keyExtractor={(item, idx) => `city-${String(item?.place_id ?? idx)}`}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.dropItem} onPress={() => selectSingleCity(item)}>
                      <Text style={styles.dropText}>{item.description}</Text>
                    </TouchableOpacity>
                  )}
                  ItemSeparatorComponent={() => <View style={styles.separator} />}
                  initialNumToRender={16}
                  maxToRenderPerBatch={16}
                  windowSize={6}
                  removeClippedSubviews
                  style={{ maxHeight: 240 }}
                />
                {singleCityOptions.length >= 200 && (
                  <Text style={styles.hint}>
                    Çok sonuç var, daha fazla daraltmak için yazmaya devam edin.
                  </Text>
                )}
              </View>
            )}
            {singleCity?.name ? <Text style={styles.selInfo}>Seçilen: {singleCity.name}</Text> : null}
          </Field>
        </>
      ) : (
        <>
          {rows.map((row, idx) => (
            <View key={row.id} style={styles.rowCard}>
              <Field label={`Ülke ${rows.length > 1 ? `#${idx + 1}` : ''}`}>
                <CountrySelect
                  value={row.countryCode}
                  label={row.countryLabel || (row.countryCode ? findLabel(row.countryCode) : null)}
                  options={countryOptions}
                  onPick={(code, label) => pickRowCountry(row.id, code, label)}
                />
              </Field>

              <Field label="Şehir (yazdıkça en benzerler üste)">
                <TextInput
                  placeholder="Şehir adı yazın"
                  placeholderTextColor="#6B7280"
                  style={styles.input}
                  value={row.cityQuery}
                  onChangeText={(q) => runRowCitySearch(row.id, q)}
                  editable={!!row.countryCode}
                />

                {!!row.cityOptions?.length && (
                  <View style={styles.dropdown}>
                    <FlatList
                      data={row.cityOptions}
                      keyExtractor={(item, idx) => `city-${String(item?.place_id ?? idx)}`}
                      renderItem={({ item }) => (
                        <TouchableOpacity style={styles.dropItem} onPress={() => pickRowCity(row.id, item)}>
                          <Text style={styles.dropText}>{item.description}</Text>
                        </TouchableOpacity>
                      )}
                      ItemSeparatorComponent={() => <View style={styles.separator} />}
                      initialNumToRender={16}
                      maxToRenderPerBatch={16}
                      windowSize={6}
                      removeClippedSubviews
                      style={{ maxHeight: 240 }}
                    />
                    {row.cityOptions.length >= 200 && (
                      <Text style={styles.hint}>
                        Çok sonuç var, daha fazla daraltmak için yazmaya devam edin.
                      </Text>
                    )}
                  </View>
                )}
                {row.city?.name ? <Text style={styles.selInfo}>Seçilen: {row.city.name}</Text> : null}
              </Field>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                <TouchableOpacity onPress={() => removeRow(row.id)} style={[styles.smallBtn, { borderColor: '#EF4444' }]}>
                  <Text style={{ color: '#EF4444', fontWeight: '700' }}>Sil</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity onPress={addRow} style={[styles.smallBtn, { alignSelf: 'flex-start' }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>+ Ülke/Şehir Ekle</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

/* ------- yardımcı bileşenler / stil ------- */
function Field({ label, children }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}
function SegChip({ active, label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.segChip, active && styles.segChipActive]}>
      <Text style={[styles.segChipText, active && styles.segChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}
function CountrySelect({ value, label, options, onPick }) {
  const [open, setOpen] = useState(false);
  const text = label || (value ? value : 'Ülke seçin');

  return (
    <>
      <Pressable style={styles.selectShell} onPress={() => setOpen(true)}>
        <Text style={styles.selectShellText}>{text}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Ülke Seçin</Text>
          <FlatList
            data={options}
            keyExtractor={(it, idx) => (it?.key ? `cc-${it.key}` : `cc-${idx}`)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.optionRow}
                onPress={() => {
                  onPick(item.key, item.label);
                  setOpen(false);
                }}
              >
                <Text style={styles.optionText}>{item.label}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={6}
            removeClippedSubviews
          />
          <TouchableOpacity onPress={() => setOpen(false)} style={[styles.smallBtn, { marginTop: 8 }]}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

function makeSessionToken() {
  return Math.random().toString(36).slice(2) + Date.now();
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#A8A8B3' },
  input: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, fontSize: 15, color: '#fff', backgroundColor: '#0D0F14' },

  dropdown: { marginTop: 6, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#0D0F14' },
  dropItem: { paddingHorizontal: 12, paddingVertical: 10 },
  dropText: { color: '#fff' },
  selInfo: { color: '#A8A8B3', marginTop: 6 },

  hint: { color: '#9AA0A6', fontSize: 12, paddingHorizontal: 12, paddingVertical: 8 },

  segChip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#0D0F14' },
  segChipActive: { borderColor: BTN, backgroundColor: '#0E1B2E' },
  segChipText: { color: '#fff', fontWeight: '600' },
  segChipTextActive: { color: '#fff' },

  selectShell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D0F14' },
  selectShellText: { color: '#fff' },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },

  rowCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#0B0D12' },

  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { position: 'absolute', left: 16, right: 16, top: '18%', bottom: '18%', borderRadius: 16, backgroundColor: '#0D0F14', padding: 12, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },
  optionRow: { paddingVertical: 11, paddingHorizontal: 10 },
  optionText: { fontSize: 15, color: '#fff' },
  separator: { height: 1, backgroundColor: BORDER },
});
