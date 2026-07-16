import { useMemo } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';

interface PlanHeaderProps {
  greeting: string;
  headerWeather: string;
  isDark: boolean;
  colors: any;
}

function getWeatherAnimation(condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm'): any {
  const h = new Date().getHours();
  if (condition === 'storm' || condition === 'heavy_rain') return require('../assets/lottie/storm.json');
  if (condition === 'rain') return require('../assets/lottie/rain.json');
  if (h >= 5 && h < 8) return require('../assets/lottie/sunrise.json');
  if (h >= 8 && h < 18) return require('../assets/lottie/sunny.json');
  return require('../assets/lottie/night.json');
}

export default function PlanHeader({ greeting, headerWeather, isDark, colors }: PlanHeaderProps) {
  const styles = useMemo(() => StyleSheet.create({
    header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, position: 'relative', overflow: 'hidden' },
    headerBgImage: { position: 'absolute', top: 58, right: -20, width: 160, height: 130 },
    headerLottie: { position: 'absolute', top: 60, right: 80, width: 65, height: 65, opacity: 0.65 },
    logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
    logo: { width: 44, height: 44, borderRadius: 10 },
    logoText: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: colors.textPrimary },
    greeting: { fontFamily: 'Poppins_700Bold', fontSize: 21, color: colors.textPrimary },
    greetingSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  }), [colors]);

  return (
    <View style={styles.header}>
      <Image source={require('../assets/main_bg.png')} style={styles.headerBgImage} resizeMode="contain" />
      <LottieView
        source={getWeatherAnimation(headerWeather as 'clear' | 'rain' | 'heavy_rain' | 'storm' | undefined)}
        autoPlay
        loop
        style={styles.headerLottie}
      />
      <View style={styles.logoRow}>
        <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.logoText}>Airylio</Text>
      </View>
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={styles.greetingSub}>Where are you headed?</Text>
    </View>
  );
}
