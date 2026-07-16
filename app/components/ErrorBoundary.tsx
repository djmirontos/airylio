import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>Please restart the app.</Text>
          <Pressable style={styles.button} onPress={() => this.setState({ hasError: false })}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#FAFAFC' },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#1A1A2E', marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6B6F8A', marginBottom: 24, textAlign: 'center' },
  button: { backgroundColor: '#4C4F9E', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
});
