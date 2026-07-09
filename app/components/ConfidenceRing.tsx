import { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ConfidenceRingProps {
  progress: number; // 0-100
  color: string;
  trackColor?: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
  labelColor?: string;
}

export default function ConfidenceRing({
  progress,
  color,
  trackColor = 'rgba(255,255,255,0.18)',
  size = 96,
  strokeWidth = 8,
  label,
  labelColor = '#fff',
}: ConfidenceRingProps) {
  const animatedValue = useRef(new Animated.Value(0)).current;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    animatedValue.setValue(0);
    // strokeDashoffset is not a native-driver-supported property,
    // so useNativeDriver must be false here.
    Animated.timing(animatedValue, {
      toValue: progress,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const strokeDashoffset = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {label !== undefined && (
        <Animated.Text
          style={{
            fontFamily: 'Poppins_700Bold',
            fontSize: size * 0.24,
            color: labelColor,
          }}
        >
          {label}
        </Animated.Text>
      )}
    </View>
  );
}
