// trips/screens/CreateScratchTripScreen.js
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { createTripLocal } from '../../app/lib/tripsLocal';
import { savePlan } from '../shared/plansRepo';

const BTN = '#2563EB';
const BORDER = '#23262F';

export default function CreateScratchTripScreen({ navigation }) {
  const [title, setTitle] = useState('');

  async function create() {
    const t = (title || '').trim();
    if (t.length < 2) {
      Alert.alert('İsim', 'Lütfen en az 2 karakter girin.');
      return;
    }

    // 1) Trip oluştur (draft)
    const trip = await createTripLocal({
      title: t,
      status: 'draft',
      cities: [],
      dateRange: { start: null, end: null },
      wizardStep: null,
      creationMode: 'scratch', // 🔹 akış kaynağı
      updatedAt: new Date().toISOString(),
    });

    // 2) Boş plan oluştur ve iliştir
    const plan = {
      _id: `plan_${trip._id}`,
      id: `plan_${trip._id}`,
      tripId: trip._id,
      source: 'scratch', // 🔹 plan kaynağı
      days: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await savePlan(plan);

    // 3) Plan ekranına git
    navigation.reset({
      index: 1,
      routes: [
        { name: 'TripsHome' },
        { name: 'TripPlans', params: { tripId: trip._id } },
      ],
    });
  }

  return (
    <View style={S.container}>
      <Text style={S.title}>Yeni Gezi (Start From Scratch)</Text>
      <TextInput
        style={S.input}
        placeholder="Gezi adı"
        placeholderTextColor="#6B7280"
        value={title}
        onChangeText={setTitle}
        autoCapitalize="sentences"
      />
      <TouchableOpacity onPress={create} style={S.btn}>
        <Text style={S.btnText}>Oluştur</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101014', padding: 16, justifyContent: 'center' },
  title: { color: '#fff', fontWeight: '800', fontSize: 18, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 12, color: '#fff', marginBottom: 10, backgroundColor: '#0D0F14' },
  btn: { backgroundColor: BTN, padding: 12, borderRadius: 10, alignSelf: 'flex-start' },
  btnText: { color: '#fff', fontWeight: '800' },
});
