import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FavoritePlace } from '../hooks/useFavorites';

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

interface Props {
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

const MIN_CHARS = 2;
const DEBOUNCE_MS = 200;

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
  suggestedLabel = 'Suggested Locations',
  autoFocus = false,
  colors,
  favorites,
}: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: winWidth } = useWindowDimensions();

  useEffect(() => {
    if (autoFocus) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (query.length < MIN_CHARS) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      console.log('[Dropdown] keyboardDidShow event, re-measuring after 100ms');
      setTimeout(measureDropdown, 100);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    console.log('[Dropdown] focused changed:', focused, 'dropdownPos:', dropdownPos);
  }, [focused, dropdownPos]);

  function measureDropdown() {
    console.log('[Dropdown] measureDropdown called');
    [0, 100, 300].forEach(delay => {
      setTimeout(() => {
        containerRef.current?.measureInWindow((x, y, w, h) => {
          console.log('[Dropdown] measureInWindow result:', { x, y, width: w, height: h, delay, valid: w > 0 && h > 0 });
          if (w > 0 && h > 0) {
            const newPos = { top: y + h + 4, left: x, width: w };
            console.log('[Dropdown] Setting dropdownPos:', newPos);
            setDropdownPos(newPos);
          } else {
            console.warn('[Dropdown] Invalid dimensions:', { w, h });
          }
        });
      }, delay);
    });
  }

  async function fetchSuggestions(text: string) {
    setLoading(true);
    console.log('Searching for:', text);
    console.log('API Key exists:', !!apiKey);
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
      console.log('Autocomplete status:', res.status);
      const data = await res.json();
      console.log('Autocomplete response:', JSON.stringify(data, null, 2));
      if (!res.ok) throw new Error(JSON.stringify(data));
      setSuggestions(
        (data.suggestions ?? [])
          .filter((s: any) => s.placePrediction)
          .map((s: any) => ({
            placeId: s.placePrediction.placeId,
            mainText: s.placePrediction.structuredFormat?.mainText?.text ?? '',
            secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
          }))
      );
    } catch (err) {
      console.log('Autocomplete error:', err);
      setSuggestions([]);
    }
    finally { setLoading(false); }
  }

  async function selectSuggestion(item: Suggestion) {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${item.placeId}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const data = await res.json();
      if (data.location) {
        onSelect({ label: data.formattedAddress ?? item.mainText, lat: data.location.latitude, lng: data.location.longitude });
        closeDropdown();
      }
    } catch {}
  }

  function closeDropdown() {
    console.log('[Dropdown] closeDropdown called');
    setQuery('');
    setSuggestions([]);
    setFocused(false);
    onFocusChange?.(false);
  }

  function handleFocus() {
    console.log('[Dropdown] handleFocus called');
    if (blurRef.current) clearTimeout(blurRef.current);
    setFocused(true);
    onFocusChange?.(true);
    setTimeout(() => {
      console.log('[Dropdown] handleFocus: measuring after 100ms');
      measureDropdown();
    }, 100);
  }

  function handleBlur() {
    blurRef.current = setTimeout(() => {
      setFocused(false);
      onFocusChange?.(false);
    }, 500);
  }

  const hasFavorites = !!(favorites?.home || favorites?.work);
  const hasRecent = recentDestinations.length > 0;
  const showSuggestions = query.length >= MIN_CHARS;

  return (
    <View ref={containerRef} style={styles.root} collapsable={false}>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.textPrimary }]}
        />
        {query.length > 0 && (
          <Pressable onPress={() => { setQuery(''); setSuggestions([]); inputRef.current?.focus(); }} style={styles.clearBtn}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {focused && console.log('[Dropdown] Modal rendering:', { focused, dropdownPos, winWidth, hasWidth: dropdownPos.width > 0, top: dropdownPos.top, left: dropdownPos.width > 0 ? dropdownPos.left : 16, width: dropdownPos.width > 0 ? dropdownPos.width : winWidth - 32 })}
      <Modal visible={focused} transparent animationType="none" onRequestClose={closeDropdown}>
        <View style={{ flex: 1 }} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDropdown} />
          <View style={[styles.dropdown, {
            top: dropdownPos.top,
            left: 16,
            width: winWidth - 32,
            backgroundColor: colors.card,
            borderColor: colors.divider,
          }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces={false}
          >
            {!showSuggestions ? (
              <>
                {hasFavorites && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Favorites</Text>
                    {favorites?.home && (
                      <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: favorites.home!.label, lat: favorites.home!.lat, lng: favorites.home!.lng }); closeDropdown(); }}>
                        <Ionicons name="home-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>Home</Text>
                          <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{favorites.home.label}</Text>
                        </View>
                      </Pressable>
                    )}
                    {favorites?.work && (
                      <Pressable style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: favorites.work!.label, lat: favorites.work!.lat, lng: favorites.work!.lng }); closeDropdown(); }}>
                        <Ionicons name="briefcase-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]}>Work</Text>
                          <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{favorites.work.label}</Text>
                        </View>
                      </Pressable>
                    )}
                  </>
                )}
                {hasRecent && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>Recent</Text>
                    {recentDestinations.map((item) => (
                      <Pressable key={item.label} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => { onSelect({ label: item.label, lat: item.lat, lng: item.lng }); closeDropdown(); }}>
                        <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                        <Text style={[styles.itemSub, { color: colors.textSecondary, flex: 1 }]} numberOfLines={2}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
                {!hasFavorites && !hasRecent && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Start typing to search</Text>
                )}
              </>
            ) : (
              <>
                {loading && <ActivityIndicator size="small" color={colors.accent} style={{ paddingVertical: 16 }} />}
                {!loading && suggestions.length === 0 && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No results found</Text>
                )}
                {suggestions.length > 0 && (
                  <>
                    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{suggestedLabel}</Text>
                    {suggestions.map((item) => (
                      <Pressable key={item.placeId} style={[styles.item, { borderBottomColor: colors.divider }]} onPress={() => selectSuggestion(item)}>
                        <Ionicons name="location-outline" size={18} color={colors.accent} />
                        <View style={styles.itemTextCol}>
                          <Text style={[styles.itemTitle, { color: colors.textPrimary }]} numberOfLines={1}>{item.mainText}</Text>
                          {!!item.secondaryText && <Text style={[styles.itemSub, { color: colors.textSecondary }]} numberOfLines={1}>{item.secondaryText}</Text>}
                        </View>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, height: 22, fontSize: 15, fontFamily: 'Inter_500Medium', padding: 0, margin: 0 },
  clearBtn: { padding: 4, marginLeft: 4 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  dropdown: {
    position: 'absolute',
    maxHeight: 360,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  itemTextCol: { flex: 1, justifyContent: 'center' },
  itemTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 18 },
  itemSub: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 16, marginTop: 3 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingVertical: 24, paddingHorizontal: 16 },
});
