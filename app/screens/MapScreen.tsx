import { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { decode } from '@mapbox/polyline';
import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useTripContext } from '../context/TripContext';
import { captureEvent } from '../lib/posthog';

interface RouteCoord {
  latitude: number;
  longitude: number;
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

export default function MapScreen() {
  const { colors: COLORS } = useTheme();
  const { currentTrip, currentMeta } = useTripContext();
  const [decodedRoute, setDecodedRoute] = useState<RouteCoord[]>([]);
  const [loading, setLoading] = useState(false);

  const board = currentTrip?.railRoute?.boardingStation;
  const alight = currentTrip?.railRoute?.alightingStation;
  // Both ends are needed to draw anything: the walk legs run origin -> board
  // and alight -> destination.
  const isRailTrip = !!board && !!alight;

  const railSegments = isRailTrip && currentMeta ? {
    walkToStation: [
      { latitude: currentMeta.originLat, longitude: currentMeta.originLng },
      { latitude: board!.lat, longitude: board!.lng },
    ],
    railLine: [
      { latitude: board!.lat, longitude: board!.lng },
      { latitude: alight!.lat, longitude: alight!.lng },
    ],
    walkFromStation: [
      { latitude: alight!.lat, longitude: alight!.lng },
      { latitude: currentMeta.destLat, longitude: currentMeta.destLng },
    ],
  } : null;
  const mapRef = useRef<MapView>(null);

  // On focus rather than mount: the tab stays mounted once visited, so a mount
  // effect would fire only the first time.
  useFocusEffect(
    useCallback(() => {
      captureEvent('map_viewed');
    }, [])
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.canvas },
    map: { flex: 1 },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    infoCard: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.card, padding: 16 },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    timeLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textPrimary },
    timeValue: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: COLORS.textPrimary, marginTop: 4 },
    divider: { height: 1, backgroundColor: COLORS.divider, marginVertical: 12 },
    detailsRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
    detailItem: { flex: 1 },
    detailLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textPrimary },
    detailValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginTop: 4 },
    buttonRow: { flexDirection: 'row', gap: 12 },
    navButton: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
    navButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#fff', marginLeft: 6 },
    wazeButton: {},
  }), [COLORS]);

  useEffect(() => {
    let fitTimer: ReturnType<typeof setTimeout> | undefined;
    if (currentTrip?.encodedPolyline) {
      setLoading(true);
      try {
        const coordinates = decode(currentTrip.encodedPolyline);
        const routeCoords: RouteCoord[] = coordinates.map(([lat, lng]) => ({
          latitude: lat,
          longitude: lng,
        }));
        setDecodedRoute(routeCoords);

        fitTimer = setTimeout(() => {
          if (mapRef.current && routeCoords.length > 0) {
            mapRef.current.fitToCoordinates(routeCoords, {
              edgePadding: { top: 100, right: 50, bottom: 200, left: 50 },
              animated: true,
            });
          }
        }, 500);
      } catch (err) {
        console.error('Failed to decode polyline:', err);
      } finally {
        setLoading(false);
      }
    }
    return () => {
      if (fitTimer) clearTimeout(fitTimer);
    };
  }, [currentTrip?.encodedPolyline]);

  // Rail journeys carry no polyline, so the effect above never runs for them
  // and the map would stay at its default region. Fit to the four points of
  // the journey instead: origin, both stations, destination.
  useEffect(() => {
    if (!railSegments || !currentMeta) return;
    const allCoords = [
      { latitude: currentMeta.originLat, longitude: currentMeta.originLng },
      railSegments.walkToStation[1],
      railSegments.railLine[1],
      { latitude: currentMeta.destLat, longitude: currentMeta.destLng },
    ];
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(allCoords, {
        edgePadding: { top: 80, right: 40, bottom: 200, left: 40 },
        animated: true,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [board?.lat, board?.lng, alight?.lat, alight?.lng, currentMeta?.originLat, currentMeta?.destLat]);

  if (!currentTrip || !currentMeta) {
    return (
      <View style={[styles.container, {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }]}>
        <Ionicons name="map-outline" size={64} color={COLORS.divider} />
        <Text style={{
          fontFamily: 'Poppins_700Bold',
          fontSize: 18,
          color: COLORS.textPrimary,
          marginTop: 16,
          marginBottom: 8,
          textAlign: 'center',
        }}>
          No active route
        </Text>
        <Text style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 14,
          color: COLORS.textSecondary,
          textAlign: 'center',
          lineHeight: 20,
        }}>
          Calculate a trip on the Plan tab, or tap a trip in History to see its route here.
        </Text>
      </View>
    );
  }

  const handleOpenGoogleMaps = () => {
    // Transit for rail journeys so Google shows the same kind of trip.
    // TripMeta carries planningMode (arrive_by / leave_at), not the transport
    // mode, so a walking trip cannot be distinguished here - everything
    // non-rail opens as driving, as it did before.
    const travelMode = isRailTrip ? 'transit' : 'driving';
    const url = `https://www.google.com/maps/dir/?api=1&origin=${currentMeta.originLat},${currentMeta.originLng}&destination=${currentMeta.destLat},${currentMeta.destLng}&travelmode=${travelMode}`;
    Linking.openURL(url);
  };

  const handleOpenWaze = () => {
    const url = `https://waze.com/ul?ll=${currentMeta.destLat},${currentMeta.destLng}&navigate=yes`;
    Linking.openURL(url);
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.accent} size="large" />
        </View>
      ) : (
        <>
          <MapView
            ref={mapRef}
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            mapType="standard"
            initialRegion={{
              latitude: currentMeta.originLat,
              longitude: currentMeta.originLng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            <Marker
              coordinate={{
                latitude: currentMeta.originLat,
                longitude: currentMeta.originLng,
              }}
              title={currentMeta.originLabel}
              pinColor={COLORS.signalGood}
            />

            <Marker
              coordinate={{
                latitude: currentMeta.destLat,
                longitude: currentMeta.destLng,
              }}
              title={currentMeta.destLabel}
              pinColor={COLORS.signalRisk}
            />

            {decodedRoute.length > 0 && (
              <Polyline
                coordinates={decodedRoute}
                strokeColor={COLORS.accent}
                strokeWidth={4}
              />
            )}

            {/* Rail journey segments */}
            {railSegments && (
              <>
                {/* Walking path: origin → boarding station */}
                <Polyline
                  coordinates={railSegments.walkToStation}
                  strokeColor="#8B90B8"
                  strokeWidth={2}
                  lineDashPattern={[8, 6]}
                />

                {/* Rail line: boarding → alighting station */}
                <Polyline
                  coordinates={railSegments.railLine}
                  strokeColor="#4C4F9E"
                  strokeWidth={4}
                />

                {/* Walking path: alighting station → destination */}
                <Polyline
                  coordinates={railSegments.walkFromStation}
                  strokeColor="#8B90B8"
                  strokeWidth={2}
                  lineDashPattern={[8, 6]}
                />

                {/* Boarding station marker */}
                <Marker
                  coordinate={railSegments.walkToStation[1]}
                  title={board?.name}
                  description="Board here"
                >
                  <View style={{
                    backgroundColor: '#4C4F9E',
                    borderRadius: 20,
                    padding: 6,
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}>
                    <Text style={{ fontSize: 12 }}>🚉</Text>
                  </View>
                </Marker>

                {/* Alighting station marker */}
                <Marker
                  coordinate={railSegments.railLine[1]}
                  title={alight?.name}
                  description="Alight here"
                >
                  <View style={{
                    backgroundColor: '#4C4F9E',
                    borderRadius: 20,
                    padding: 6,
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}>
                    <Text style={{ fontSize: 12 }}>🚉</Text>
                  </View>
                </Marker>
              </>
            )}
          </MapView>

          <View style={styles.infoCard}>
            <View style={styles.timeRow}>
              <View>
                <Text style={styles.timeLabel}>Leave at</Text>
                <Text style={styles.timeValue}>{formatTime12h(currentTrip.recommendedLeaveTime)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={COLORS.textSecondary} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.timeLabel}>Arrive</Text>
                <Text style={styles.timeValue}>{formatTime12h(currentTrip.predictedArrivalTime)}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.detailsRow}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Travel time</Text>
                <Text style={styles.detailValue}>{formatTravelTime(currentTrip.recommendedLeaveTime, currentTrip.predictedArrivalTime)}</Text>
              </View>
              {/* Coerced to a boolean: rail routes report 0 metres, and a bare
                  0 renders as text - "Text strings must be rendered within a
                  <Text> component". */}
              {!!currentTrip.distanceMeters && !isRailTrip && (
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Distance</Text>
                  <Text style={styles.detailValue}>{formatDistance(currentTrip.distanceMeters)}</Text>
                </View>
              )}
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Confidence</Text>
                <Text style={styles.detailValue}>{Math.round(currentTrip.confidenceScore)}%</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <Pressable style={styles.navButton} onPress={handleOpenGoogleMaps}>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.navButtonText}>Google Maps</Text>
              </Pressable>
              <Pressable style={[styles.navButton, styles.wazeButton]} onPress={handleOpenWaze}>
                <Ionicons name="open-outline" size={16} color="#fff" />
                <Text style={styles.navButtonText}>Waze</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
