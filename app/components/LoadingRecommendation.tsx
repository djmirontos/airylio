import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const STATUS_MESSAGES = [
  'Checking live traffic...',
  'Analyzing road conditions...',
  'Comparing travel options...',
  'Optimizing your departure time...',
  'Almost ready...',
];

const MESSAGE_INTERVAL_MS = 1800;

function BreathingGlow({
  delay,
  size,
  opacity,
  color,
}: {
  delay: number;
  size: number;
  opacity: number;
  color: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.06,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          delay,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

function RotatingStatusMessage() {
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, MESSAGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <Animated.Text style={[styles.statusMessage, { opacity }]}>
      {STATUS_MESSAGES[index]}
    </Animated.Text>
  );
}

export default function LoadingRecommendation() {
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.root, { opacity: fadeIn }]}>
      {/* Concentric glow, car sits exactly in the center - Apple/HomePod style,
          not a floating icon above the circles */}
      <View style={styles.animationArea}>
        <BreathingGlow delay={0} size={220} opacity={0.05} color="#6D5EF8" />
        <BreathingGlow delay={300} size={150} opacity={0.10} color="#6D5EF8" />
        <View style={styles.coreCircle}>
          <Ionicons name="car" size={30} color="#FFFFFF" />
        </View>
      </View>

      <Text style={styles.title}>
        Calculating{'\n'}your recommendation
      </Text>
      <Text style={styles.subtitle}>
        Analyzing live traffic, weather, and road conditions
      </Text>

      <View style={styles.statusDivider} />
      <RotatingStatusMessage />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  animationArea: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  coreCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#6D5EF8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.5,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 20,
    color: '#A7AEC8',
    textAlign: 'center',
    marginTop: 14,
    maxWidth: '70%',
  },
  statusDivider: {
    width: 40,
    height: 1,
    backgroundColor: 'rgba(167, 174, 200, 0.25)',
    marginTop: 22,
    marginBottom: 16,
  },
  statusMessage: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: '#A7AEC8',
    textAlign: 'center',
  },
});
