export function createState(config) {
  return {
    type: 'x01',
    startScore: config.startScore,
    doubleOut: config.doubleOut,
    players: config.players.map((p) => ({ id: p.id, name: p.name, score: config.startScore, turns: [] })),
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

function finishBust(state, player, message) {
  player.turns.push(0);
  state.message = message;
  advance(state);
}

export function applyDart(state, dart) {
  if (state.winnerId) return;
  if (state.currentTurn.length >= 3) return;
  state.message = '';
  state.currentTurn.push(dart);

  const player = state.players[state.currentPlayerIndex];
  const total = state.currentTurn.reduce((s, d) => s + d.value, 0);
  const remaining = player.score - total;
  const isLastDart = state.currentTurn.length === 3;

  if (remaining === 0) {
    if (!state.doubleOut || dart.mult === 2) {
      player.score = 0;
      player.turns.push(total);
      state.winnerId = player.id;
      state.message = `${player.name} gagne !`;
    } else {
      finishBust(state, player, 'Il faut finir sur un double. Tour annulé.');
    }
    return;
  }

  if (remaining < 0 || (state.doubleOut && remaining === 1)) {
    finishBust(state, player, remaining < 0 ? 'Dépassé ! Tour annulé.' : 'Bloqué à 1. Tour annulé.');
    return;
  }

  if (isLastDart) {
    player.score = remaining;
    player.turns.push(total);
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
