import { useEffect, useState, useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import ConfidenceRing from './ConfidenceRing';
import { CONFIDENCE_HIGH, CONFIDENCE_MODERATE } from '../constants/config';
import { TripResult, ExplanationFactor } from '../types/supabase';

type PlanningMode = 'arrive_by' | 'leave_at';
type ColorScheme = ReturnType<typeof import('../context/ThemeContext').useTheme>['colors'];

interface ResultModalProps {
  result: TripResult | null;
  originLabel: string;
  destLabel: string;
  selectedDateTime: Date;
  planningMode: PlanningMode;
  onClose: () => void;
  onRecalculate?: () => void;
  onViewRoute?: () => void;
}

function formatTime12h(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatTravelTime(leaveTime: string, arrivalTime: string): string {
  const ms = new Date(arrivalTime).getTime() - new Date(leaveTime).getTime();
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${minutes} min`;
}

function formatDistance(meters?: number): string | null {
  if (meters === undefined) return null;
  return `${(meters / 1000).toFixed(1)} km`;
}

export default function ResultModal({
  result,
  originLabel,
  destLabel,
  selectedDateTime,
  planningMode,
  onClose,
  onRecalculate,
  onViewRoute,
}: ResultModalProps) {
  const { colors: COLORS } = useTheme();
  const [countdownText, setCountdownText] = useState<string | null>(null);

  function confidenceColor(score: number): string {
    if (score >= CONFIDENCE_HIGH) return COLORS.signalGood;
    if (score >= CONFIDENCE_MODERATE) return COLORS.signalWarn;
    return COLORS.signalRisk;
  }

  function freshnessLabel(freshness: string): { text: string; color: string } {
    if (freshness === 'live') return { text: 'Live traffic', color: COLORS.signalGood };
    if (freshness === 'cached') return { text: 'Recent data', color: COLORS.signalWarn };
    return { text: 'Estimated', color: COLORS.textSecondary };
  }

  function reasonIcon(reason: string): { name: string; color: string } {
    const lower = reason.toLowerCase();
    if (lower.includes('rain') || lower.includes('storm') || lower.includes('weather')) {
      return { name: 'rainy', color: '#4A90D9' };
    }
    if (lower.includes('rush') || lower.includes('traffic') || lower.includes('congestion')) {
      return { name: 'car', color: COLORS.accent };
    }
    if (lower.includes('cached') || lower.includes('historical') || lower.includes('estimate')) {
      return { name: 'stats-chart', color: COLORS.textSecondary };
    }
    if (lower.includes('buffer') || lower.includes('minute')) {
      return { name: 'time', color: COLORS.signalWarn };
    }
    return { name: 'checkmark-circle', color: COLORS.signalGood };
  }

  function factorIcon(type: 'weather' | 'rush_hour' | 'buffer_cap'): { name: string; color: string } {
    if (type === 'weather') return { name: 'rainy', color: '#4A90D9' };
    if (type === 'rush_hour') return { name: 'car', color: COLORS.accent };
    return { name: 'time', color: COLORS.signalWarn };
  }

  function weatherIndicator(condition?: 'clear' | 'rain' | 'heavy_rain' | 'storm'): { icon: string; label: string; color: string } {
    if (condition === 'storm') return { icon: 'thunderstorm', label: 'Storm', color: '#7B5EA7' };
    if (condition === 'heavy_rain') return { icon: 'rainy', label: 'Heavy Rain', color: '#4A90D9' };
    if (condition === 'rain') return { icon: 'rainy-outline', label: 'Rain', color: '#4A90D9' };
    return { icon: 'sunny', label: 'Clear', color: COLORS.signalGood };
  }

  const resultMode: PlanningMode = result?.recommendationExplanation?.planningMode ?? planningMode;
  const freshness = result ? freshnessLabel(result.dataFreshness ?? 'cached') : null;
  const weather = result ? weatherIndicator(result.weatherCondition) : null;

  useEffect(() => {
    if (!result) {
      setCountdownText(null);
      return;
    }
    // Captured after the guard: the narrowing above does not reach into tick().
    const activeResult = result;
    function tick() {
      const diffMs = new Date(activeResult.recommendedLeaveTime).getTime() - Date.now();
      const diffMin = Math.round(diffMs / 60000);
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec <= 0) {
        const overdue = Math.round(-diffMs / 60000);
        setCountdownText(overdue < 1 ? 'Leave now' : `Overdue by ${overdue} min`);
      } else if (diffMin < 1) {
        setCountdownText('Leave now');
      } else if (diffMin < 60) {
        setCountdownText(`Leave in ${diffMin} min`);
      } else {
        const h = Math.floor(diffMin / 60);
        const m = diffMin % 60;
        setCountdownText(`Leave in ${h}h ${m}m`);
      }
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [result]);

  const styles = useMemo(() => StyleSheet.create({
    resultScreen: { flex: 1, backgroundColor: COLORS.resultBody },
    resultBackButton: { position: 'absolute', top: 32, left: 16, zIndex: 10, width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    resultContent: { flex: 1, paddingBottom: 0 },
    resultHero: { backgroundColor: COLORS.resultHero, paddingTop: 70, paddingBottom: 16, paddingHorizontal: 24, alignItems: 'flex-start' },
    // Hero row: the leave-time block on the left, confidence ring on the right.
    heroLayout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, alignSelf: 'stretch' },
    heroTextCol: { flex: 1 },
    countdownText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 4 },
    resultHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.7)' },
    resultHeroTime: { fontFamily: 'Poppins_700Bold', fontSize: 34, color: '#fff', marginTop: 2 },
    resultArrivalInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
    resultBody: { flex: 1, padding: 16, backgroundColor: COLORS.resultBody },
    confidenceContainer: { alignItems: 'center', gap: 4 },
    confidenceLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.7)' },
    explanationSentence: { fontFamily: 'Inter_500Medium', fontSize: 14, color: COLORS.textPrimary, marginBottom: 12, lineHeight: 20 },
    divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 10 },
    whyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 8 },
    reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 10 },
    reasonText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
    freshnessBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 10 },
    freshnessDot: { width: 8, height: 8, borderRadius: 4 },
    freshnessDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 6 },
    freshnessBadgeInline: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#fff' },
    tripDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
    tripDetailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, flex: 1 },
    tripDetailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.textPrimary },
    // Vertical origin -> destination stack: a row per stop, joined by
    // tripStackLine (1px wide, 8px tall). This was 'row', which laid the two
    // stops out side by side; tripStackRow was referenced but never defined,
    // so each stop fell back to a column and the whole block rendered wrong.
    tripStack: { flexDirection: 'column', alignItems: 'flex-start', marginBottom: 6, alignSelf: 'stretch' },
    tripStackRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
    // 6px wide so its centre sits on tripStackLine's centre (marginLeft 2.5 + 0.5px).
    tripDot: { width: 6, height: 6, borderRadius: 3 },
    tripStackIcon: { marginTop: 2 },
    tripStackLine: { width: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 2.5, marginVertical: 2 },
    tripText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.9)', flex: 1 },
    arrivalTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    arrivalTargetText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.7)' },
    transportRow: { flexDirection: 'row', gap: 10, marginBottom: 12, marginTop: 8 },
    transportPill: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center' },
    transportPillText: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
    transportPillTextSelected: { fontFamily: 'Inter_500Medium', fontSize: 10.5, color: '#fff', textAlign: 'center' },
    viewRouteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.signalGood, paddingVertical: 14, borderRadius: 16, marginTop: 8, marginBottom: 4, minHeight: 44 },
    viewRouteButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    recalculateButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: 16, marginTop: 8, marginBottom: 8, minHeight: 44 },
    recalculateButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    updatedText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 2 },
  }), [COLORS]);

  return (
    <Modal visible={!!result} animationType="slide">
      {result && freshness && weather && (
        <View style={styles.resultScreen}>
          <StatusBar style="light" />
          <View style={styles.resultHero}>
            <Pressable style={styles.resultBackButton} onPress={onClose} accessibilityLabel="Close result" accessibilityRole="button">
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>

            <View style={styles.tripStack}>
              <View style={styles.tripStackRow}>
                <View style={[styles.tripDot, { backgroundColor: '#fff' }]} />
                <Text style={styles.tripText} numberOfLines={2}>{originLabel}</Text>
              </View>
              <View style={styles.tripStackLine} />
              <View style={styles.tripStackRow}>
                <Ionicons name="location" size={13} color={COLORS.signalRisk} />
                <Text style={styles.tripText} numberOfLines={2}>{destLabel}</Text>
              </View>
            </View>

            {resultMode === 'arrive_by' && (
              <View style={styles.arrivalTargetRow}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.7)" />
                <Text style={styles.arrivalTargetText}>
                  Target arrival {selectedDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                </Text>
              </View>
            )}

            <View style={styles.freshnessBadgeRow}>
              <View style={[styles.freshnessDot, { backgroundColor: freshness.color }]} />
              <Text style={styles.freshnessBadgeInline}>{freshness.text}</Text>
              <View style={styles.freshnessDivider} />
              <Ionicons name={weather.icon as any} size={13} color={weather.color} />
              <Text style={styles.freshnessBadgeInline}>{weather.label}</Text>
            </View>

            <View style={styles.heroLayout}>
              <View style={styles.heroTextCol}>
                <Text style={styles.resultHeroLabel}>Leave at</Text>
                <Text style={styles.resultHeroTime}>
                  {formatTime12h(result.recommendedLeaveTime)}
                </Text>
                {countdownText && (
                  <Text style={styles.countdownText}>{countdownText}</Text>
                )}
                <Text style={styles.resultArrivalInline}>
                  {resultMode === 'arrive_by' ? 'Arrive by ' : 'Est. arrival '}
                  {formatTime12h(result.predictedArrivalTime)}
                </Text>
              </View>
              <ConfidenceRing
                progress={result.confidenceScore}
                color={confidenceColor(result.confidenceScore)}
                label={`${Math.round(result.confidenceScore)}%`}
                sublabel={result.confidenceScore >= CONFIDENCE_HIGH ? "High" : result.confidenceScore >= CONFIDENCE_MODERATE ? "Moderate" : "Low"}
              />
            </View>
          </View>

          <ScrollView style={styles.resultBody}>
            <Text style={styles.explanationSentence}>
              {resultMode === 'arrive_by'
                ? `Leave at ${formatTime12h(result.recommendedLeaveTime)} to arrive by ${formatTime12h(result.predictedArrivalTime)}.`
                : `If you leave at ${formatTime12h(result.recommendedLeaveTime)}, you'll arrive around ${formatTime12h(result.predictedArrivalTime)}.`}
            </Text>

            {(result.confidenceReason?.length ?? 0) > 0 && (
              <>
                <Text style={styles.whyTitle}>Why this recommendation</Text>
                {(() => {
                  const cleanReason = (r: string) => r.replace('heavy_rain', 'Heavy Rain').replace('_rain', ' Rain');
                  return result.confidenceReason.map((reason, i) => {
                    const icon = reasonIcon(reason);
                    return (
                      <View key={i} style={styles.reasonRow}>
                        <Ionicons name={icon.name as any} size={16} color={icon.color} style={{ marginTop: 1 }} />
                        <Text style={styles.reasonText}>{cleanReason(reason)}</Text>
                      </View>
                    );
                  });
                })()}
              </>
            )}

            {(result.recommendationExplanation?.factors?.length ?? 0) > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={styles.whyTitle}>Estimated impact</Text>
                {(result.recommendationExplanation?.factors ?? []).map((factor, i) => {
                  const icon = factorIcon(factor.type);
                  return (
                    <View key={i} style={styles.reasonRow}>
                      <Ionicons name={icon.name as any} size={16} color={icon.color} style={{ marginTop: 1 }} />
                      <Text style={styles.reasonText}>{factor.label}</Text>
                    </View>
                  );
                })}
              </>
            )}

            <View style={styles.divider} />

            <Text style={styles.whyTitle}>Trip details</Text>
            <View style={styles.tripDetailRow}>
              <Ionicons name="time-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.tripDetailLabel}>Travel time</Text>
              <Text style={styles.tripDetailValue}>
                {formatTravelTime(result.recommendedLeaveTime, result.predictedArrivalTime)}
              </Text>
            </View>
            {result.distanceMeters !== undefined && (
              <View style={styles.tripDetailRow}>
                <Ionicons name="navigate-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.tripDetailLabel}>Distance</Text>
                <Text style={styles.tripDetailValue}>{formatDistance(result.distanceMeters)}</Text>
              </View>
            )}
            <View style={styles.tripDetailRow}>
              <Ionicons name="globe-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.tripDetailLabel}>Data source</Text>
              <Text style={styles.tripDetailValue}>Google Routes</Text>
            </View>

            {onViewRoute && result?.encodedPolyline && (
              <Pressable style={styles.viewRouteButton} onPress={onViewRoute}>
                <Ionicons name="map" size={16} color="#fff" />
                <Text style={styles.viewRouteButtonText}>View Route on Map</Text>
              </Pressable>
            )}

            {onRecalculate && (
              <Pressable style={styles.recalculateButton} onPress={onRecalculate} accessibilityLabel="Recalculate with current traffic" accessibilityRole="button">
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.recalculateButtonText}>Recalculate with current traffic</Text>
              </Pressable>
            )}

            
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

