const HISTORY_KEY = 'flechettes_history_v1';
const MAX_HISTORY = 300;

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable, ignore */
  }
}

export function recordGame(entry) {
  const history = loadHistory();
  history.push(entry);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  saveHistory(history);
}

export function allPlayerNames() {
  const names = new Set();
  for (const g of loadHistory()) {
    for (const p of g.players) names.add(p.name);
  }
  return Array.from(names);
}

// Aggregates a player's X01 3-dart average, optionally limited to their
// `limit` most recent X01 games (by date). Average = mean of all recorded
// turn totals across those games (not an average-of-averages, so games
// with more turns are weighted correctly).
export function x01StatsForPlayer(name, limit) {
  const games = loadHistory()
    .filter((g) => g.gameType === 'x01' && g.players.some((p) => p.name === name))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit || Infinity);

  let turnsSum = 0;
  let turnsCount = 0;
  let wins = 0;
  for (const g of games) {
    const p = g.players.find((pl) => pl.name === name);
    if (!p) continue;
    if (p.won) wins += 1;
    for (const t of p.turns) {
      turnsSum += t;
      turnsCount += 1;
    }
  }

  return {
    gamesPlayed: games.length,
    wins,
    average: turnsCount > 0 ? turnsSum / turnsCount : null,
  };
}

// Montante is a simple manual log: date + dart count the player reports
// after playing. Returns entries newest-first, optionally capped to `limit`.
export function montanteEntriesForPlayer(name, limit) {
  return loadHistory()
    .filter((g) => g.gameType === 'montante' && g.players.some((p) => p.name === name))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit || Infinity)
    .map((g) => ({ date: g.date, darts: g.players.find((p) => p.name === name).darts }));
}
