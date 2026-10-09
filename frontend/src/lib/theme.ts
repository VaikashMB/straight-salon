// Light/dark theme choice (05 §2). "system" follows prefers-color-scheme through CSS; "light" and
// "dark" are pinned with <html data-theme>. The choice is a per-browser convenience kept in
// localStorage, so every access is guarded (private windows and blocked storage throw).

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'ss-theme';
const CHANGE_EVENT = 'ss-theme-change';
export const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

const isPinned = (value: unknown): value is 'light' | 'dark' =>
  value === 'light' || value === 'dark';

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPinned(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (isPinned(preference)) root.dataset.theme = preference;
  else delete root.dataset.theme;
  try {
    if (isPinned(preference)) window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    else window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Not persisted; the choice still applies to this page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// For useSyncExternalStore: changes from this tab (CHANGE_EVENT) and from other tabs (storage).
// A change in another tab also re-applies the attribute here, so open tabs stay in step.
export function subscribeToThemePreference(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const preference = readThemePreference();
    if (isPinned(preference)) document.documentElement.dataset.theme = preference;
    else delete document.documentElement.dataset.theme;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system';
}

// Runs in <head> before the first paint, so a pinned theme never flashes the other one.
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}})()`;
