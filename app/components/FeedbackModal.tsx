import { View, Text, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

const COLORS = {
  ink: '#12153D',
  accent: '#4C4F9E',
  canvas: '#FAFAFC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6F8A',
  divider: '#E7E7F1',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
};

interface FeedbackModalProps {
  visible: boolean;
  tripId: string | null;
  destLabel: string;
  onClose: () => void;
}

type Rating = 'accurate' | 'close' | 'late';

export default function FeedbackModal({ visible, tripId, destLabel, onClose }: FeedbackModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleRating(rating: Rating) {
    if (!tripId || submitting) return;
    setSubmitting(true);
    try {
      await supabase.from('feedback').insert({
        trip_id: tripId,
        rating,
        user_success: rating !== 'late',
      });
      setSubmitted(true);
      setTimeout(onClose, 1500);
    } catch {
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {submitted ? (
            <>
              <Text style={styles.emoji}>🎉</Text>
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
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('accurate')}>
                    <Text style={styles.ratingEmoji}>😊</Text>
                    <Text style={styles.ratingLabel}>On time</Text>
                  </Pressable>
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('close')}>
                    <Text style={styles.ratingEmoji}>😐</Text>
                    <Text style={styles.ratingLabel}>Close</Text>
                  </Pressable>
                  <Pressable style={styles.ratingButton} onPress={() => handleRating('late')}>
                    <Text style={styles.ratingEmoji}>😔</Text>
                    <Text style={styles.ratingLabel}>Late</Text>
                  </Pressable>
                </View>
              )}
              <Pressable onPress={onClose} style={styles.skipButton}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(18,21,61,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 340, backgroundColor: COLORS.card, borderRadius: 24, padding: 28, alignItems: 'center' },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 24 },
  ratingRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  ratingButton: { alignItems: 'center', gap: 8 },
  ratingEmoji: { fontSize: 40 },
  ratingLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.textSecondary },
  skipButton: { paddingVertical: 8, paddingHorizontal: 16 },
  skipText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },
});
