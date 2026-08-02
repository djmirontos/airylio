import { useEffect, useState, useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /** History only: recalculate this trip against current traffic. */
  onRecalculate?: () => void;
  /** Shown when the result carries a polyline. */
  onViewRoute?: () => void;
  /** Plan only: schedule the leave reminder. Omit to hide the button. */
  onSetReminder?: () => void;
  reminderSet?: boolean;
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

/**
 * Splits a Google formatted address into a place name and the rest.
 *
 * "SM Megamall, Ortigas Center, Mandaluyong" -> name "SM Megamall",
 * detail "Ortigas Center, Mandaluyong". Labels without a comma - "Current
 * Location" - return an empty detail and render as a single line.
 */
function splitAddress(label: string): { name: string; detail: string } {
  const raw = (label ?? '').trim();
  // Dropping empty segments keeps a stray leading comma from producing an empty
  // name and repeating the same text on both lines.
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { name: raw, detail: '' };
  return { name: parts[0], detail: parts.slice(1).join(', ') };
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
  onSetReminder,
  reminderSet = false,
}: ResultModalProps) {
  const { colors: COLORS } = useTheme();
  const insets = useSafeAreaInsets();
  const [countdownText, setCountdownText] = useState<string | null>(null);

  const origin = splitAddress(originLabel);
  const destination = splitAddress(destLabel);

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
    resultBackButton: { position: 'absolute', top: insets.top, left: 16, zIndex: 10, width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    // No alignItems: 'flex-start' here. It shrink-wrapped every child, so the
    // trip stack collapsed to its content and tripText's flex: 1 had almost no
    // width to fill - addresses rendered one character per line. Children that
    // should not stretch set alignSelf themselves.
    // The 70 here was not status-bar padding alone - it also reserved room for
    // the absolutely positioned back button. Driving both from the real inset
    // keeps the same spacing on a standard status bar while no longer running
    // under a notch or a tall cutout.
    resultHero: { backgroundColor: COLORS.resultHero, paddingTop: insets.top + 46, paddingBottom: 16, paddingHorizontal: 24 },
    // Hero row: the leave-time block on the left, confidence ring on the right.
    heroLayout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heroTextCol: { flex: 1 },
    countdownText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 4 },
    resultHeroLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.7)' },
    resultHeroTime: { fontFamily: 'Poppins_700Bold', fontSize: 34, color: '#fff', marginTop: 2 },
    resultArrivalInline: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
    resultBody: { flex: 1, padding: 16, backgroundColor: COLORS.resultBody },
    divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 10 },
    whyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: COLORS.textPrimary, marginBottom: 8 },
    reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 10 },
    reasonText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary, flex: 1 },
    freshnessBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 10 },
    freshnessDot: { width: 8, height: 8, borderRadius: 4 },
    freshnessDivider: { width: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 6 },
    freshnessBadgeInline: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: '#fff' },
    tripStatStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
    tripStat: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
    tripStatValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, flexShrink: 1 },
    tripStatSeparator: { width: 1, height: 14, backgroundColor: COLORS.divider },
    actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
    actionButton: { flex: 1, marginTop: 0, marginBottom: 0, paddingHorizontal: 8 },
    // Vertical origin -> destination stack: a row per stop, joined by
    // tripStackLine. Values match the Plan screen's originals exactly so both
    // entry points render identically.
    tripStack: { marginBottom: 6 },
    tripStackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    tripDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
    tripStackLine: { width: 1, minHeight: 16, backgroundColor: 'rgba(255,255,255,0.3)', marginLeft: 2.5, marginVertical: 3 },
    tripTextCol: { flex: 1, minWidth: 0 },
    tripText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    // The hero panel is dark in both themes (COLORS.resultHero), so this is a
    // white alpha rather than COLORS.textSecondary - that would be dark-on-dark
    // in light mode.
    tripTextSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.62)', marginTop: 1 },
    tripPinIcon: { marginTop: 2 },
    arrivalTargetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, alignSelf: 'flex-start' },
    arrivalTargetText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.7)' },
    viewRouteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.signalGood, paddingVertical: 14, borderRadius: 16, marginTop: 8, marginBottom: 4, minHeight: 44 },
    viewRouteButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
    recalculateButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: 16, marginTop: 8, marginBottom: 8, minHeight: 44 },
    remindButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.accent, marginTop: 8, marginBottom: 4, minHeight: 44 },
    remindButtonActive: { borderColor: COLORS.signalGood, backgroundColor: 'rgba(18,184,134,0.08)' },
    remindButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.accent },
    remindButtonTextActive: { color: COLORS.signalGood },
    recalculateButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },
  }), [COLORS, insets.top]);

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
                <View style={styles.tripTextCol}>
                  <Text style={styles.tripText} numberOfLines={1} ellipsizeMode="tail">
                    {origin.name}
                  </Text>
                  {!!origin.detail && (
                    <Text style={styles.tripTextSub} numberOfLines={2} ellipsizeMode="tail">
                      {origin.detail}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.tripStackLine} />
              <View style={styles.tripStackRow}>
                <Ionicons name="location" size={13} color={COLORS.signalRisk} style={styles.tripPinIcon} />
                <View style={styles.tripTextCol}>
                  <Text style={styles.tripText} numberOfLines={1} ellipsizeMode="tail">
                    {destination.name}
                  </Text>
                  {!!destination.detail && (
                    <Text style={styles.tripTextSub} numberOfLines={2} ellipsizeMode="tail">
                      {destination.detail}
                    </Text>
                  )}
                </View>
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

          {/* No restatement of the leave/arrive times here - the hero above
              already shows both, in much larger type. */}
          <ScrollView style={styles.resultBody}>
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

            {/* One strip instead of three bordered rows with their own heading:
                same facts, a fraction of the height. */}
            <View style={styles.tripStatStrip}>
              <View style={styles.tripStat}>
                <Ionicons name="time-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.tripStatValue}>
                  {formatTravelTime(result.recommendedLeaveTime, result.predictedArrivalTime)}
                </Text>
              </View>
              {result.distanceMeters !== undefined && (
                <>
                  <View style={styles.tripStatSeparator} />
                  <View style={styles.tripStat}>
                    <Ionicons name="navigate-outline" size={15} color={COLORS.textSecondary} />
                    <Text style={styles.tripStatValue}>{formatDistance(result.distanceMeters)}</Text>
                  </View>
                </>
              )}
              <View style={styles.tripStatSeparator} />
              <View style={styles.tripStat}>
                <Ionicons name="globe-outline" size={15} color={COLORS.textSecondary} />
                <Text style={styles.tripStatValue} numberOfLines={1}>Google Routes</Text>
              </View>
            </View>

            {/* Side by side: two full-width stacked buttons cost twice the
                height for no added clarity. */}
            <View style={styles.actionRow}>
              {onViewRoute && result?.encodedPolyline && (
                <Pressable
                  style={[styles.viewRouteButton, styles.actionButton]}
                  onPress={onViewRoute}
                  accessibilityLabel="View route on map"
                  accessibilityRole="button"
                >
                  <Ionicons name="map" size={16} color="#fff" />
                  <Text style={styles.viewRouteButtonText} numberOfLines={1}>Map</Text>
                </Pressable>
              )}

              {onSetReminder && (
                <Pressable
                  style={[styles.remindButton, styles.actionButton, reminderSet && styles.remindButtonActive]}
                  onPress={reminderSet ? undefined : onSetReminder}
                  accessibilityLabel="Set leave reminder"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={reminderSet ? 'checkmark-circle' : 'notifications-outline'}
                    size={16}
                    color={reminderSet ? COLORS.signalGood : COLORS.accent}
                  />
                  <Text
                    style={[styles.remindButtonText, reminderSet && styles.remindButtonTextActive]}
                    numberOfLines={1}
                  >
                    {reminderSet ? 'Reminder set' : 'Remind me'}
                  </Text>
                </Pressable>
              )}
            </View>

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

