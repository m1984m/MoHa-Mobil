const KEY = 'mmob-theme';
export type Theme = 'light' | 'dark' | 'auto' | 'contrast' | 'mono';

const THEME_CLASSES = ['dark', 'contrast', 'mono'] as const;

function resolveClass(t: Theme): typeof THEME_CLASSES[number] | null {
  if (t === 'contrast' || t === 'mono') return t;
  if (t === 'dark') return 'dark';
  if (t === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : null;
  return null; // light
}

export function applyTheme(t: Theme) {
  const cls = resolveClass(t);
  const root = document.documentElement;
  for (const c of THEME_CLASSES) root.classList.toggle(c, cls === c);
  localStorage.setItem(KEY, t);
}

export function initTheme(): Theme {
  const stored = localStorage.getItem(KEY) as Theme | null;
  const valid: Theme[] = ['light', 'dark', 'auto', 'contrast', 'mono'];
  const t: Theme = (stored && valid.includes(stored)) ? stored : 'light';
  applyTheme(t);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(KEY) as Theme) === 'auto') applyTheme('auto');
  });
  return t;
}
