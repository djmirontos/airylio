import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FavoritePlace } from '../hooks/useFavorites';
import { DROPDOWN_MAX_HEIGHT } from '../constants/config';

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

interface SelectedPlace {
  label: string;
  lat: number;
  lng: number;
}

interface DestinationAutocompleteProps {
  apiKey: string;
  recentDestinations: RecentDestination[];
  onSelect: (place: SelectedPlace) => void;
  onFocusChange?: (focused: boolean) => void;
  placeholder?: string;
  suggestedLabel?: string;
  autoFocus?: boolean;
  colors: {
    accent: string;
    textPrimary: string;
    textSecondary: string;
    divider: string;
    card: string;
    signalRisk: string;
    ink: string;
  };
  favorites?: { home: FavoritePlace | null; work: FavoritePlace | null };
}

const MIN_CHARS_TO_FETCH = 2;
const DEBOUNCE_MS = 300;

function generateSessionToken(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function DestinationAutocomplete({
  apiKey,
  recentDestinations,
  onSelect,
  onFocusChange,
  placeholder = 'Search destination',
  suggestedLabel = 'Suggested Destinations',
  autoFocus = false,
  colors,
  favorites,
}: DestinationAutocompleteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const sessionToken = useRef(generateSessionToken());
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownLeft, setDropdownLeft] = useState(0);
  const [dropdownWidth, setDropdownWidth] = useState(0);
  const containerRef = useRef<View>(null);
  const { width: windowWidth } = useWindowDimensions();

  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, []);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < MIN_CHARS_TO_FETCH) {
      setSuggestions([]);
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    measureDropdownPosition();
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  async function fetchSuggestions(text: string) {
    setLoading(true);
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          input: text,
          includedRegionCodes: ['ph'],
          sessionToken: sessionToken.current,
        }),
      });
      const data = await response.json();
      const results: Suggestion[] = (data.suggestions ?? [])
        .filter((s: any) => s.placePrediction)
        .map((s: any) => ({
          placeId: s.placePrediction.placeId,
          mainText: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text?.text ?? '',
          secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
        }));
      setSuggestions(results);
    } catch {
      // Non-critical: a failed autocomplete fetch just means no live suggestions;
      // Recent destinations below still work.
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectSuggestion(item: Suggestion) {
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${item.placeId}`,
        {
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'location,formattedAddress',
          },
        }
      );
      const data = await response.json();
      if (data.location) {
        const label = data.formattedAddress ?? `${item.mainText}, ${item.secondaryText}`;
        onSelect({ label, lat: data.location.latitude, lng: data.location.longitude });
        setQuery('');
        setSuggestions([]);
        sessionToken.current = generateSessionToken();
      }
    } catch {
      // If details fail, do nothing - user can try another suggestion.
    }
  }

  function handleSelectRecent(item: RecentDestination) {
    onSelect({ label: item.label, lat: item.lat, lng: item.lng });
    setQuery('');
    setSuggestions([]);
  }

  function handleFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setFocused(true);
    onFocusChange?.(true);
    measureDropdownPosition();
  }

  function handleBlur() {
    // Delay so a tap on a list row registers before the dropdown disappears.
    blurTimer.current = setTimeout(() => {
      setFocused(false);
      onFocusChange?.(false);
    }, 250);
  }

  function measureDropdownPosition() {
    setTimeout(() => {
      containerRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0) {
          setDropdownTop(y + height + 4);
          setDropdownLeft(x);
          setDropdownWidth(width);
        }
      });
    }, 50);
  }

  const hasFavorites = !!(favorites?.home || favorites?.work);
  const hasRecent = recentDestinations.length > 0;
  const showDropdown = focused;
  const showSuggestedSection = query.length >= MIN_CHARS_TO_FETCH && suggestions.length > 0;
  const showRecentSection = hasRecent;
  const showFavoritesSection = hasFavorites;

  return (
    <View ref={containerRef} style={{ position: 'relative' }} onLayout={measureDropdownPosition}>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { flex: 1, color: colors.textPrimary }]}
        />
        {query.length > 0 && (
          <Pressable
            style={styles.clearButton}
            onPress={() => {
              setQuery('');
              setSuggestions([]);
              inputRef.current?.focus();
            }}
            accessibilityLabel="Clear input"
          >
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <Modal
        visible={showDropdown}
        transparent
        animationType="none"
        onRequestClose={() => {
          setFocused(false);
          onFocusChange?.(false);
        }}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setFocused(false);
            onFocusChange?.(false);
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: dropdownTop,
              left: dropdownLeft > 0 ? dropdownLeft : 16,
              width: dropdownWidth > 0 ? dropdownWidth : windowWidth - 32,
              maxHeight: DROPDOWN_MAX_HEIGHT,
              backgroundColor: colors.card,
              borderRadius: 16,
              shadowColor: colors.ink,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.14,
              shadowRadius: 20,
              elevation: 24,
              overflow: 'hidden',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {!query ? (
                <>
                  {showFavoritesSection && (
                    <>
                      <Text style={[styles.sectionHeader, { color: colors.textPrimary }]}>
                        Favorites
                      </Text>
                      {favorites?.home && (
                        <Pressable
                          style={[styles.favoriteShortcut, { borderBottomColor: colors.divider }]}
                          onPress={() => {
                            onSelect({ label: favorites.home!.label, lat: favorites.home!.lat, lng: favorites.home!.lng });
                            setFocused(false);
                          }}
                        >
                          <Ionicons name="home" size={16} color={colors.accent} />
                          <Text style={[styles.favoriteShortcutText, { color: colors.textPrimary }]}>Home</Text>
                        </Pressable>
                      )}
                      {favorites?.work && (
                        <Pressable
                          style={[styles.favoriteShortcut, { borderBottomColor: colors.divider }]}
                          onPress={() => {
                            onSelect({ label: favorites.work!.label, lat: favorites.work!.lat, lng: favorites.work!.lng });
                            setFocused(false);
                          }}
                        >
                          <Ionicons name="briefcase" size={16} color={colors.accent} />
                          <Text style={[styles.favoriteShortcutText, { color: colors.textPrimary }]}>Work</Text>
                        </Pressable>
                      )}
                    </>
                  )}

                  {showFavoritesSection && showRecentSection && <View style={styles.sectionGap} />}

                  {showRecentSection && (
                    <>
                      <Text style={[styles.sectionHeaderMuted, { color: colors.textSecondary }]}>
                        Recent
                      </Text>
                      {recentDestinations.map((item) => (
                        <Pressable
                          key={item.label}
                          style={[styles.row, { borderBottomColor: colors.divider }]}
                          onPress={() => {
                            handleSelectRecent(item);
                            setFocused(false);
                          }}
                        >
                          <View style={styles.recentRowInner}>
                            <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                            <Text
                              style={[styles.rowMainMuted, { color: colors.textSecondary }]}
                              numberOfLines={2}
                            >
                              {item.label}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </>
                  )}

                  {!showFavoritesSection && !showRecentSection && (
                    <View style={{ padding: 16, alignItems: 'center' }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 13, fontFamily: 'Inter_400Regular' }}>
                        Start typing to search
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  {loading && query.length >= MIN_CHARS_TO_FETCH && (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={colors.accent} />
                    </View>
                  )}
                  {showSuggestedSection && (
                    <>
                      <Text style={[styles.sectionHeader, { color: colors.textPrimary }]}>
                        {suggestedLabel}
                      </Text>
                      {suggestions.map((item) => (
                        <Pressable
                          key={item.placeId}
                          style={[styles.row, { borderBottomColor: colors.divider }]}
                          onPress={() => {
                            handleSelectSuggestion(item);
                            setFocused(false);
                          }}
                        >
                          <Text style={[styles.rowMain, { color: colors.textPrimary }]} numberOfLines={1}>
                            {item.mainText}
                          </Text>
                          {!!item.secondaryText && (
                            <Text style={[styles.rowSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
                              {item.secondaryText}
                            </Text>
                          )}
                        </Pressable>
                      ))}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    height: 22,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    padding: 0,
    margin: 0,
  },
  clearButton: { padding: 4, marginLeft: 4 },
  loadingRow: { paddingVertical: 12, alignItems: 'center' },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sectionHeaderMuted: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  sectionGap: { height: 8 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  rowMain: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  rowSecondary: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  rowMainMuted: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  recentRowInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  favoriteShortcut: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  favoriteShortcutText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
