import React, { useMemo } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  backdrop: { position:'absolute', inset:0, backgroundColor:'rgba(0,0,0,0.35)' },
  card: { position:'absolute', left:16, right:16, top:'15%', bottom:'15%', borderRadius:16, backgroundColor:'#0D0F14', borderWidth:1, borderColor:'#23262F' },
  header: { padding:12, borderBottomWidth:1, borderColor:'#23262F' },
  input: { backgroundColor:'#0F1219', borderWidth:1, borderColor:'#23262F', borderRadius:10, paddingHorizontal:12, paddingVertical:10, color:'#fff' },
  row: { paddingVertical:12, paddingHorizontal:12 },
  name: { color:'#fff', fontSize:15 },
  meta: { color:'#9AA0A6', fontSize:12, marginTop:4 },
  sep: { height:1, backgroundColor:'#23262F' },
  title: { color:'#fff', fontSize:16, fontWeight:'700', marginBottom:8 },
});

export default function TypeaheadDropdown({
  visible,
  title = 'Seç',
  query, onQueryChange,
  items,                      // array
  getKey = (x)=>x.id || x.place_id || x.code,
  getLabel = (x)=>x.name,
  getMeta,                    // optional
  onClose,
  onSelect,
}) {
  const scored = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return items || [];
    const norm = s => (s || '').toString().toLowerCase();
    return (items || [])
      .map(it => {
        const name = norm(getLabel(it));
        let score = 0;
        if (name.startsWith(q)) score += 100;      // başlayanlar
        if (name.includes(q))   score += 20;       // içerenler
        return { it, score };
      })
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .map(x => x.it);
  }, [items, query, getLabel]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.backdrop} />
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Ara yaz..."
            placeholderTextColor="#6B7280"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <FlatList
          data={query ? scored : (items || [])}
          keyExtractor={(it) => String(getKey(it))}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => onSelect(item)}>
              <Text style={styles.name}>{getLabel(item)}</Text>
              {!!getMeta?.(item) && <Text style={styles.meta}>{getMeta(item)}</Text>}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}
