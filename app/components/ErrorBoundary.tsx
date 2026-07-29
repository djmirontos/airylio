import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_COLORS, DARK_COLORS } from '../context/ThemeContext';
import { THEME_KEY } from '../constants/config';

interface State {
  hasError: boolean;
  error?: Error;
  isDark: boolean;
}

/**
 * Catches render errors anywhere below it.
 *
 * This sits above ThemeProvider - it has to, so it can still render if the
 * provider itself throws - which means it cannot use useTheme. It reads the
 * persisted preference directly instead. Without that it painted a white
 * screen in dark mode, which is jarring precisely when something has already
 * gone wrong.
 */
export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, isDark: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  async componentDidMount() {
    try {
      const stored = await AsyncStorage.getItem(THEME_KEY);
      if (stored === 'true') this.setState({ isDark: true });
    } catch {
      // Falls back to light; not worth surfacing.
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const COLORS = this.state.isDark ? DARK_COLORS : LIGHT_COLORS;
      return (
        <View style={[styles.container, { backgroundColor: COLORS.canvas }]}>
          <Text style={[styles.title, { color: COLORS.textPrimary }]}>Something went wrong</Text>
          <Text style={[styles.subtitle, { color: COLORS.textSecondary }]}>Please restart the app.</Text>
          <Pressable
            style={[styles.button, { backgroundColor: COLORS.accent }]}
            onPress={() => this.setState({ hasError: false })}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 20, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, marginBottom: 24, textAlign: 'center' },
  button: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16, minHeight: 44, justifyContent: 'center' },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
});
