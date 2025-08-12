// src/homePage/HomePage.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MiniMapCard from './MiniMapCard';
import RoutePlannerCard from './RoutePlannerCard';

export default function HomePage() {
  const navigation = useNavigation();

  const goExplore = () => {
    navigation.navigate('Map', { entryPoint: 'home-preview' });
  };

  return (
    <View style={styles.container}>
      {/* Üst kısım: mini map */}
      <MiniMapCard onExpand={goExplore} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Bugün için ilham</Text>

        <View style={styles.cardRow}>
          <TouchableOpacity style={styles.card} onPress={goExplore}>
            <Text style={styles.cardTitle}>Yakınımda Keşfet</Text>
            <Text style={styles.cardDesc}>Kafeler, restoranlar, müzeler…</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.card} onPress={goExplore}>
            <Text style={styles.cardTitle}>Kategori Seç</Text>
            <Text style={styles.cardDesc}>“Kafe” ile başla →</Text>
          </TouchableOpacity>
        </View>

        {/* 👇 Yeni Rota Planlama kartı */}
        <RoutePlannerCard />
      </ScrollView>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
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
