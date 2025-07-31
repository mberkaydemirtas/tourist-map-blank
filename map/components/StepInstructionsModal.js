import React from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';

export default function StepInstructionsModal({ visible, onClose, steps }) {
  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.modalContainer}>
          <Text style={styles.title}>🧭 Adım Adım Yol Tarifi</Text>
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
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    maxHeight: '80%',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  step: {
    fontSize: 15,
    marginVertical: 6,
    lineHeight: 22,
  },
  button: {
    marginTop: 20,
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 10,
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});
