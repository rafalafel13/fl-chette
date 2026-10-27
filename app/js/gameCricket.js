export const NUMBERS = [20, 19, 18, 17, 16, 15, 25];

export function createState(config) {
  return {
    type: 'cricket',
    numbers: NUMBERS,
    players: config.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: 0,
      marks: Object.fromEntries(NUMBERS.map((n) => [n, 0])),
    })),
    currentPlayerIndex: 0,
    currentTurn: [],
    winnerId: null,
    message: '',
  };
}

function advance(state) {
  state.currentTurn = [];
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
}

export function applyDart(state, dart) {
  if (state.winnerId) return;
  if (state.currentTurn.length >= 3) return;
  state.message = '';
  state.currentTurn.push(dart);

  const player = state.players[state.currentPlayerIndex];
  const seg = dart.segment;

  if (!NUMBERS.includes(seg)) {
    state.message = "Ça ne compte pas au cricket.";
  } else {
    const before = player.marks[seg];
    const after = Math.min(3, before + dart.mult);
    const applied = after - before;
    const overflow = dart.mult - applied;
    player.marks[seg] = after;

    if (overflow > 0) {
      const others = state.players.filter((p) => p.id !== player.id);
      const allClosed = others.length > 0 && others.every((p) => p.marks[seg] >= 3);
      if (!allClosed) {
        player.score += (seg === 25 ? 25 : seg) * overflow;
      }
    }

    const closedAll = NUMBERS.every((n) => player.marks[n] >= 3);
    if (closedAll) {
      const leads = state.players.every((p) => p.score <= player.score);
      if (leads) {
        state.winnerId = player.id;
        state.message = `${player.name} gagne !`;
      }
    }
  }

  if (!state.winnerId && state.currentTurn.length >= 3) {
    advance(state);
  }
}

export function rebuild(config, history) {
  const state = createState(config);
  for (const dart of history) {
    if (state.winnerId) break;
    applyDart(state, dart);
  }
  return state;
}
