import { createContext, useContext, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';

const THEME_KEY = 'airylio:darkMode';

export const LIGHT_COLORS = {
  ink: '#12153D',
  accent: '#4C4F9E',
  accentTint: 'rgba(76,79,158,0.07)',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
  canvas: '#FAFAFC',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B6F8A',
  divider: '#E7E7F1',
  resultHero: '#12153D',
  resultHeroText: '#FFFFFF',
  resultBody: '#FFFFFF',
};

export const DARK_COLORS = {
  ink: '#E8EAFF',
  accent: '#7B7FD4',
  accentTint: 'rgba(123,127,212,0.15)',
  signalGood: '#12B886',
  signalWarn: '#F5A623',
  signalRisk: '#E85D51',
  canvas: '#0F1020',
  card: '#1A1D35',
  textPrimary: '#E8EAFF',
  textSecondary: '#8B90B8',
  divider: '#2A2D4A',
  resultHero: '#0A0C1E',
  resultHeroText: '#FFFFFF',
  resultBody: '#1A1D35',
};

type Colors = typeof LIGHT_COLORS;

interface ThemeContextValue {
  isDark: boolean;
  colors: Colors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors: LIGHT_COLORS,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(val => {
      if (val === 'true') setIsDark(true);
    });
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    AsyncStorage.setItem(THEME_KEY, String(next));
  }

  return (
    <ThemeContext.Provider value={{ isDark, colors: isDark ? DARK_COLORS : LIGHT_COLORS, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
