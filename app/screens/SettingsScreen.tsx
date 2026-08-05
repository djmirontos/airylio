import { useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView, Switch, Linking } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFavorites } from '../hooks/useFavorites';
import { useTheme } from '../context/ThemeContext';
import { captureEvent } from '../lib/posthog';

const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY!;

export default function SettingsScreen() {
  const { favorites, loaded, saveFavorite, clearFavorite } = useFavorites();
  const { colors: COLORS, isDark, toggleTheme } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute();

  // On focus rather than mount: the tab stays mounted once visited, so a mount
  // effect would fire only the first time.
  useFocusEffect(
    useCallback(() => {
      captureEvent('settings_viewed');
    }, [])
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.canvas },
    content: { paddingBottom: 32 },
    header: { paddingTop: 60, paddingHorizontal: 16, paddingBottom: 16 },
    headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: COLORS.textPrimary },
    section: { paddingHorizontal: 16, marginBottom: 24 },
    sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
    card: { backgroundColor: COLORS.card, borderRadius: 14, padding: 14, shadowColor: COLORS.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, justifyContent: 'space-between' },
    settingLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginLeft: 12, flex: 1 },
    favoriteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    favoriteLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    favoriteLabelCol: { flex: 1 },
    favoriteLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginBottom: 2 },
    favoriteValue: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary },
    clearButton: { padding: 8, marginRight: -8, minHeight: 44, minWidth: 44 },
    divider: { height: 1, backgroundColor: COLORS.divider },
    editButton: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: COLORS.accentTint, marginTop: 8, minHeight: 44 },
    editButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: COLORS.accent, textAlign: 'center' },
    emptyHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 16 },
    infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    infoRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    infoLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary },
    infoValue: { fontFamily: 'Inter_400Regular', fontSize: 13, color: COLORS.textSecondary },
    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
    linkLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: COLORS.textPrimary, marginLeft: 12, flex: 1 },
  }), [COLORS]);

  useEffect(() => {
    const params = route.params as
      | { selectedPlace?: { label: string; lat: number; lng: number }; type?: string }
      | undefined;
    if (!params?.selectedPlace) return;
    if (params.type === 'home' || params.type === 'work') {
      saveFavorite(params.type, params.selectedPlace);
    }
    navigation.setParams({ selectedPlace: undefined, type: undefined });
  }, [route.params]);

  function editFavorite(type: 'home' | 'work') {
    navigation.navigate('Search', {
      type,
      returnTo: 'SettingsMain',
      apiKey: GOOGLE_PLACES_API_KEY,
      placeholder: `Search ${type} address`,
    });
  }

  function handleClear(type: 'home' | 'work') {
    Alert.alert('Clear Favorite', `Remove ${type} from favorites?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => clearFavorite(type),
      },
    ]);
  }

  if (!loaded) {
    return <View style={styles.container} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <Ionicons name="moon" size={20} color={COLORS.accent} />
            <Text style={[styles.settingLabel, { color: COLORS.textPrimary }]}>Dark Mode</Text>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: COLORS.divider, true: COLORS.accent }}
              thumbColor="#fff"
              accessibilityLabel="Toggle dark mode"
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Favorites</Text>
        <View style={styles.card}>
          {/* Home Row */}
          <View style={styles.favoriteRow}>
            <View style={styles.favoriteLeft}>
              <Ionicons name="home" size={20} color={COLORS.accent} />
              <View style={styles.favoriteLabelCol}>
                <Text style={styles.favoriteLabel}>Home</Text>
                <Text style={styles.favoriteValue} numberOfLines={1}>
                  {favorites.home?.label || 'Not set'}
                </Text>
              </View>
            </View>
            {favorites.home && (
              <Pressable style={styles.clearButton} onPress={() => handleClear('home')} accessibilityLabel="Clear home location" accessibilityRole="button">
                <Ionicons name="close" size={18} color={COLORS.signalRisk} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => editFavorite('home')}
            accessibilityLabel={`${favorites.home ? 'Edit' : 'Set'} home location`}
            accessibilityRole="button"
          >
            <Text style={styles.editButtonText}>{favorites.home ? 'Edit' : 'Set'}</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Work Row */}
          <View style={styles.favoriteRow}>
            <View style={styles.favoriteLeft}>
              <Ionicons name="briefcase" size={20} color={COLORS.accent} />
              <View style={styles.favoriteLabelCol}>
                <Text style={styles.favoriteLabel}>Work</Text>
                <Text style={styles.favoriteValue} numberOfLines={1}>
                  {favorites.work?.label || 'Not set'}
                </Text>
              </View>
            </View>
            {favorites.work && (
              <Pressable style={styles.clearButton} onPress={() => handleClear('work')} accessibilityLabel="Clear work location" accessibilityRole="button">
                <Ionicons name="close" size={18} color={COLORS.signalRisk} />
              </Pressable>
            )}
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => editFavorite('work')}
            accessibilityLabel={`${favorites.work ? 'Edit' : 'Set'} work location`}
            accessibilityRole="button"
          >
            <Text style={styles.editButtonText}>{favorites.work ? 'Edit' : 'Set'}</Text>
          </Pressable>
        </View>
        {!favorites.home && !favorites.work && (
          <Text style={styles.emptyHint}>Tap Set to save your Home or Work location for quick access.</Text>
        )}
      </View>

      {/* Legal Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://www.airylio.com/privacy.html')}
            accessibilityLabel="View Privacy Policy"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Privacy Policy</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('https://www.airylio.com/terms.html')}
            accessibilityLabel="View Terms of Service"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="document-text-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Terms of Service</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.linkRow}
            onPress={() => Linking.openURL('mailto:support@airylio.com')}
            accessibilityLabel="Contact support"
            accessibilityRole="button"
          >
            <View style={styles.infoRowLeft}>
              <Ionicons name="mail-outline" size={20} color={COLORS.accent} />
              <Text style={styles.linkLabel}>Contact Support</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="phone-portrait-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Version</Text>
            </View>
            <Text style={styles.infoValue}>
              {Constants.expoConfig?.version ?? '1.0.0'} ({Constants.expoConfig?.android?.versionCode ?? 'N/A'})
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="business-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Developer</Text>
            </View>
            <Text style={styles.infoValue}>Airyl Tech</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <View style={styles.infoRowLeft}>
              <Ionicons name="location-outline" size={20} color={COLORS.accent} />
              <Text style={styles.infoLabel}>Built for</Text>
            </View>
            <Text style={styles.infoValue}>Philippine commuters</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

