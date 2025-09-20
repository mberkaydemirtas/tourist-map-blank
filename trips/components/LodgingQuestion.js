// trips/questions/LodgingQuestion.js
// Entegre: "Haritadan Seç" işleyişi StartEndQuestion örneğindeki onMapPick yapısıyla entegre edildi.
// Gereksinimler:
// - İlk blok otomatik (tripRange başlangıç/bitiş seçili).
// - Her blokta TEK tarih alanı (takvimde period/range seçimi).
// - Konum alanları yok; sadece "Haritadan Konum Seç" butonu var.
// - Eksik geceler kırmızı uyarıyla listelenir.
// - Sadece eksik gece varsa "+ Konaklama Ekle" görünür.
// - "+ Konaklama Ekle" → ilk eksik aralığı otomatik doldur + haritayı aç; dönen yeri bloğa yazar.
// - "Haritadan Konum Seç" → mevcut bloğun (gerekirse otomatik) tarihleriyle haritayı aç; seçim gelirse bloğa yazar.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Calendar } from 'react-native-calendars';

const BTN = '#2563EB';
const BORDER = '#23262F';

/**
 * Props:
 * - tripRange: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
 * - cityName?: string
 * - cityCenter?: { lat: number, lng: number }
 * - stays: Array<{ id: string, startDate?: string, endDate?: string, place?: { name: string, place_id?: string, location?: {lat:number,lng:number} } | null }>
 * - onChange(nextStays)
 * - onMapPick?: (payload: { index: number, center?: { lat:number,lng:number }, cityName?: string, startDate: string, endDate: string }) => Promise<{ name: string, place_id?: string, location?: {lat:number,lng:number} } | null | undefined>
 */
export default function LodgingQuestion({ tripRange, cityName, cityCenter, stays = [], onChange, onMapPick }) {
   const [localStays, setLocalStays] = useState(() =>
     (stays && stays.length)
       ? stays
       : [{ id: uid(), startDate: tripRange?.startDate || '', endDate: tripRange?.endDate || '', place: null }]
   );
   const lastIndexRef = useRef(null);
 
   // İçerik eşitliği: ID farkını “değişiklik” sayma
   const eqStay = (a, b) =>
     a?.startDate === b?.startDate &&
     a?.endDate === b?.endDate &&
     (a?.place?.place_id ?? a?.place?.name ?? null) ===
       (b?.place?.place_id ?? b?.place?.name ?? null);
   const eqStays = (A, B) => {
     if (!Array.isArray(A) || !Array.isArray(B)) return false;
     if (A.length !== B.length) return false;
     for (let i = 0; i < A.length; i++) if (!eqStay(A[i], B[i])) return false;
     return true;
   };
 
   // Şehir veya tripRange değişince, SADECE farklıysa local state’i güncelle
   useEffect(() => {
     if (stays && stays.length) {
       if (!eqStays(localStays, stays)) setLocalStays(stays);
     } else {
       const seed = [{ id: uid(), startDate: tripRange?.startDate || '', endDate: tripRange?.endDate || '', place: null }];
       if (!eqStays(localStays, seed)) setLocalStays(seed);
     }
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [stays, tripRange?.startDate, tripRange?.endDate]);

   // Parent’a sadece farklı veri gitsin (echo-loop’u kır)
   useEffect(() => {
     if (!eqStays(localStays, stays)) onChange?.(localStays);
     // stays'i kasıtlı olarak dependency'e koymuyoruz; eqStays ile kontrol ediyoruz.
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [localStays]);

  // Coverage (geceler [start, end))
  const coverage = useMemo(() => buildCoverage(localStays, tripRange), [localStays, tripRange]);
  const { missingNights, firstMissingInterval } = coverage;

  function updateStayAt(index, patch) { setLocalStays(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s))); }
  function removeStayAt(index) { setLocalStays(prev => prev.filter((_, i) => i !== index)); }

  // Harita açma (mevcut bloğa)
  async function openPickerFor(index) {
    const s = localStays[index];
    if (!s) return;
    let start = s.startDate, end = s.endDate;
    if (!start || !end) {
      const auto = firstMissingInterval || { start: tripRange?.startDate, end: tripRange?.endDate };
      if (auto.start && auto.end) {
        updateStayAt(index, { startDate: auto.start, endDate: auto.end });
        start = auto.start; end = auto.end;
      }
    }
    if (!start || !end) return; // tripRange yoksa

    lastIndexRef.current = index;
    try {
      const picked = await onMapPick?.({ index, center: cityCenter, cityName, startDate: start, endDate: end });
      if (picked === undefined) return; // iptal
      updateStayAt(index, { place: picked || null });
    } catch (e) {
      // sessiz geç: harita tarafı iptal/hatada undefined/null dönmüş olabilir
    }
  }

  // Eksik gece için yeni blok + harita
  async function addStayForMissingAndPick() {
    if (!firstMissingInterval) return;
    const newIdx = localStays.length;
    const draft = { id: uid(), startDate: firstMissingInterval.start, endDate: firstMissingInterval.end, place: null };
    setLocalStays(prev => [...prev, draft]);
    lastIndexRef.current = newIdx;
    try {
      const picked = await onMapPick?.({ index: newIdx, center: cityCenter, cityName, startDate: draft.startDate, endDate: draft.endDate });
      if (picked !== undefined) updateStayAt(newIdx, { place: picked || null });
    } catch {}
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.note}>Konaklamalar • Gezi: {tripRange?.startDate || '—'} → {tripRange?.endDate || '—'}</Text>

      {localStays.map((stay, idx) => (
        <View key={stay.id} style={styles.card}>
          <Text style={styles.cardTitle}>Konaklama #{idx + 1}</Text>
          {!!stay.place?.name && <Text style={{ color:'#9AA0A6', marginTop: -4, marginBottom: 6 }}>{stay.place.name}</Text>}

          <DateRangeField
            label="Tarih Aralığı"
            startDate={stay.startDate}
            endDate={stay.endDate}
            minDate={tripRange?.startDate}
            maxDate={tripRange?.endDate}
            onChange={(range) => updateStayAt(idx, range)}
          />

          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Pressable onPress={() => openPickerFor(idx)} style={[styles.btn, { borderColor: BTN }]}>
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {stay.place?.name ? 'Konumu Değiştir (Harita)' : 'Haritadan Konum Seç'}
              </Text>
            </Pressable>
            <Pressable onPress={() => removeStayAt(idx)} style={[styles.btn, { borderColor: '#EF4444' }]}>
              <Text style={[styles.btnText, { color: '#EF4444' }]}>Sil</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {/* Eksikler */}
      {missingNights.length > 0 && (
        <Text style={styles.error}>Eksik geceler: {formatDays(missingNights)}</Text>
      )}

      {/* Sadece eksik varsa göster */}
      {missingNights.length > 0 && (
        <Pressable onPress={addStayForMissingAndPick} style={styles.addBtn}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>+ Konaklama Ekle</Text>
          {firstMissingInterval && (
            <Text style={{ color: '#9AA0A6' }}>{firstMissingInterval.start} → {firstMissingInterval.end}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/* ------------------------------ DateRangeField ----------------------------- */
function DateRangeField({ label, startDate, endDate, minDate, maxDate, onChange }) {
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState(startDate || null);
  const [tempEnd, setTempEnd] = useState(endDate || null);

  useEffect(() => { setTempStart(startDate || null); }, [startDate]);
  useEffect(() => { setTempEnd(endDate || null); }, [endDate]);

  const marked = useMemo(() => buildMarkedPeriod(tempStart, tempEnd), [tempStart, tempEnd]);

  function onDayPress(d) {
    const sel = d.dateString;
    if (!tempStart || (tempStart && tempEnd)) { setTempStart(sel); setTempEnd(null); return; }
    if (tempStart && !tempEnd) { if (sel < tempStart) { setTempStart(sel); setTempEnd(null); return; } setTempEnd(sel); }
  }

  function confirm() {
    if (tempStart && tempEnd) { onChange?.({ startDate: tempStart, endDate: tempEnd }); setOpen(false); }
  }

  function clearSel() { setTempStart(null); setTempEnd(null); }

  const display = (startDate && endDate) ? `${startDate} → ${endDate}` : 'Tarih aralığı seçin';

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={() => setOpen(true)} style={styles.selectShell}>
        <Text style={{ color: '#fff' }}>{display}</Text>
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{label}</Text>
          <Calendar
            minDate={minDate}
            maxDate={maxDate}
            onDayPress={onDayPress}
            markedDates={marked}
            markingType="period"
            theme={{ calendarBackground: '#0D0F14', dayTextColor: '#fff', monthTextColor: '#fff', textDisabledColor: '#6B7280', arrowColor: '#fff', todayTextColor: '#60A5FA' }}
            style={{ borderRadius: 12, overflow: 'hidden' }}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <Pressable onPress={clearSel} style={[styles.btn, { borderColor: BORDER }]}><Text style={[styles.btnText, { color: '#fff' }]}>Temizle</Text></Pressable>
            <Pressable onPress={confirm} disabled={!(tempStart && tempEnd)} style={[styles.btn, { borderColor: BTN, opacity: (tempStart && tempEnd) ? 1 : 0.5 }]}>
              <Text style={[styles.btnText, { color: '#fff' }]}>Kaydet</Text>
            </Pressable>
          </View>
          <Text style={{ color: '#9AA0A6', marginTop: 6 }}>İzin verilen aralık: {minDate || '—'} → {maxDate || '—'}</Text>
        </View>
      </Modal>
    </View>
  );
}

/* --------------------------------- Helpers -------------------------------- */
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function toDate(s) { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); if (!y||!m||!d) return null; return new Date(y, (m||1)-1, d||1); }
function toISO(d) { const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }
function addDaysISO(s, n) { const d=toDate(s); d.setDate(d.getDate()+n); return toISO(d); }
function nightsBetween(start, end) { const out=[]; if(!start||!end||start>=end) return out; let cur=start; while(cur<end){ out.push(cur); cur=addDaysISO(cur,1);} return out; }
function buildCoverage(stays, tripRange) { const expected=nightsBetween(tripRange?.startDate, tripRange?.endDate); const seen=new Set(); for(const s of stays){ if(!s.startDate||!s.endDate) continue; for(const n of nightsBetween(s.startDate,s.endDate)) seen.add(n);} const missing=expected.filter(n=>!seen.has(n)); return { missingNights: missing, firstMissingInterval: computeFirstMissingInterval(missing) }; }
function computeFirstMissingInterval(daysArr){ if(!daysArr?.length) return null; const sorted=[...daysArr].sort(); let start=sorted[0], prev=start; for(let i=1;i<sorted.length;i++){ const cur=sorted[i]; if(cur!==addDaysISO(prev,1)) return { start, end: addDaysISO(prev,1)}; prev=cur;} return { start, end: addDaysISO(prev,1)}; }
function formatDays(arr){ const s=[...arr].sort(); if(s.length<=6) return s.join(', '); return `${s.slice(0,6).join(', ')} … (+${s.length-6})`; }
function daysInclusive(a,b){ if(!a||!b||a>b) return []; const out=[]; let cur=a; while(cur<=b){ out.push(cur); cur=addDaysISO(cur,1);} return out; }
function buildMarkedPeriod(start, end){ if(!start&&!end) return {}; const obj={}; if(start&&!end){ obj[start]={ startingDay:true, endingDay:true, color:BTN, textColor:'#fff' }; return obj;} if(start&&end){ const days=daysInclusive(start,end); days.forEach((d,i)=>{ obj[d]={ startingDay:i===0, endingDay:i===days.length-1, color:BTN, textColor:'#fff' };}); return obj;} return {}; }

/* ---------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  note: { color: '#A8A8B3' },
  card: { borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 12, backgroundColor: '#0B0D12' },
  cardTitle: { color: '#fff', fontWeight: '700', marginBottom: 6 },
  label: { fontSize: 13, color: '#A8A8B3', marginBottom: 6 },
  selectShell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D0F14' },
  caret: { fontSize: 12, color: '#9AA0A6', marginLeft: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, backgroundColor: '#0D0F14' },
  btnText: { fontWeight: '700' },
  addBtn: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: '#0D1117', alignSelf: 'flex-start', gap: 2 },
  error: { color: '#F87171', marginTop: 8, fontWeight: '700' },
  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalCard: { position: 'absolute', left: 16, right: 16, top: '18%', bottom: '18%', borderRadius: 16, backgroundColor: '#0D0F14', padding: 12, borderWidth: 1, borderColor: BORDER },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#fff' },
});