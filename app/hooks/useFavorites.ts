import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect } from 'react';

export interface FavoritePlace {
  label: string;
  lat: number;
  lng: number;
}

export interface Favorites {
  home: FavoritePlace | null;
  work: FavoritePlace | null;
}

const FAVORITES_KEY = 'airylio:favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorites>({ home: null, work: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(FAVORITES_KEY);
        if (stored) setFavorites(JSON.parse(stored));
      } catch {}
      setLoaded(true);
    })();
  }, []);

  async function saveFavorite(type: 'home' | 'work', place: FavoritePlace) {
    const updated = { ...favorites, [type]: place };
    setFavorites(updated);
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    } catch {}
  }

  async function clearFavorite(type: 'home' | 'work') {
    const updated = { ...favorites, [type]: null };
    setFavorites(updated);
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(updated));
    } catch {}
  }

  return { favorites, loaded, saveFavorite, clearFavorite };
}
