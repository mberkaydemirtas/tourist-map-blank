// components/SearchBar.js
import React, { useEffect, useState } from 'react';
import { View, TextInput, FlatList, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { autocomplete } from '../services/maps';

export default function SearchBar({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    let active = true;
    const fetch = async () => {
      if (value.length < 2) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const preds = await autocomplete(value);
        if (active) setSuggestions(preds);
      } catch {
        if (active) setSuggestions([]);
      }
    };
    fetch();
    return () => { active = false; };
  }, [value]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Bir yer ara"
        value={value}
        onChangeText={onChange}
      />
      <FlatList
        data={suggestions}
        keyExtractor={item => item.place_id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => onSelect(item.place_id, item.description)}
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