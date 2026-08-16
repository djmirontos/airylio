import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { useFonts, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './navigation/AppNavigator';
import { TripProvider } from './context/TripContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import ErrorBoundary from './components/ErrorBoundary';
import ForceUpdateModal from './components/ForceUpdateModal';
import { useForceUpdate } from './hooks/useForceUpdate';
import { initSentry, Sentry } from './lib/sentry';
import { initPostHog } from './lib/posthog';

// Before anything else, so a crash during setup below is still reported.
initSentry();
initPostHog();

function Root() {
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
    <SafeAreaProvider>
      <ErrorBoundary>
        {/* ThemeProvider sits above NavigationContainer so the navigator's own
            background can be themed - unthemed, it defaults to near-white and
            shows through wherever a screen hasn't painted yet (edges during a
            slide, the strip a hidden tab bar leaves behind). */}
        <ThemeProvider>
          <ThemedNavigation />
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function ThemedNavigation() {
  const { colors: COLORS, isDark } = useTheme();
  const { updateRequired, appConfig } = useForceUpdate();

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
      <ForceUpdateModal
        visible={updateRequired}
        message={appConfig?.update_message ?? 'A new version of Airylio is available.'}
        playStoreUrl={appConfig?.play_store_url ?? 'https://play.google.com/store/apps/details?id=com.daryljm.airylio'}
      />
    </NavigationContainer>
  );
}

// Wraps the component registered in index.ts, so Sentry sees the whole tree.
export default Sentry.wrap(Root);

