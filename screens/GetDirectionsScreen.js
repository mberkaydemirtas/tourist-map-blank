import React, { useState, useRef, useEffect } from 'react';
import { SafeAreaView, TextInput, StyleSheet, Button } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function GetDirectionsScreen() {
  const [fromQuery, setFromQuery] = useState('');
  const inputRef = useRef(null);
  const navigation = useNavigation();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sahte hedef marker (gerçek kullanımda autocomplete ile alınacak)
  const dummyToMarker = {
    name: 'Gideceğiniz Yer',
    coordinate: {
      latitude: 39.92077,
      longitude: 32.85411,
    },
  };

  const handleContinue = () => {
    const fromSource = {
      key: 'current',
      description: 'Konumunuz',
      coords: {
        latitude: 39.925,
        longitude: 32.865,
      },
    };
    navigation.navigate('RouteScreen', {
      fromSource,
      toMarker: dummyToMarker,
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder="Nereden"
        placeholderTextColor="#888"
        value={fromQuery}
        onChangeText={setFromQuery}
      />
      <Button title="Devam Et" onPress={handleContinue} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'center',
    padding: 16,
  },
  input: {
    height: 50,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 12,
  },
});
