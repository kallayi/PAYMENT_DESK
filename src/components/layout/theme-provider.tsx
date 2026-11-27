'use client';

import * as React from 'react';
import { Monitor, Sun, Moon, Check } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'payment-desk-theme';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  mounted: boolean;
  setTheme: (next: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function getSystemIsDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyThemeToDocument(pref: ThemePreference): ResolvedTheme {
  const isDark = pref === 'dark' || (pref === 'system' && getSystemIsDark());
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    const themeColor = isDark ? '#0e0e11' : '#ffffff';
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length > 0) {
      metas.forEach((meta) => {
        meta.setAttribute('content', themeColor);
        meta.removeAttribute('media');
      });
    } else {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeColor;
      document.head.appendChild(meta);
    }
  }
  return isDark ? 'dark' : 'light';
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>('light');
  const [mounted, setMounted] = React.useState<boolean>(false);

  React.useEffect(() => {
    const initial = readStoredPreference();
    setThemeState(initial);
    setResolvedTheme(applyThemeToDocument(initial));
    setMounted(true);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        const synced = readStoredPreference();
        setThemeState(synced);
        setResolvedTheme(applyThemeToDocument(synced));
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (theme === 'system') {
        setResolvedTheme(applyThemeToDocument('system'));
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemChange);
      return () => mediaQuery.removeEventListener('change', handleSystemChange);
    }

    mediaQuery.addListener(handleSystemChange);
    return () => mediaQuery.removeListener(handleSystemChange);
  }, [theme, mounted]);

  const setTheme = React.useCallback((next: ThemePreference) => {
    const resolved = applyThemeToDocument(next);
    setThemeState(next);
    setResolvedTheme(resolved);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, mounted, setTheme }),
    [theme, resolvedTheme, mounted, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

export function ThemeSegmentedControl({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { theme, mounted, setTheme } = useTheme();
  const activePref: ThemePreference = mounted ? theme : 'system';

  return (
    <div
      role="radiogroup"
      aria-label="Appearance theme"
      className={`grid grid-cols-3 p-1 rounded-xl bg-slate-100 border border-slate-200 select-none ${className}`}
    >
      {THEME_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const selected = activePref === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-pressed={selected}
            onClick={() => setTheme(opt.value)}
            className={`min-h-[38px] inline-flex items-center justify-center rounded-lg transition-all cursor-pointer touch-manipulation active:scale-[0.98] ${compact ? 'gap-1 px-2 py-1.5 text-[11px]' : 'gap-1.5 px-3 py-1.5 text-xs'
              } ${selected
                ? 'bg-brand text-white font-semibold shadow-sm'
                : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
          >
            <Icon className={compact ? 'w-3.5 h-3.5 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ThemeToggle() {
  const { theme, mounted, setTheme } = useTheme();
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const activePref: ThemePreference = mounted ? theme : 'system';
  const ActiveIcon =
    activePref === 'light' ? Sun : activePref === 'dark' ? Moon : Monitor;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Theme: ${activePref}. Switch theme`}
        aria-expanded={isOpen}
        title={`Theme: ${activePref.charAt(0).toUpperCase() + activePref.slice(1)}`}
        className="h-9 w-9 p-0 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center transition-colors cursor-pointer touch-manipulation"
      >
        <ActiveIcon className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Select color theme"
          className="absolute right-0 mt-2 w-36 rounded-xl border border-slate-200 bg-white shadow-xl py-1 z-50 animate-in fade-in-50 zoom-in-95"
        >
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = activePref === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setTheme(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer touch-manipulation ${selected
                    ? 'font-bold text-brand bg-brand-tint'
                    : 'font-medium text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{opt.label}</span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
