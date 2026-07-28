import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { useState, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { submitFeedback } from '../services/tripService';

interface FeedbackModalProps {
  visible: boolean;
  tripId: string | null;
  destLabel: string;
  onClose: () => void;
}

type Rating = 'accurate' | 'close' | 'late';

export default function FeedbackModal({ visible, tripId, destLabel, onClose }: FeedbackModalProps) {
  const { colors: COLORS } = useTheme();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleRating(rating: Rating) {
    if (!tripId || submitting) return;
    setSubmitting(true);
    try {
      await submitFeedback(tripId, rating);
      setSubmitted(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      // Close without the success state rather than claiming it worked.
      console.warn('[FeedbackModal] Could not submit feedback:', err);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const styles = useMemo(() => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(18,21,61,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    sheet: { width: '100%', maxWidth: 340, backgroundColor: COLORS.card, borderRadius: 24, padding: 28, alignItems: 'center' },
    emoji: { fontSize: 48, marginBottom: 12 },
    title: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, textAlign: 'center', marginBottom: 6 },
    subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 24 },
    ratingRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
    ratingButton: { alignItems: 'center', gap: 8, minHeight: 44, minWidth: 44 },
    ratingEmoji: { fontSize: 40 },
    ratingLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.textSecondary },
    skipButton: { paddingVertical: 8, paddingHorizontal: 16, minHeight: 44 },
    skipText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },
  }), [COLORS]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {submitted ? (
            <>
              <Text style={styles.emoji}>ðŸŽ‰</Text>
              <Text style={styles.title}>Thanks for your feedback!</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>How was your trip?</Text>
              <Text style={styles.subtitle}>To {destLabel}</Text>
              {submitting ? (
                <ActivityIndicator color={COLORS.accent} style={{ marginTop: 24 }} />
              ) : (
                <View style={styles.ratingRow}>
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('accurate')} accessibilityLabel="Rate as on time" accessibilityRole="button">
                    <Text style={styles.ratingEmoji}>ðŸ˜Š</Text>
                    <Text style={styles.ratingLabel}>On time</Text>
                  </Pressable>
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('close')} accessibilityLabel="Rate as close" accessibilityRole="button">
                    <Text style={styles.ratingEmoji}>ðŸ˜</Text>
                    <Text style={styles.ratingLabel}>Close</Text>
                  </Pressable>
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('late')} accessibilityLabel="Rate as late" accessibilityRole="button">
                    <Text style={styles.ratingEmoji}>ðŸ˜”</Text>
                    <Text style={styles.ratingLabel}>Late</Text>
                  </Pressable>
                </View>
              )}
              <Pressable onPress={onClose} style={styles.skipButton} accessibilityLabel="Skip feedback" accessibilityRole="button">
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
