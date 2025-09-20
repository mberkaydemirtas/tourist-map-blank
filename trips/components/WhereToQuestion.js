// trips/trips/components/WhereToQuestion.js
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  FlatList, Pressable, DeviceEventEmitter,
} from 'react-native';
import {
  listCountries,
  getCitiesForCountry,
  listAdminsForCountry,
  getAdminCenter,   // ✅
  getCityCenter,    // ✅ EKLENDİ
} from '../services/geoService';

const BORDER = '#23262F';
const BTN = '#2563EB';
const EVT_CLOSE_DROPDOWNS = 'CLOSE_ALL_DROPDOWNS';

/* basit helper */
function norm(s){
  try { return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
  catch { return String(s||'').toLowerCase().trim(); }
}

/** listAdminsForCountry çıktısını {key,label} dizisine normalize et */
function toAdminOptions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((it, idx) => {
    if (it && typeof it === 'object') {
      const label = it.label ?? it.name ?? it.key ?? String(idx);
      const key = it.key ?? norm(label) ?? String(idx);
      return { key, label };
    }
    const label = String(it ?? '');
    const key = norm(label) || String(idx);
    return { key, label };
  });
}

export default function WhereToQuestion({ initialMode = 'single', onChange }) {
  const [mode, setMode] = useState(initialMode);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

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

  // Tek seçim (ülke)
  const defaultCountry = 'TR';
  const [singleCountryCode, setSingleCountryCode] = useState(rawCountries[0]?.code || defaultCountry);

  // Admin (eyalet/il)
  const [singleAdmin, setSingleAdmin] = useState(null);
  const [singleAdminOptions, setSingleAdminOptions] = useState([]);

  // Şehir
  const [singleCity, setSingleCity] = useState(null);
  const [singleCityOptions, setSingleCityOptions] = useState([]);

  // Bu ekranda kural: TR → state-bazlı (admin göster, şehir gösterme)
  const isTR = singleCountryCode === 'TR';
  const hasAdmins = singleAdminOptions.length > 0;

  // Çoklu satırlar
  const [rows, setRows] = useState([makeRow()]);
  function makeRow() {
    return {
      id: 'row-' + Math.random().toString(36).slice(2, 9),
      countryCode: null,
      countryLabel: null,
      admin: null,
      adminOptions: [],
      cityOptions: [],
      city: null,
    };
  }
  const addRow = () => setRows((prev) => [...prev, makeRow()]);
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  // COUNTRY değişince
  useEffect(() => {
    setSingleAdmin(null);

    if (isTR) {
      const adminsRaw = listAdminsForCountry('TR');
      const admins = toAdminOptions(adminsRaw);
      setSingleAdminOptions(admins);
      setSingleCityOptions([]);
      setSingleCity(null);
    } else {
      setSingleAdminOptions([]);
      const opts = getCitiesForCountry(singleCountryCode, '') || [];
      setSingleCityOptions(opts);
      setSingleCity(null);
    }
  }, [singleCountryCode, isTR]);

  // Admin değişince (sadece TR’de anlamlı)
  useEffect(() => {
    if (!isTR) return;
    if (!singleAdmin) {
      setSingleCityOptions([]);
      setSingleCity(null);
      return;
    }
    const fakeCity = {
      place_id: `${singleCountryCode}-st-${singleAdmin}`,
      description: `${singleAdmin}, ${findLabel(singleCountryCode)}`,
      name: singleAdmin,
      center: getAdminCenter(singleCountryCode, singleAdmin) || null, // ✅ değişken geçti
    };
    setSingleCity(fakeCity);
    setSingleCityOptions([]);
  }, [singleAdmin, isTR, singleCountryCode, findLabel]);

  // Parent onChange
  useEffect(() => {
    if (mode === 'single') {
      onChange?.({
        mode: 'single',
        single: {
          countryCode: singleCountryCode,
          countryLabel: findLabel(singleCountryCode),
          city: singleCity,
          admin: isTR ? (singleAdmin || null) : null,
        },
      });
    } else {
      const items = rows
        .filter((r) => r.countryCode && r.city?.name)
        .map((r) => ({
          countryCode: r.countryCode,
          countryLabel: r.countryLabel || findLabel(r.countryCode),
          admin: r.countryCode === 'TR' ? (r.admin || null) : null,
          city: r.city,
        }));
      onChange?.({ mode: 'multi', items });
    }
  }, [mode, singleCountryCode, singleAdmin, singleCity, rows, onChange, findLabel, isTR]);

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
              onPick={(code) => setSingleCountryCode(code)}
            />
          </Field>

          {/* TR ise admin (il) göster */}
          {isTR && hasAdmins && (
            <Field label="İl">
              <AdminSelect
                value={singleAdmin}
                options={singleAdminOptions}
                placeholder="İl seçin"
                onPick={(label) => setSingleAdmin(label)}
              />
            </Field>
          )}

          {/* TR dışı ülkelerde şehir seçimi */}
          {!isTR && (
            <Field label="Şehir">
              <CitySelect
                value={singleCity?.name || null}
                options={singleCityOptions}
                placeholder="Şehir seçin"
                onPick={(opt) => {
                  const name = opt.main_text || opt.description;
                  const city = {
                    place_id: opt.place_id,
                    description: opt.description,
                    name,
                    center: getCityCenter(singleCountryCode, name) || null, // ✅ şehir merkezi
                  };
                  setSingleCity(city);
                }}
              />
            </Field>
          )}
        </>
      ) : (
        <>
          {rows.map((row, idx) => {
            const rowIsTR = row.countryCode === 'TR';
            const rowHasAdmins = (row.adminOptions?.length || 0) > 0;

            return (
              <View key={row.id} style={styles.rowCard}>
                <Field label={`Ülke ${rows.length > 1 ? `#${idx + 1}` : ''}`}>
                  <CountrySelect
                    value={row.countryCode}
                    label={row.countryLabel || (row.countryCode ? findLabel(row.countryCode) : null)}
                    options={countryOptions}
                    onPick={(code, label) => {
                      setRows((prev) =>
                        prev.map((r) => {
                          if (r.id !== row.id) return r;
                          if (code === 'TR') {
                            const adminOpts = toAdminOptions(listAdminsForCountry('TR'));
                            return {
                              ...r,
                              countryCode: code,
                              countryLabel: label,
                              admin: null,
                              adminOptions: adminOpts,
                              city: null,
                              cityOptions: [],
                            };
                          } else {
                            return {
                              ...r,
                              countryCode: code,
                              countryLabel: label,
                              admin: null,
                              adminOptions: [],
                              city: null,
                              cityOptions: getCitiesForCountry(code, '') || [],
                            };
                          }
                        })
                      );
                    }}
                  />
                </Field>

                {/* TR ise admin (il) seçimi */}
                {!!row.countryCode && rowIsTR && rowHasAdmins && (
                  <Field label="İl">
                    <AdminSelect
                      value={row.admin}
                      options={row.adminOptions}
                      placeholder="İl seçin"
                      onPick={(label) => {
                        setRows((prev) =>
                          prev.map((r) => {
                            if (r.id !== row.id) return r;
                            const fakeCity = {
                              place_id: `${r.countryCode}-st-${label}`,
                              description: `${label}, ${findLabel(r.countryCode)}`,
                              name: label,
                              center: getAdminCenter(r.countryCode, label) || null, // ✅ TR için admin merkezi
                            };
                            return { ...r, admin: label, city: fakeCity, cityOptions: [] };
                          })
                        );
                      }}
                    />
                  </Field>
                )}

                {/* TR dışı ülkelerde şehir seçimi */}
                {!!row.countryCode && !rowIsTR && (
                  <Field label="Şehir">
                    <CitySelect
                      value={row.city?.name || null}
                      options={row.cityOptions}
                      placeholder="Şehir seçin"
                      onPick={(opt) => {
                        const name = opt.main_text || opt.description;
                        const city = {
                          place_id: opt.place_id,
                          description: opt.description,
                          name,
                          center: getCityCenter(row.countryCode, name) || null, // ✅ şehir merkezi
                        };
                        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, city } : r)));
                      }}
                    />
                  </Field>
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                  <TouchableOpacity onPress={() => removeRow(row.id)} style={[styles.smallBtn, { borderColor: '#EF4444' }]}>
                    <Text style={{ color: '#EF4444', fontWeight: '700' }}>Sil</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

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
  // global kapat
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => setOpen(false));
    return () => sub.remove();
  }, []);
  const text = label || (value ? value : 'Ülke seçin');
  return (
    <>
      <Pressable style={styles.selectShell} onPress={() => setOpen(true)}>
        <Text style={styles.selectShellText}>{text}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          onRequestClose={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ülke Seçin</Text>
            <View style={{ flex: 1 }}>
              <FlatList
                data={options}
                keyExtractor={(it, idx) => (it?.key ? `cc-${it.key}` : `cc-${idx}`)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      onPick(item.key, item.label);
                      requestAnimationFrame(() => setOpen(false));
                    }}
                  >
                    <Text style={styles.optionText}>{item.label}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                removeClippedSubviews={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={10}
              />
            </View>
            <TouchableOpacity onPress={() => setOpen(false)} style={[styles.smallBtn, { marginTop: 8 }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </>
  );
}

// Admin seçimi (state/il)
function AdminSelect({ value, options, onPick, placeholder = 'İl seçin' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => setOpen(false));
    return () => sub.remove();
  }, []);
  const text = value || placeholder;
  return (
    <>
      <Pressable style={styles.selectShell} onPress={() => setOpen(true)}>
        <Text style={styles.selectShellText}>{text}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          onRequestClose={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{placeholder}</Text>
            <View style={{ flex: 1 }}>
              <FlatList
                data={options}
                keyExtractor={(it, idx) => (it?.key ? `ad-${it.key}` : `ad-${idx}`)}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      onPick(item.label || item.key);
                      requestAnimationFrame(() => setOpen(false));
                    }}
                  >
                    <Text style={styles.optionText}>{item.label || item.key}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                removeClippedSubviews={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={10}
              />
            </View>
            <TouchableOpacity onPress={() => setOpen(false)} style={[styles.smallBtn, { marginTop: 8 }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </>
  );
}

// Şehir seçimi — düz dropdown, arama YOK
function CitySelect({ value, options, onPick, placeholder = 'Şehir seçin' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(EVT_CLOSE_DROPDOWNS, () => setOpen(false));
    return () => sub.remove();
  }, []);
  const text = value || placeholder;
  return (
    <>
      <Pressable style={styles.selectShell} onPress={() => setOpen(true)}>
        <Text style={styles.selectShellText}>{text}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>
      {open && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          presentationStyle="overFullScreen"
          onRequestClose={() => setOpen(false)}
          onDismiss={() => setOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{placeholder}</Text>
            <View style={{ flex: 1 }}>
              <FlatList
                data={options}
                keyExtractor={(it, idx) => `city-${String(it?.place_id ?? idx)}`}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.optionRow}
                    onPress={() => {
                      onPick(item);
                      requestAnimationFrame(() => setOpen(false));
                    }}
                  >
                    <Text style={styles.optionText}>{item.description || item.main_text}</Text>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                removeClippedSubviews={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 12 }}
                initialNumToRender={30}
                maxToRenderPerBatch={30}
                windowSize={12}
              />
            </View>
            <TouchableOpacity onPress={() => setOpen(false)} style={[styles.smallBtn, { marginTop: 8 }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#A8A8B3' },

  segChip: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: '#0D0F14' },
  segChipActive: { borderColor: BTN, backgroundColor: '#0E1B2E' },
  segChipText: { color: '#fff', fontWeight: '600' },
  segChipTextActive: { color: '#fff' },

  selectShell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D0F14' },
  selectShellText: { color: '#fff', flexShrink: 1 },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D0F14' },

  rowCard: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, marginBottom: 10, backgroundColor: '#0B0D12' },

  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { position: 'absolute', left: 16, right: 16, top: '10%', bottom: '10%', borderRadius: 16, backgroundColor: '#0D0F14', padding: 12, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },

  optionRow: { paddingVertical: 11, paddingHorizontal: 10 },
  optionText: { fontSize: 15, color: '#fff' },

  separator: { height: 1, backgroundColor: BORDER },
});
