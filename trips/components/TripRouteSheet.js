// trips/components/TripRouteSheet.js
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getModeSummaries } from '../services/RouteDirectionService';

const C = {
  card: '#FFFFFF',
  border: '#E5E7EB',
  fg: '#111827',
  fg2: '#6B7280',
  primary: '#111827',
  rowBg: '#F8FAFC',
  rowActive: '#EEF2FF',
};

export default function TripRouteSheet({
  visible,
  waypoints,          // [{lat,lng} | {place_id}]
  apiKey,
  onClose,
  onStart,            // (mode) => void
  preferredMode = 'driving',
  legLabel = '',      // opsiyonel: "Durak 2 → Durak 3" gibi
}) {
  const a = useRef(new Animated.Value(0)).current;
  const [summ, setSumm] = useState({ driving: null, walking: null, transit: null });
  const [loading, setLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState(preferredMode);

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 130,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => { setSelectedMode(preferredMode); }, [preferredMode]);

  // Özetleri getir
  useEffect(() => {
    let ok = true;
    if (!visible) return;
    (async () => {
      try {
        setLoading(true);
        const res = await getModeSummaries({ waypoints, apiKey });
        if (ok) setSumm(res);
      } catch {
        if (ok) setSumm({ driving: null, walking: null, transit: null });
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => { ok = false; };
  }, [visible, apiKey, JSON.stringify(waypoints)]);

  if (!visible) return null;
  const t = { transform: [{ translateY: a.interpolate({ inputRange: [0,1], outputRange: [20,0] }) }], opacity: a };

  const anySumm = summ.driving || summ.walking || summ.transit;
  const totalDistanceText =
    summ.driving?.distanceText || summ.walking?.distanceText || summ.transit?.distanceText || '—';

  const Row = ({ icon, label, value, mode, disabled }) => {
    const active = selectedMode === mode;
    return (
      <Pressable
        onPress={() => !disabled && setSelectedMode(mode)}
        style={[
          styles.row,
          active && { backgroundColor: C.rowActive, borderColor: '#C7D2FE' },
          disabled && { opacity: 0.5 }
        ]}
        accessibilityRole="button"
        disabled={disabled}
      >
        <Text style={styles.rowIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowVal}>{value || (disabled ? '—' : (loading ? '...' : '—'))}</Text>
      </Pressable>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={{ position:'absolute', left:0, right:0, bottom:0, alignItems:'center', paddingBottom:10 }}>
        <Animated.View style={[styles.card, t]} pointerEvents="auto">
          <View style={styles.top}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.title}>Rota Özeti</Text>
              {!!legLabel && <Text numberOfLines={1} style={styles.metaMinor}>{legLabel}</Text>}
            </View>
            <Pressable onPress={onClose} style={styles.x} hitSlop={8} accessibilityLabel="Kapat">
              <Ionicons name="close" size={18} color={C.fg} />
            </Pressable>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.meta}>Toplam mesafe: {totalDistanceText}</Text>
            {loading && (
              <View style={{ marginLeft: 8 }}>
                <ActivityIndicator size="small" />
              </View>
            )}
          </View>

          <View style={{ marginTop: 8 }}>
            <Row icon="🚗" label="Arabayla"       mode="driving" disabled={!summ.driving} value={summ.driving?.durationText} />
            <Row icon="🚶" label="Yürüyerek"      mode="walking" disabled={!summ.walking} value={summ.walking?.durationText} />
            <Row icon="🚌" label="Toplu taşımayla" mode="transit" disabled={!summ.transit} value={summ.transit?.durationText} />
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={() => onStart?.(selectedMode)}
              style={[styles.primary, (!anySumm && !loading) && { opacity: 0.6 }]}
              disabled={!anySumm && !loading}
              accessibilityLabel="Rotayı Başlat"
            >
              <Ionicons name="navigate" size={16} color="#fff" style={{ marginRight:6 }} />
              <Text style={{ color:'#fff', fontWeight:'800' }}>
                {selectedMode === 'walking' ? 'Yürüyerek başlat' :
                 selectedMode === 'transit'  ? 'Toplu taşımayla başlat' :
                 'Arabayla başlat'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card:{
    width:'96%', maxWidth:640, backgroundColor:C.card, borderRadius:14,
    padding:12, borderWidth:StyleSheet.hairlineWidth, borderColor:C.border,
    shadowColor:'#000', shadowOpacity:.12, shadowRadius:10, shadowOffset:{ width:0, height:6 }, elevation:8,
  },
  top:{ flexDirection:'row', alignItems:'center' },
  title:{ color:C.fg, fontWeight:'800', fontSize:16 },
  metaMinor:{ color:C.fg2, fontSize:12, marginTop: 2 },

  x:{ width:28, height:28, borderRadius:14, alignItems:'center', justifyContent:'center', backgroundColor:'#F3F4F6' },

  metaRow:{ marginTop:6, flexDirection:'row', alignItems:'center' },
  meta:{ color:C.fg2 },

  row:{
    flexDirection:'row', alignItems:'center',
    paddingVertical:10, paddingHorizontal:10,
    borderRadius:10, backgroundColor:C.rowBg,
    borderWidth:StyleSheet.hairlineWidth, borderColor:'#E5E7EB',
    marginTop:8,
  },
  rowIcon:{ width:22, textAlign:'center', fontSize:16 },
  rowLabel:{ flex:1, marginLeft:8, fontWeight:'700', color:C.fg },
  rowVal:{ color:C.fg2, fontWeight:'700' },

  actions:{ marginTop:12, alignItems:'flex-end' },
  primary:{ backgroundColor:C.primary, paddingHorizontal:14, paddingVertical:10, borderRadius:10, flexDirection:'row', alignItems:'center' },
});
