import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { useFonts, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import AppNavigator from './navigation/AppNavigator';
import { TripProvider } from './context/TripContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';

// Suppress non-critical RN text rendering warnings in dev mode
const originalWarn = console.error.bind(console.error);
console.error = (msg: any, ...args: any[]) => {
  if (typeof msg === 'string' && msg.includes('Text strings must be rendered')) return;
  originalWarn(msg, ...args);
};

export default function Root() {
  const [fontsLoaded] = useFonts({
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFC' }}>
        <ActivityIndicator color="#4C4F9E" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      {/* ThemeProvider sits above NavigationContainer so the navigator's own
          background can be themed - unthemed, it defaults to near-white and
          shows through wherever a screen hasn't painted yet (edges during a
          slide, the strip a hidden tab bar leaves behind). */}
      <ThemeProvider>
        <ThemedNavigation />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function ThemedNavigation() {
  const { colors: COLORS, isDark } = useTheme();

  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        background: COLORS.canvas,
        card: COLORS.card,
        text: COLORS.textPrimary,
        border: COLORS.divider,
        primary: COLORS.accent,
      },
    };
  }, [COLORS, isDark]);

  return (
    <NavigationContainer theme={navTheme}>
      <TripProvider>
        <AppNavigator />
      </TripProvider>
    </NavigationContainer>
  );
}

