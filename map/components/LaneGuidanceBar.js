// components/LaneGuidanceBar.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ManeuverIcon from './ManeuverIcon';

/**
 * Props:
 *  - step: Mapbox/Google step object
 *  - style: container style override
 *  - distance?: number (metre) -> metnin hemen yanında gösterilir
 */
export default function LaneGuidanceBar({ step, style, distance, iconsOnly = false }) {
  const { lanesRaw, lanesDerived, maneuver, isRoundabout, exitNumber } = useMemo(() => {
    const ints = Array.isArray(step?.intersections) ? step.intersections : [];
    const withLanes = ints.find(i => Array.isArray(i.lanes) && i.lanes.length) || ints[ints.length - 1];
    const lanesRaw = withLanes?.lanes || null;
    const maneuver = step?.maneuver || null;
    const isRoundabout = !!maneuver && (maneuver.type === 'roundabout' || maneuver.type === 'rotary');
    const exitNumber = getExitNumber(step);
    const lanesDerived = !lanesRaw || lanesRaw.length === 0 ? deriveVirtualLanes(maneuver) : null;
    return { lanesRaw, lanesDerived, maneuver, isRoundabout, exitNumber };
  }, [step]);

  if (!step) return null;

   if (iconsOnly) {
    if (isRoundabout) {
      return (
        <View style={[styles.container, style]}>
          <View style={styles.row}>
            <ManeuverIcon type="roundabout" exitNumber={exitNumber} size={24} active />
          </View>
        </View>
      );
    }
    const lanes = (lanesRaw && lanesRaw.length) ? normalizeLanes(lanesRaw) : (lanesDerived || null);
    if (Array.isArray(lanes) && lanes.length) {
      const groups = compressLanes(lanes);
      return (
        <View style={[styles.container, style]}>
          <View style={styles.row}>
            {groups.map((g, idx) => (
              <View key={idx} style={[styles.lane, g.active ? styles.laneActive : styles.laneInactive]}>
                <ManeuverIcon type={g.type} size={22} active={g.active} />
                {g.count > 1 && <CountBadge count={g.count} />}
              </View>
            ))}
          </View>
        </View>
      );
    }
        // fallback: tek ikon
    const fallbackType = maneuverToType(maneuver);
    return (
      <View style={[styles.container, style]}>
        <View style={styles.row}>
          <ManeuverIcon type={fallbackType} size={24} active />
        </View>
      </View>
    );
  }

  // Roundabout: büyük ikon + çıkış numarası
  if (isRoundabout) {
    return (
      <View style={[styles.container, style]}>
         <View style={styles.rowCenter}>
   <View style={styles.chip}>
     <ManeuverIcon type="roundabout" exitNumber={exitNumber} size={28} active />
     <Text style={styles.chipText}>
       {exitNumber ? `${exitNumber}. çıkışı tercih edin` : 'Döner kavşağı takip edin'}
       {distance != null ? ` • ${metersFmt(distance)}` : ''}
     </Text>
   </View>
 </View>
      </View>
    );
  }

  // Lanes: gerçek şeritler var ise onları kullan; yoksa sanal şeritler
  const lanes = (lanesRaw && lanesRaw.length) ? normalizeLanes(lanesRaw) : (lanesDerived || null);

  if (Array.isArray(lanes) && lanes.length) {
    const groups = compressLanes(lanes);
      return (
     <View style={[styles.container, style]}>
       <View style={styles.rowCenter}>
         <View style={styles.row}>
           {groups.map((g, idx) => (
             <View key={idx} style={[styles.lane, g.active ? styles.laneActive : styles.laneInactive]}>
               <ManeuverIcon type={g.type} size={22} active={g.active} />
               {g.count > 1 && <CountBadge count={g.count} />}
             </View>
           ))}
           {distance != null && <Text style={styles.inlineDist}> • {metersFmt(distance)}</Text>}
         </View>
       </View>
     </View>
   );
  }
  // Fallback: tek ikon + kısa metin
  const fallbackType = maneuverToType(maneuver);
     return (
     <View style={[styles.container, style]}>
       <View style={styles.rowCenter}>
         <View style={styles.chip}>
           <ManeuverIcon type={fallbackType} size={28} active />
           <Text style={styles.chipText}>
             {readableInstruction(maneuver)}{distance != null ? ` • ${metersFmt(distance)}` : ''}
           </Text>
         </View>
       </View>
     </View>
   );
  }

/* ---------- Yardımcılar ---------- */

function metersFmt(m) {
  if (m == null || Number.isNaN(m)) return '';
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 2000 ? 0 : 1)} km`;
  if (m >= 100) return `${Math.round(m / 10) * 10} m`;
  return `${Math.max(1, Math.round(m))} m`;
}

function DistancePill({ meters }) {
  return (
    <View style={styles.distPill}>
      <Text style={styles.distText}>{metersFmt(meters)}</Text>
    </View>
  );
}

function CountBadge({ count }) {
  return (
    <View style={styles.countBadge}><Text style={styles.countText}>×{count}</Text></View>
  );
}

// Şerit objesini normalize et -> { type, active }
function normalizeLanes(lanes) {
  return lanes.map(lane => {
    const t = pickPrimaryIndication(lane.indications);
    const type = indicationToType(t);
    const active = lane.active === true || lane.valid === true;
    return { type, active };
  });
}

// Ardışık aynı tip/aktif şeritleri tek kutuda grupla (×n)
function compressLanes(lanes) {
  const out = [];
  for (let i = 0; i < lanes.length; i++) {
    const cur = lanes[i];
    if (!out.length) { out.push({ ...cur, count: 1 }); continue; }
    const last = out[out.length - 1];
    if (last.type === cur.type && last.active === cur.active) {
      last.count += 1;
    } else {
      out.push({ ...cur, count: 1 });
    }
  }
  return out;
}

// Şerit verisi yoksa manevradan “sanal” şerit seti üret
function deriveVirtualLanes(m) {
  if (!m) return null;
  const type = (m.type || '').toLowerCase();
  const mod  = (m.modifier || '').toLowerCase();

  // İki kola ayrılma (fork): 2 şerit, hedef kol "active"
  if (type === 'fork') {
    const right = mod.includes('right');
    return right
      ? [{ type:'left', active:false }, { type:'right', active:true }]
      : [{ type:'left', active:true },  { type:'right', active:false }];
  }
  // Katılım (merge): 2 şerit, ana akıma karışılan yön "active"
  if (type === 'merge') {
    const right = mod.includes('right');
    return right
      ? [{ type:'straight', active:true }, { type:'merge_right', active:true }]
      : [{ type:'merge_left', active:true }, { type:'straight', active:true }];
  }
  // Rampa (on/off ramp) -> mod yönüne vurgu
  if (type === 'on_ramp' || type === 'off_ramp') {
    const right = mod.includes('right');
    return right
      ? [{ type:'straight', active:false }, { type:'right', active:true }]
      : [{ type:'left', active:true }, { type:'straight', active:false }];
  }
  // Turn’lerde sanal şerit üretmeyelim; tek ikon yeterli
  return null;
}

function pickPrimaryIndication(indications) {
  if (!Array.isArray(indications) || indications.length === 0) return 'straight';
  const norm = indications.map(normalizeInd);
  if (norm.includes('straight')) return 'straight';
  const pref = ['left','right','slight_left','slight_right','sharp_left','sharp_right','uturn_left','uturn_right','merge_left','merge_right','fork_left','fork_right'];
  return pref.find(p => norm.includes(p)) || norm[0];
}

function normalizeInd(s) {
  if (!s) return 'straight';
  return s.toLowerCase().replace(/\s+/g, '_');
}

function indicationToType(ind) {
  const i = normalizeInd(ind);
  if (i === 'uturn') return 'uturn_left';
  return i;
}

function maneuverToType(m) {
  if (!m) return 'straight';
  const type = (m.type || '').toLowerCase();
  const mod  = normalizeInd(m.modifier || 'straight');
  if (type === 'merge') return `merge_${mod.includes('right') ? 'right' : 'left'}`;
  if (type === 'fork')  return `fork_${mod.includes('right') ? 'right' : 'left'}`;
  if (type === 'roundabout' || type === 'rotary') return 'roundabout';
  if (type === 'uturn') return `uturn_${mod.includes('right') ? 'right' : 'left'}`;
  if (type === 'on_ramp' || type === 'off_ramp') return mod.includes('right') ? 'right' : 'left';
  if (type === 'turn' || type === 'end_of_road' || type === 'continue') return mod || 'straight';
  return 'straight';
}

function readableInstruction(m) {
  if (!m) return 'Düz devam edin';
  const mod = normalizeInd(m.modifier || '');
  const dict = {
    left: 'Sola dönün',
    right: 'Sağa dönün',
    slight_left: 'Hafif sola',
    slight_right: 'Hafif sağa',
    sharp_left: 'Keskin sola',
    sharp_right: 'Keskin sağa',
    straight: 'Düz devam edin',
  };
  if ((m.type === 'merge')) return (mod.includes('right') ? 'Sağdan katılın' : 'Soldan katılın');
  if ((m.type === 'fork'))  return (mod.includes('right') ? 'Sağ kola geçin' : 'Sol kola geçin');
  if ((m.type === 'roundabout' || m.type === 'rotary')) return 'Döner kavşağı takip edin';
  if ((m.type === 'uturn')) return (mod.includes('right') ? 'Sağ U dönüşü' : 'Sol U dönüşü');
  return dict[mod] || 'Devam edin';
}

// Döner kavşak çıkış numarası: m.exit varsa onu, yoksa talimat metninden tahmin et
function getExitNumber(step) {
  const m = step?.maneuver || {};
  if (m.exit != null) {
    const n = Number(m.exit);
    return Number.isFinite(n) ? n : undefined;
  }
  const txt = (m.instruction || step?.instruction || '') + '';
  const hit = txt.match(/\b(\d+)\b/);
  if (hit) {
    const n = Number(hit[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  }
  return undefined;
}

/* ---------- Stil ---------- */

const styles = StyleSheet.create({
  container: { paddingHorizontal: 12, paddingTop: 8 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },

  lane: {
    minWidth: 40, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8, borderWidth: 1, position: 'relative',
  },
  laneActive: { backgroundColor: '#E3F2FD', borderColor: '#1976D2' },
  laneInactive:{ backgroundColor: '#F5F5F5', borderColor: '#BDBDBD' },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F5F5', paddingHorizontal: 12, height: 40,
    borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', alignSelf: 'center',
  },
  chipText: { fontSize: 14.5, fontWeight: '600', color: '#212121' },

  inlineDist: { fontSize: 13, fontWeight: '700', color: '#1565C0', marginLeft: 6 },
  countBadge: {
    position: 'absolute', right: -4, top: -6,
    backgroundColor: '#1976D2', borderRadius: 9, paddingHorizontal:6, height:18,
    alignItems:'center', justifyContent:'center'
  },
  countText: { fontSize: 11, fontWeight: '700', color: 'white' },
});
