const KEY = 'mmob-theme';
export type Theme = 'light' | 'dark' | 'auto';

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(KEY, t);
}

export function initTheme(): Theme {
  const t = (localStorage.getItem(KEY) as Theme | null) ?? 'auto';
  applyTheme(t);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(KEY) as Theme) === 'auto') applyTheme('auto');
  });
  return t;
}
