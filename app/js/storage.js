const KEYS = {
  ROSTER: 'flechettes_roster_v1',
  GAME: 'flechettes_game_v1',
};

export function loadRoster() {
  try {
    const raw = localStorage.getItem(KEYS.ROSTER);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRoster(names) {
  try {
    localStorage.setItem(KEYS.ROSTER, JSON.stringify(names));
  } catch {
    /* storage unavailable, ignore */
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEYS.GAME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(session) {
  try {
    localStorage.setItem(KEYS.GAME, JSON.stringify(session));
  } catch {
    /* storage unavailable, ignore */
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEYS.GAME);
  } catch {
    /* storage unavailable, ignore */
  }
}
