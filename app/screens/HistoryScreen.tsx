import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import ResultModal from '../components/ResultModal';
import { useTripContext } from '../context/TripContext';
import { CONFIDENCE_HIGH, CONFIDENCE_MODERATE } from '../constants/config';
import { Trip, TripResult } from '../types/supabase';
import { fetchTripHistory } from '../services/tripService';
import { sanitizeError } from '../utils/errors';
import { captureEvent } from '../lib/posthog';

const TRANSPORT_MODES: Record<string, { label: string; icon: string }> = {
  drive: { label: 'Drive', icon: 'car' },
  motorcycle_taxi: { label: 'Motorcycle', icon: 'motorbike' },
  public_commute: { label: 'Commute', icon: 'bus' },
  walk: { label: 'Walk', icon: 'walk' },
};

function formatTime12h(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function HistoryScreen() {
  const { colors: COLORS } = useTheme();
  const navigation = useNavigation<any>();
  const { setPrefillData, setCurrentTrip } = useTripContext();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<TripResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const confidenceColor = (score: number): string => {
    if (score >= CONFIDENCE_HIGH) return COLORS.signalGood;
    if (score >= CONFIDENCE_MODERATE) return COLORS.signalWarn;
    return COLORS.signalRisk;
  };

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await fetchTripHistory();
      setTrips(data);
    } catch (err: any) {
      // Inline rather than Alert.alert: this runs on every focus, so a failure
      // (offline being the common one) used to throw a blocking dialog at the
      // user each time they opened the tab.
      console.warn('[HistoryScreen] Failed to load trip history:', err?.message ?? err);
      setLoadError(sanitizeError(err?.message ?? ''));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      captureEvent('history_viewed');
      fetchTrips();
    }, [fetchTrips])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTrips();
  }, [fetchTrips]);

  function handleRecalculate(trip: Trip) {
    if (!trip.origin_lat || !trip.origin_lng || !trip.destination_lat || !trip.destination_lng) {
      Alert.alert('Cannot Recalculate', 'This trip was saved before coordinate storage was added. Please use the Plan tab.');
      return;
    }
    setSelectedTrip(null);
    setPrefillData({
      originLabel: trip.origin_label ?? 'Origin',
      originLat: trip.origin_lat,
      originLng: trip.origin_lng,
      destLabel: trip.destination_label ?? 'Destination',
      destLat: trip.destination_lat,
      destLng: trip.destination_lng,
      planningMode: trip.planning_mode as 'arrive_by' | 'leave_at',
    });
    navigation.navigate('Plan');
  }

  const handleTripPress = (trip: Trip) => {
    const result: TripResult = {
      tripId: trip.id,
      recommendedLeaveTime: trip.recommended_leave_time,
      predictedArrivalTime: trip.predicted_arrival_time,
      confidenceScore: trip.confidence_score,
      confidenceReason: trip.confidence_reason ?? [],
      dataFreshness: trip.data_freshness ?? 'cached',
      weatherCondition: trip.weather_condition,
      recommendationExplanation: trip.recommendation_explanation ?? {
        planningMode: trip.planning_mode as 'arrive_by' | 'leave_at',
        factors: [],
      },
      originLat: trip.origin_lat ?? undefined,
      originLng: trip.origin_lng ?? undefined,
      destLat: trip.destination_lat ?? undefined,
      destLng: trip.destination_lng ?? undefined,
    };
    setSelectedTrip(result);

    // Also publish to TripContext so the Map tab shows this trip's route.
    setCurrentTrip(
      {
        tripId: trip.id,
        recommendedLeaveTime: trip.recommended_leave_time,
        predictedArrivalTime: trip.predicted_arrival_time,
        confidenceScore: trip.confidence_score,
        confidenceReason: trip.confidence_reason ?? [],
        dataFreshness: trip.data_freshness ?? 'estimated',
        weatherCondition: trip.weather_condition,
        recommendationExplanation: trip.recommendation_explanation ?? undefined,
        encodedPolyline: trip.encoded_polyline ?? undefined,
      },
      {
        originLabel: trip.origin_label ?? 'Origin',
        destLabel: trip.destination_label ?? 'Destination',
        originLat: trip.origin_lat ?? 0,
        originLng: trip.origin_lng ?? 0,
        destLat: trip.destination_lat ?? 0,
        destLng: trip.destination_lng ?? 0,
        selectedDateTime: new Date(trip.target_time),
        planningMode: (trip.planning_mode as 'arrive_by' | 'leave_at') ?? 'arrive_by',
      }
    );
  };

  const renderTripCard = ({ item }: { item: Trip }) => {
    const transportMode = TRANSPORT_MODES[item.transport_mode] || { label: 'Unknown', icon: 'help-circle' };
    const leaveTime = formatTime12h(item.recommended_leave_time);
    const arriveTime = formatTime12h(item.predicted_arrival_time);
    const date = formatDate(item.created_at);

    return (
      <Pressable style={styles.tripCard} onPress={() => handleTripPress(item)}>
        <View style={styles.tripCardLeft}>
          <View style={styles.transportBadge}>
            {item.transport_mode === 'motorcycle_taxi' ? (
              <MaterialCommunityIcons name="motorbike" size={20} color={COLORS.accent} />
            ) : (
              <Ionicons name={transportMode.icon as any} size={20} color={COLORS.accent} />
            )}
          </View>
        </View>

        <View style={styles.tripCardBody}>
          <Text style={styles.tripCardRoute} numberOfLines={1}>{item.origin_label ?? 'Origin'} {'->'} {item.destination_label ?? 'Destination'}</Text>
          <Text style={styles.tripCardTimes}>Leave {leaveTime} Â· Arrive {arriveTime}</Text>
          <Text style={styles.tripCardDate}>{date}</Text>
        </View>

        <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor(item.confidence_score) }]}>
          <Text style={styles.confidenceBadgeText}>{Math.round(item.confidence_score)}%</Text>
        </View>
      </Pressable>
    );
  };

  const renderEmpty = () => {
    if (loadError) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-offline-outline" size={48} color={COLORS.signalRisk} />
          <Text style={styles.emptyTitle}>Couldn't load history</Text>
          <Text style={styles.emptySubtitle}>{loadError}</Text>
          <Pressable style={styles.retryButton} onPress={fetchTrips} accessibilityRole="button" accessibilityLabel="Retry loading trip history">
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="time-outline" size={48} color={COLORS.signalWarn} />
        <Text style={styles.emptyTitle}>No trips yet</Text>
        <Text style={styles.emptySubtitle}>Your past trips will appear here after you calculate a route from the Plan tab.</Text>
      </View>
    );
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.canvas },
    header: { paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: COLORS.canvas },
    headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: COLORS.textPrimary },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyListContainer: { flexGrow: 1, justifyContent: 'center' },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 32 },
    emptyTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, marginTop: 16, marginBottom: 8 },
    emptySubtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
    retryButton: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: COLORS.accentTint, minHeight: 44, justifyContent: 'center' },
    retryButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.accent },
    tripCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: COLORS.card,
      marginHorizontal: 14,
      marginBottom: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.divider,
      minHeight: 44,
    },
    tripCardLeft: { marginRight: 10 },
    transportBadge: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: COLORS.accentTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tripCardBody: { flex: 1 },
    tripCardRoute: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textPrimary, marginBottom: 3 },
    tripCardTimes: { fontFamily: 'Inter_500Medium', fontSize: 12, color: COLORS.textSecondary, marginBottom: 1 },
    tripCardDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: COLORS.textSecondary },
    confidenceBadge: { width: 48, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
    confidenceBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff' },
  }), [COLORS]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trip History</Text>
      </View>
      {loading && trips.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={trips}
          renderItem={renderTripCard}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={trips.length === 0 ? styles.emptyListContainer : { paddingTop: 4, paddingBottom: 16 }}
          scrollEnabled={trips.length > 0}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        />
      )}

      <ResultModal
        result={selectedTrip}
        originLabel={selectedTrip ? (trips.find(t => t.id === selectedTrip.tripId)?.origin_label ?? 'Origin') : 'Origin'}
        destLabel={selectedTrip ? (trips.find(t => t.id === selectedTrip.tripId)?.destination_label ?? 'Destination') : 'Destination'}
        selectedDateTime={new Date()}
        planningMode={selectedTrip?.recommendationExplanation?.planningMode ?? 'arrive_by'}
        onClose={() => setSelectedTrip(null)}
        onViewRoute={() => {
          setSelectedTrip(null);
          navigation.navigate('Map');
        }}
        onRecalculate={selectedTrip ? () => {
          const trip = trips.find(t => t.id === selectedTrip.tripId);
          if (trip) {
            handleRecalculate(trip);
          }
        } : undefined}
      />
    </View>
  );
}
