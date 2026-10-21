export type ThemeChoice = 'light' | 'dark' | 'system';

const THEME_KEY = 'itsm.theme';

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies the choice to <html data-theme> ('system' removes the override). */
export function applyTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // per-viewer convenience only
  }
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}
