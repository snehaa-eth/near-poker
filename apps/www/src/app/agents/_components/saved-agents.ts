/** Per-browser convenience list of agents this browser created (id, name, owner token). */
export type SavedAgent = { id: string; name: string; token: string };
const KEY = 'darktable.hostedAgents';

export function loadSavedAgents(): SavedAgent[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as SavedAgent[]).filter((a) => a && a.id && a.token) : [];
  } catch {
    return [];
  }
}

export function saveAgent(a: SavedAgent) {
  try {
    const list = loadSavedAgents().filter((x) => x.id !== a.id);
    window.localStorage.setItem(KEY, JSON.stringify([a, ...list].slice(0, 20)));
  } catch {
    /* private mode: ignore */
  }
}

export function forgetAgent(id: string) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(loadSavedAgents().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}
