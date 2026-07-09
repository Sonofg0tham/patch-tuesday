// localStorage persistence: the best rating earned on each named scenario, and
// a short history of recent runs. No accounts, no backend, one key. Every read
// is defensive: corrupt or absent data yields a clean empty store rather than a
// crash, because a broken save must never stop a new incident from starting.

import { RATING_RANK, type Rating } from '../sim/pir';

const KEY = 'patch-tuesday:v1';
const HISTORY_CAP = 20;

export interface RunHistoryEntry {
  scenarioId: string;
  scenarioName: string;
  seed: string;
  rating: Rating;
  blastPct: number;
  turns: number;
  won: boolean;
  /** The run was walked away from: recorded in history, never a best. */
  abandoned?: boolean;
}

interface Store {
  bestByScenario: Record<string, Rating>;
  history: RunHistoryEntry[];
}

const RATINGS = new Set(Object.keys(RATING_RANK));

function empty(): Store {
  return { bestByScenario: {}, history: [] };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Store>;
    const best: Record<string, Rating> = {};
    for (const [id, r] of Object.entries(parsed.bestByScenario ?? {})) {
      if (typeof r === 'string' && RATINGS.has(r)) best[id] = r as Rating;
    }
    const history = Array.isArray(parsed.history)
      ? parsed.history.filter((e): e is RunHistoryEntry => Boolean(e) && RATINGS.has(e.rating)).slice(0, HISTORY_CAP)
      : [];
    return { bestByScenario: best, history };
  } catch {
    return empty();
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked (private mode): a lost save is not fatal.
  }
}

// Records a finished run: updates the scenario's best rating if this one beat
// it, and prepends it to the capped history. Returns the updated store.
export function recordRun(entry: RunHistoryEntry): Store {
  const store = load();
  // Abandoned runs are recorded in history but never count as a best: you get
  // no credit for walking away.
  if (!entry.abandoned) {
    const prev = store.bestByScenario[entry.scenarioId];
    if (!prev || RATING_RANK[entry.rating] > RATING_RANK[prev]) {
      store.bestByScenario[entry.scenarioId] = entry.rating;
    }
  }
  store.history = [entry, ...store.history].slice(0, HISTORY_CAP);
  save(store);
  return store;
}

export function bestFor(scenarioId: string): Rating | null {
  return load().bestByScenario[scenarioId] ?? null;
}

export function recentRuns(limit = 6): RunHistoryEntry[] {
  return load().history.slice(0, limit);
}
