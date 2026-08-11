import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { YesterdayTrip } from '../hooks/useYesterdayTrip';

type Rating = 'accurate' | 'close' | 'late';

interface Props {
  trip: YesterdayTrip;
  onRate: (rating: Rating) => void;
  onDismiss: () => void;
}

const RATINGS: { key: Rating; emoji: string; label: string; a11y: string }[] = [
  { key: 'accurate', emoji: '\u{1F60A}', label: 'On time', a11y: 'Rate yesterday as on time' },
  { key: 'close', emoji: '\u{1F610}', label: 'Close', a11y: 'Rate yesterday as close' },
  { key: 'late', emoji: '\u{2639}\u{FE0F}', label: 'Late', a11y: 'Rate yesterday as late' },
];

export default function YesterdayTripBanner({ trip, onRate, onDismiss }: Props) {
  const { colors: COLORS } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          flexDirection: 'row',
          backgroundColor: COLORS.card,
          borderRadius: 14,
          marginBottom: 16,
          overflow: 'hidden',
          shadowColor: COLORS.ink,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.04,
          shadowRadius: 8,
          elevation: 2,
        },
        accentStrip: { width: 4, backgroundColor: COLORS.accent },
        body: { flex: 1, padding: 14 },
        headerRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        },
        title: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, flex: 1 },
        dismissButton: {
          padding: 8,
          marginTop: -8,
          marginRight: -8,
          minHeight: 44,
          minWidth: 44,
          alignItems: 'center',
          justifyContent: 'center',
        },
        route: {
          fontFamily: 'Inter_400Regular',
          fontSize: 12,
          color: COLORS.textSecondary,
          marginBottom: 12,
        },
        ratingRow: { flexDirection: 'row', gap: 12 },
        ratingButton: {
          flex: 1,
          alignItems: 'center',
          gap: 4,
          paddingVertical: 8,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: COLORS.divider,
          backgroundColor: COLORS.canvas,
          minHeight: 44,
        },
        ratingEmoji: { fontSize: 22 },
        ratingLabel: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 11,
          color: COLORS.textSecondary,
        },
      }),
    [COLORS]
  );

  return (
    <View style={styles.card}>
      {/* Left accent strip: a flex sibling rather than a border, so it runs the
          full height of whatever the body wraps to. */}
      <View style={styles.accentStrip} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>How was yesterday's trip?</Text>
          <Pressable
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityLabel="Dismiss yesterday's trip review"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={18} color={COLORS.textSecondary} />
          </Pressable>
        </View>

        <Text style={styles.route} numberOfLines={1}>
          {trip.originLabel} → {trip.destinationLabel}
        </Text>

        <View style={styles.ratingRow}>
          {RATINGS.map((rating) => (
            <Pressable
              key={rating.key}
              style={styles.ratingButton}
              onPress={() => onRate(rating.key)}
              accessibilityLabel={rating.a11y}
              accessibilityRole="button"
            >
              <Text style={styles.ratingEmoji}>{rating.emoji}</Text>
              <Text style={styles.ratingLabel}>{rating.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
