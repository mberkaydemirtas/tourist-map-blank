import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MiniMapCard from './MiniMapCard';
import RoutePlannerCard from './RoutePlannerCard';

function HeaderBlock({ onExplore }) {
  return (
    <View style={styles.headerWrap}>
      {/* Mini harita artık header içinde; sayfa yukarı kayınca görünmez olur */}
      <MiniMapCard onExpand={onExplore} />

      <Text style={styles.sectionTitle}>Bugün için ilham</Text>

      <View style={styles.cardRow}>
        <TouchableOpacity style={styles.card} onPress={onExplore}>
          <Text style={styles.cardTitle}>Yakınımda Keşfet</Text>
          <Text style={styles.cardDesc}>Kafeler, restoranlar, müzeler…</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={onExplore}>
          <Text style={styles.cardTitle}>Kategori Seç</Text>
          <Text style={styles.cardDesc}>“Kafe” ile başla →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function HomePage() {
  const navigation = useNavigation();
  const goExplore = () => navigation.navigate('Map', { entryPoint: 'home-preview' });

  // Dış kapsayıcı artık FlatList → içteki DraggableFlatList/FlatList ile çakışma yok
  return (
    <View style={styles.container}>
      <FlatList
        data={[{ key: 'route-planner' }]}
        keyExtractor={(it) => it.key}
        renderItem={() => <RoutePlannerCard />}
        ListHeaderComponent={<HeaderBlock onExplore={goExplore} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const PADDING = 16;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#101014',
  },
  content: {
    padding: PADDING,
    paddingBottom: PADDING * 2,
  },
  headerWrap: {
    // Header’ın kendi iç boşlukları
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginTop: 12,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  card: {
    flex: 1,
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#23262F',
  },
  cardTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardDesc: {
    color: '#A8A8B3',
    fontSize: 13,
  },
});
