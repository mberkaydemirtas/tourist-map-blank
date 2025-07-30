import React from 'react';
import { Modal, View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';

export default function StepInstructionsModal({ visible, onClose, steps }) {
  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <Text style={styles.title}>Adım Adım Yol Tarifi</Text>
        <FlatList
          data={steps}
          keyExtractor={(_, index) => index.toString()}
          renderItem={({ item, index }) => (
            <Text style={styles.step}>
              {index + 1}. {item.maneuver.instruction} ({Math.round(item.distance)} m)
            </Text>
          )}
        />
        <TouchableOpacity onPress={onClose} style={styles.button}>
          <Text style={styles.buttonText}>Kapat</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 50 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  step: { fontSize: 16, marginVertical: 6 },
  button: { marginTop: 20, backgroundColor: '#000', padding: 12, borderRadius: 8 },
  buttonText: { color: '#fff', textAlign: 'center' },
});
