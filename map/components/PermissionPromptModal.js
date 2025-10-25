// components/PermissionPromptModal.js
import React, { useEffect, useRef } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, Animated, Easing,
} from 'react-native';

// Uygulamandaki renk paletine benzer bir palet
const C = {
  card: '#FFFFFF',
  fg: '#111827',
  fg2: '#6B7280',
  primary: '#111827',
  secondaryBg: '#F3F4F6',
  backdrop: 'rgba(0, 0, 0, 0.5)',
};

export default function PermissionPromptModal({
  visible,
  title,
  message,
  actions = [],
  onDismiss,
}) {
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(a, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 150,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible]);

  const backdropStyle = {
    opacity: a,
  };

  const cardStyle = {
    opacity: a,
    transform: [
      {
        scale: a.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1],
        }),
      },
    ],
  };

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={onDismiss}
      animationType="none"
    >
      <View style={styles.container}>
        {/* Arka plan */}
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />

        {/* İçerik Kartı */}
        <Animated.View style={[styles.card, cardStyle]} pointerEvents="auto">
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.actionsContainer}>
            {actions.map((btn, index) => {
              const isPrimary = btn.style === 'primary';
              return (
                <Pressable
                  key={index}
                  onPress={btn.onPress}
                  style={[
                    styles.button,
                    isPrimary ? styles.primaryButton : styles.secondaryButton,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isPrimary ? styles.primaryText : styles.secondaryText,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.backdrop,
  },
  card: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: C.fg,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: C.fg2,
    lineHeight: 22,
    marginBottom: 24,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10, // Butonlar arası boşluk
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: C.primary,
  },
  secondaryButton: {
    backgroundColor: C.secondaryBg,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: C.fg,
  },
});