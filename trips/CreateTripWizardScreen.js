// src/trips/CreateTripWizardScreen.js
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { createTrip } from './services/tripsService';
import { buildInitialDailyPlan, outboundMustArriveBeforeMin } from './shared/types';

const BORDER = '#23262F';
const BTN = '#2563EB';

export default function CreateTripWizardScreen() {
  const nav = useNavigation();
  const [step, setStep] = useState(0);

  // 1) Tarihler
  const [startDate, setStartDate] = useState('2025-10-21');
  const [endDate, setEndDate] = useState('2025-10-25');

  // 2) Ulaşım
  const [inMode, setInMode] = useState('plane');
  const [inArriveTime, setInArriveTime] = useState('10:30');
  const [inHubName, setInHubName] = useState('Havalimanı');

  const [outMode, setOutMode] = useState('plane');
  const [outDepartTime, setOutDepartTime] = useState('17:45');
  const [outHubName, setOutHubName] = useState('Havalimanı');

  // 3) Konaklama
  const [lodgingCity, setLodgingCity] = useState('İstanbul');
  const [lodgingName, setLodgingName] = useState('Otel / Adres');
  const nights = useMemo(() => {
    try {
      const s = new Date(startDate + 'T00:00:00');
      const e = new Date(endDate + 'T00:00:00');
      return Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)));
    } catch { return 0; }
  }, [startDate, endDate]);
  const [checkIn, setCheckIn] = useState('14:00');
  const [checkOut, setCheckOut] = useState('11:00');

  const canNext = useMemo(() => {
    if (step === 0) return validDate(startDate) && validDate(endDate) && startDate <= endDate;
    if (step === 1) return validTime(inArriveTime) && validTime(outDepartTime) && inMode && outMode && inHubName && outHubName;
    if (step === 2) return lodgingCity && lodgingName && nights >= 1 && validTime(checkIn) && validTime(checkOut);
    return true;
  }, [step, startDate, endDate, inArriveTime, outDepartTime, inMode, outMode, inHubName, outHubName, lodgingCity, lodgingName, nights, checkIn, checkOut]);

  const next = () => {
    if (!canNext) { Alert.alert('Eksik bilgi', 'Devam etmek için bu adımı tamamlayın.'); return; }
    setStep((s) => Math.min(3, s + 1));
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const submit = async () => {
    const tripInit = {
      source: 'scratch',
      dateRange: { start: startDate, end: endDate },
      transport: {
        inbound: { mode: inMode, arriveTime: inArriveTime, hub: { name: inHubName } },
        outbound: { mode: outMode, departTime: outDepartTime, hub: { name: outHubName }, mustArriveBeforeMin: outboundMustArriveBeforeMin(outMode) },
      },
      stays: [{ city: lodgingCity, place: { name: lodgingName }, nights, checkIn, checkOut }],
    };
    const daily = buildInitialDailyPlan(tripInit);
    const created = await createTrip({ ...tripInit, daily });
    nav.navigate('TripEditor', { id: created.id });
  };

  return (
    <View style={styles.container}>
      <Header step={step} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {step === 0 && (
          <Card title="Tarih Aralığı">
            <Field label="Başlangıç (YYYY-MM-DD)"><Input value={startDate} onChangeText={setStartDate} placeholder="2025-10-21" /></Field>
            <Field label="Bitiş (YYYY-MM-DD)"><Input value={endDate} onChangeText={setEndDate} placeholder="2025-10-25" /></Field>
            <Info text="Toplam gece sayısı, konaklama adımında otomatik hesaplanır." />
          </Card>
        )}
        {step === 1 && (
          <>
            <Card title="Geliş Ulaşımı">
              <Field label="Mod (plane/train/bus/car/walk)"><Input value={inMode} onChangeText={setInMode} placeholder="plane" /></Field>
              <Field label="Varış Saati (HH:MM)"><Input value={inArriveTime} onChangeText={setInArriveTime} placeholder="10:30" /></Field>
              <Field label="Varış Noktası (Hub)"><Input value={inHubName} onChangeText={setInHubName} placeholder="IST / Havalimanı" /></Field>
            </Card>
            <Card title="Dönüş Ulaşımı">
              <Field label="Mod (plane/train/bus/car/walk)"><Input value={outMode} onChangeText={setOutMode} placeholder="plane" /></Field>
              <Field label="Kalkış Saati (HH:MM)"><Input value={outDepartTime} onChangeText={setOutDepartTime} placeholder="17:45" /></Field>
              <Field label="Kalkış Noktası (Hub)"><Input value={outHubName} onChangeText={setOutHubName} placeholder="IST / Havalimanı" /></Field>
            </Card>
          </>
        )}
        {step === 2 && (
          <Card title="Konaklama">
            <Field label="Şehir"><Input value={lodgingCity} onChangeText={setLodgingCity} placeholder="İstanbul" /></Field>
            <Field label="Konaklama (Otel/Adres)"><Input value={lodgingName} onChangeText={setLodgingName} placeholder="Otel / Adres" /></Field>
            <Field label="Toplam Gece"><Input value={String(nights)} editable={false} /></Field>
            <Field label="Check-in Saati (HH:MM)"><Input value={checkIn} onChangeText={setCheckIn} placeholder="14:00" /></Field>
            <Field label="Check-out Saati (HH:MM)"><Input value={checkOut} onChangeText={setCheckOut} placeholder="11:00" /></Field>
          </Card>
        )}
        {step === 3 && (
          <Card title="Önizleme">
            <Text style={styles.preview}>
              {startDate} → {endDate}{'\n'}
              Geliş: {inMode}, {inArriveTime}, {inHubName}{'\n'}
              Dönüş: {outMode}, {outDepartTime}, {outHubName}{'\n'}
              Konaklama: {lodgingCity}, {lodgingName} • {nights} gece (CI {checkIn} / CO {checkOut})
            </Text>
            <Info text="Oluşturduktan sonra TripEditor içinden günlere duraklar ekleyebilir, saatleri ve blokları düzenleyebilirsin." />
          </Card>
        )}
      </ScrollView>

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

function Header({ step }) {
  const titles = ['Tarihler', 'Ulaşım', 'Konaklama', 'Önizleme'];
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Start from Scratch</Text>
      <Text style={styles.headerStep}>{titles[step]} ({step + 1}/4)</Text>
    </View>
  );
}
function Card({ title, children }) { return (<View style={styles.card}><Text style={styles.cardTitle}>{title}</Text><View style={{ gap: 10 }}>{children}</View></View>); }
function Field({ label, children }) { return (<View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text>{children}</View>); }
function Input(props) { return (<TextInput {...props} style={[styles.input, props.editable === false && { backgroundColor: '#16181F', color: '#A8A8B3' }]} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#6B7280" />); }
function Info({ text }) { return <Text style={styles.info}>{text}</Text>; }

function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validTime(s) { return /^\d{2}:\d{2}$/.test(s); }

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
  info: { color: '#A8A8B3', marginTop: 6 },

  footer: { flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: 1, borderColor: BORDER },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 12 },
  ghostText: { color: BTN, fontWeight: '700' },

  secondaryBtn: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderColor: BORDER, borderWidth: 1 },
  secondaryText: { color: '#fff', fontWeight: '700' },

  primaryBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: BTN },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
