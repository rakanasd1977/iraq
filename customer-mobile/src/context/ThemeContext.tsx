import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { load, save } from '../store';
import type { ThemeContextValue } from '../types';

const THEME_KEY = 'theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitial(): 'dark' | 'light' {
  const stored = load<'dark' | 'light' | ''>(THEME_KEY, '');
  if (stored === 'dark' || stored === 'light') return stored;
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save(THEME_KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
