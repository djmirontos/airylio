import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useFavorites } from '../hooks/useFavorites';
import { RECENT_DESTINATIONS_KEY, RECENT_ORIGINS_KEY } from '../constants/config';

interface RecentDestination {
  label: string;
  lat: number;
  lng: number;
}

interface Suggestion {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface RouteParams {
  type: 'origin' | 'destination' | 'home' | 'work';
  /** Route to return the pick to: 'PlanMain' or 'SettingsMain'. */
  returnTo: string;
  apiKey: string;
  placeholder: string;
}

interface ListItem {
  id: string;
  type: 'header' | 'favorite-home' | 'favorite-work' | 'recent' | 'suggestion';
  data: any;
}

const MIN_CHARS = 1;
const DEBOUNCE_MS = 200;

export default function SearchScreen() {
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { colors: COLORS } = useTheme();
  const insets = useSafeAreaInsets();
  const { type, returnTo, apiKey, placeholder } = route.params as RouteParams;
  const { favorites } = useFavorites();

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recent, setRecent] = useState<RecentDestination[]>([]);
  const [loading, setLoading] = useState(false);
  /** Query the current `suggestions` belong to; '' when showing shortcuts. */
  const [resultsFor, setResultsFor] = useState('');
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef('');

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    // Read recents here rather than take them as a param, so every entry point
    // (origin, destination, home, work) shows the same shortcuts.
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(
          type === 'origin' ? RECENT_ORIGINS_KEY : RECENT_DESTINATIONS_KEY
        );
        if (stored) setRecent(JSON.parse(stored));
      } catch (err) {
        console.warn('[SearchScreen] Failed to load recent locations:', err);
      }
    })();
  }, [type]);

  useEffect(() => {
    // Dismiss if the user leaves the Plan tab with this open, so coming back to
    // Plan (e.g. "plan again" from History) lands on the Plan screen, not a
    // stale search. No-op when this screen is already being popped.
    const unsubscribe = navigation.addListener('blur', () => {
      if (navigation.canGoBack()) navigation.goBack();
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;

    if (trimmed.length < MIN_CHARS) {
      // Box cleared: drop results so the shortcuts come back.
      setSuggestions([]);
      setResultsFor('');
      setLoading(false);
      return;
    }

    // Note: suggestions are deliberately NOT cleared here. The previous results
    // stay on screen through the debounce and the request, so the list never
    // blanks out between keystrokes.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(trimmed), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function fetchSuggestions(text: string) {
    setLoading(true);
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify({ input: text, includedRegionCodes: ['ph'] }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Still falls through to an empty list, as before - just no longer silent.
        console.warn('[SearchScreen] Places autocomplete returned', res.status, data);
      }
      if (latestQueryRef.current !== text) return; // superseded by a newer keystroke
      setSuggestions(
        (data.suggestions ?? [])
          .filter((s: any) => s.placePrediction)
          .map((s: any) => ({
            placeId: s.placePrediction.placeId,
            mainText: s.placePrediction.structuredFormat?.mainText?.text ?? '',
            secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
          }))
      );
      setResultsFor(text);
    } catch (err) {
      console.warn('[SearchScreen] Places autocomplete request failed:', err);
      if (latestQueryRef.current !== text) return;
      setSuggestions([]);
      setResultsFor(text);
    } finally {
      if (latestQueryRef.current === text) setLoading(false);
    }
  }

  function returnWithPlace(place: { label: string; lat: number; lng: number }) {
    // popTo, not navigate: in React Navigation 7 navigate pushes a fresh copy of the
    // target instead of returning to the existing one, resetting that screen's state.
    navigation.popTo(returnTo, { selectedPlace: place, type }, { merge: true });
  }

  async function selectSuggestion(item: Suggestion) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${item.placeId}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const data = await res.json();
      if (data.location) {
        returnWithPlace({
          label: data.formattedAddress ?? item.mainText,
          lat: data.location.latitude,
          lng: data.location.longitude,
        });
      } else {
        console.warn('[SearchScreen] Place details returned no location:', item.placeId, data);
      }
    } catch (err) {
      console.warn('[SearchScreen] Place details request failed:', item.placeId, err);
    }
  }

  // Typing anything swaps the shortcuts out for Places results; clearing brings them back.
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;
  // True once the results on screen correspond to what's currently typed. Until
  // then we keep showing whatever is already there rather than an empty list.
  const resultsAreCurrent = resultsFor === trimmedQuery;
  const showShortcuts = !isSearching || (suggestions.length === 0 && !resultsAreCurrent);
  // Don't offer the favorite currently being edited as a shortcut to itself.
  const homeShortcut = type === 'home' ? null : favorites.home;
  const workShortcut = type === 'work' ? null : favorites.work;

  const items: ListItem[] = [];

  if (!showShortcuts) {
    if (suggestions.length > 0) {
      items.push({ id: 'header-suggested', type: 'header', data: 'Suggested Locations' });
      suggestions.forEach((item) => {
        items.push({ id: `suggestion-${item.placeId}`, type: 'suggestion', data: item });
      });
    }
  } else {
    if (homeShortcut || workShortcut) {
      items.push({ id: 'header-favorites', type: 'header', data: 'Favorites' });
      if (homeShortcut) items.push({ id: 'fav-home', type: 'favorite-home', data: homeShortcut });
      if (workShortcut) items.push({ id: 'fav-work', type: 'favorite-work', data: workShortcut });
    }
    if (recent.length > 0) {
      items.push({ id: 'header-recent', type: 'header', data: 'Recent' });
      recent.forEach((item, i) => {
        items.push({ id: `recent-${i}`, type: 'recent', data: item });
      });
    }
  }

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return <Text style={[styles.sectionHeader, { color: COLORS.textSecondary }]}>{item.data}</Text>;
    }
    if (item.type === 'favorite-home') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() => returnWithPlace(item.data)}
        >
          <Ionicons name="home-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]}>Home</Text>
            <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
              {item.data.label}
            </Text>
          </View>
        </Pressable>
      );
    }
    if (item.type === 'favorite-work') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() => returnWithPlace(item.data)}
        >
          <Ionicons name="briefcase-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]}>Work</Text>
            <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
              {item.data.label}
            </Text>
          </View>
        </Pressable>
      );
    }
    if (item.type === 'recent') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() => returnWithPlace(item.data)}
        >
          <Ionicons name="time-outline" size={18} color={COLORS.textSecondary} />
          <Text style={[styles.itemSub, { color: COLORS.textSecondary, flex: 1 }]} numberOfLines={2}>
            {item.data.label}
          </Text>
        </Pressable>
      );
    }
    if (item.type === 'suggestion') {
      return (
        <Pressable
          style={[styles.item, { borderBottomColor: COLORS.divider }]}
          onPress={() => selectSuggestion(item.data)}
        >
          <Ionicons name="location-outline" size={18} color={COLORS.accent} />
          <View style={styles.itemTextCol}>
            <Text style={[styles.itemTitle, { color: COLORS.textPrimary }]} numberOfLines={1}>
              {item.data.mainText}
            </Text>
            {!!item.data.secondaryText && (
              <Text style={[styles.itemSub, { color: COLORS.textSecondary }]} numberOfLines={1}>
                {item.data.secondaryText}
              </Text>
            )}
          </View>
        </Pressable>
      );
    }
    return null;
  };

  const renderEmpty = () => {
    // Mid-request with nothing to fall back on: stay blank, the header spinner
    // is the only signal. Never flash a message that contradicts what's typed.
    let message: string | null = null;
    if (isSearching && resultsAreCurrent && suggestions.length === 0) {
      message = 'No results found';
    } else if (!isSearching) {
      message = 'Start typing to search';
    }
    if (!message) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: COLORS.textSecondary }]}>{message}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.container, { backgroundColor: COLORS.canvas }]}>
      <View style={[styles.header, { borderBottomColor: COLORS.divider, paddingTop: insets.top }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textSecondary}
          style={[styles.searchInput, { color: COLORS.textPrimary }]}
        />
        {/* Inline, so the list below never has to make room for a spinner. */}
        <ActivityIndicator
          size="small"
          color={COLORS.accent}
          animating={loading}
          style={[styles.headerSpinner, !loading && styles.headerSpinnerHidden]}
        />
      </View>

      <FlatList
        style={styles.list}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1 },
  backBtn: { padding: 8, marginRight: 8 },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 12,
  },
  // Reserves its slot whether or not it is spinning, so the input never shifts.
  headerSpinner: { width: 20, marginLeft: 4 },
  headerSpinnerHidden: { opacity: 0 },
  list: { flex: 1 },
  emptyContainer: { paddingTop: 48, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  itemTextCol: { flex: 1 },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  itemSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
});
