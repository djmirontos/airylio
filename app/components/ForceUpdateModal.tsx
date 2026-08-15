import { View, Text, Pressable, Modal, Image, StyleSheet, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  message: string;
  playStoreUrl: string;
}

// Hardcoded: this modal can show before ThemeProvider has loaded a theme, so
// it cannot depend on useTheme's colors.
const NAVY = '#12153D';
const ACCENT = '#4C4F9E';

export default function ForceUpdateModal({ visible, message, playStoreUrl }: Props) {
  const insets = useSafeAreaInsets();

  function handleUpdate() {
    Linking.openURL(playStoreUrl).catch((err) => {
      console.warn('[ForceUpdateModal] Could not open Play Store:', err?.message ?? err);
    });
  }

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="fade"
      onRequestClose={() => {}}
    >
      <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.rocket}>{'\u{1F680}'}</Text>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.message}>{message}</Text>
        <Pressable
          style={styles.button}
          onPress={handleUpdate}
          accessibilityLabel="Update Now"
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Update Now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 16,
    marginBottom: 24,
  },
  rocket: {
    fontSize: 56,
    marginBottom: 16,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    width: '100%',
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
});
