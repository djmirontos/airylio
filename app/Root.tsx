import { NavigationContainer } from '@react-navigation/native';
import { useFonts, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { ActivityIndicator, View } from 'react-native';
import AppNavigator from './navigation/AppNavigator';
import { TripProvider } from './context/TripContext';
import { ThemeProvider } from './context/ThemeContext';

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
    <NavigationContainer>
      <ThemeProvider>
        <TripProvider>
          <AppNavigator />
        </TripProvider>
      </ThemeProvider>
    </NavigationContainer>
  );
}

