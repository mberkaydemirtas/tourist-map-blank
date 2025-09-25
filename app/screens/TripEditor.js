// app/screens/TripEditor.js
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView } from "react-native";
import { getTripLocal, saveTripLocal } from "../lib/tripsLocal";
import { getDeviceId } from "../services/device";
import { syncTrips } from "../services/tripsSync";
import { useNavigation, useRoute } from "@react-navigation/native";

export default function TripEditor() {
  const nav = useNavigation();
  const route = useRoute();
  const { id } = route.params || {};

  const [trip, setTrip] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await getTripLocal(id);
      setTrip(t);
    })();
  }, [id]);

  const update = (patch) => setTrip(prev => ({ ...prev, ...patch }));

  const saveAndSync = async () => {
    try {
      setBusy(true);
      const saved = await saveTripLocal(trip);
      const deviceId = await getDeviceId();
      await syncTrips({ deviceId }).catch(()=>{});
      setTrip(saved);
      Alert.alert("Saved", "Trip saved & synced.");
    } finally {
      setBusy(false);
    }
  };

  if (!trip) return <View style={{flex:1}} />;

  return (
    <ScrollView style={{ flex:1, backgroundColor:"#fff" }} contentContainerStyle={{ padding:16 }}>
      <Text style={{ fontWeight:"700", fontSize:18 }}>Trip Title</Text>
      <TextInput
        value={trip.title || ""}
        onChangeText={(t)=>update({ title: t })}
        placeholder="e.g., Ankara & Cappadocia"
        style={{ marginTop:8, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, paddingHorizontal:12, paddingVertical:10 }}
      />

      <Text style={{ fontWeight:"700", fontSize:18, marginTop:16 }}>Cities (comma separated)</Text>
      <TextInput
        value={(trip.cities || []).join(", ")}
        onChangeText={(t)=>update({ cities: t.split(",").map(s=>s.trim()).filter(Boolean) })}
        placeholder="Ankara, Nevşehir"
        style={{ marginTop:8, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, paddingHorizontal:12, paddingVertical:10 }}
      />

      <Text style={{ fontWeight:"700", fontSize:18, marginTop:16 }}>Dates</Text>
      <View style={{ flexDirection:"row", gap:8, marginTop:8 }}>
        <TextInput
          value={trip?.dateRange?.start || ""}
          onChangeText={(t)=>update({ dateRange: { ...(trip.dateRange||{}), start: t } })}
          placeholder="YYYY-MM-DD"
          style={{ flex:1, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, paddingHorizontal:12, paddingVertical:10 }}
        />
        <TextInput
          value={trip?.dateRange?.end || ""}
          onChangeText={(t)=>update({ dateRange: { ...(trip.dateRange||{}), end: t } })}
          placeholder="YYYY-MM-DD"
          style={{ flex:1, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, paddingHorizontal:12, paddingVertical:10 }}
        />
      </View>

      <View style={{ flexDirection:"row", justifyContent:"space-between", marginTop:20 }}>
        <TouchableOpacity
          onPress={() => nav.navigate("TripPlacesScreen", { id: trip._id })}
          style={{ backgroundColor:"#111827", paddingHorizontal:14, paddingVertical:12, borderRadius:12 }}
        >
          <Text style={{ color:"#fff", fontWeight:"700" }}>Select Places</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={saveAndSync}
          disabled={busy}
          style={{ backgroundColor: busy ? "#9CA3AF" : "#16A34A", paddingHorizontal:14, paddingVertical:12, borderRadius:12 }}
        >
          <Text style={{ color:"#fff", fontWeight:"700" }}>{busy ? "Saving..." : "Save & Sync"}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
