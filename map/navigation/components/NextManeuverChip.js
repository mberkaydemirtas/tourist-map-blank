// components/NextManeuverChip.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ManeuverIcon from '../../components/ManeuverIcon';

export default function NextManeuverChip({ step, distance }) {
  if (!step) return null;
  const m = step.maneuver || {};
  const type = (m.type || '').toLowerCase();
  const mod  = (m.modifier || '').toLowerCase();

  const toType = () => {
    if (type === 'roundabout' || type === 'rotary') return 'roundabout';
    if (type === 'merge') return mod.includes('right') ? 'merge_right' : 'merge_left';
    if (type === 'fork')  return mod.includes('right') ? 'fork_right'  : 'fork_left';
    if (type === 'uturn') return mod.includes('right') ? 'uturn_right' : 'uturn_left';
    return (mod || 'straight');
  };

  const text = (() => {
    if (type === 'roundabout') return m.exit ? `${m.exit}. çıkışı tercih edin` : 'Döner kavşağı takip edin';
    if (type === 'fork')  return mod.includes('right') ? 'Sağ kola geçin' : 'Sol kola geçin';
    if (type === 'merge') return mod.includes('right') ? 'Sağdan katılın' : 'Soldan katılın';
    const map = {
      left:'Sola dönün', right:'Sağa dönün',
      slight_left:'Hafif sola', slight_right:'Hafif sağa',
      sharp_left:'Keskin sola', sharp_right:'Keskin sağa',
      straight:'Düz devam'
    };
    return map[mod] || 'İlerleyin';
  })();

  const dStr = distance == null ? null
    : distance >= 1000 ? `${(distance/1000).toFixed(distance>=2000?0:1)} km`
    : `${Math.max(1,Math.round(distance))} m`;

  return (
    <View style={s.wrap}>
      <Text style={s.then}>Sonra</Text>
      <ManeuverIcon type={toType()} size={20} />
      <Text style={s.txt}>{text}{dStr ? ` • ${dStr}` : ''}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:{ flexDirection:'row', alignItems:'center', alignSelf:'flex-start',
    backgroundColor:'#F5F5F5', borderRadius:10, paddingVertical:6, paddingHorizontal:10,
    marginTop:6, borderWidth:1, borderColor:'#E0E0E0' },
  then:{ fontSize:12, fontWeight:'700', color:'#616161', marginRight:6 },
  txt:{ fontSize:13, fontWeight:'600', color:'#212121', marginLeft:6 },
});
