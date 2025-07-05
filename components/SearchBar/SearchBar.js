// src/components/SearchBar/SearchBar.js
import React, { useState } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { autocomplete } from '../../services/maps';

export default function SearchBar({ onSelect }) {
  const [q, setQ]           = useState('');
  const [suggestions, setS] = useState([]);

  const onChange = async text => {
    setQ(text);
    if (text.length < 2) return setS([]);
    const preds = await autocomplete(text);
    setS(preds);
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Bir yer ara"
        value={q}
        onChangeText={onChange}
      />
      <FlatList
        data={suggestions}
        keyExtractor={i => i.place_id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => {
              setQ(item.description);
              setS([]);
              onSelect(item.place_id, item.description);
            }}
          >
            <Text>{item.description}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { zIndex: 999 },
  input:     { height:50, backgroundColor:'#fff', padding:10, borderRadius:5 },
  item:      { padding:10, borderBottomWidth:1, borderColor:'#eee' },
});
