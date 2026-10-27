import { loadRoster, saveRoster, loadGame, saveGame, clearGame } from './storage.js';
import { VoiceInput, parseDarts } from './voice.js';
import { suggestCheckout } from './checkout.js';
import * as X01 from './gameX01.js';
import * as Cricket from './gameCricket.js';
import * as Stats from './stats.js';

const GAME_MODULES = { x01: X01, cricket: Cricket };
const GAME_VIEW = { x01: 'game-x01', cricket: 'game-cricket' };

const root = document.getElementById('app');
const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

let roster = loadRoster(); // string[] of previously used player names
let setupPlayers = []; // [{id, name}] chosen for the next game
let pendingGameKind = null; // 'x01' | 'cricket'
let pendingX01Settings = { startScore: 301, doubleOut: false };

let session = loadGame(); // { kind, config, history, recorded } | null
let view = session ? GAME_VIEW[session.kind] : 'home';
if (view !== 'home') {
  history.pushState({ inApp: true }, '');
}
let montanteName = roster[0] || '';

let inputMode = 'manual';
let manualMult = 1;
let voiceEnabled = true;
let speechInput = null;
let listening = false;
// Hands-free mode: once the mic is switched on, recognition restarts by
// itself after each phrase (and after the app finishes speaking) until the
// player switches it off, leaves the game, or the game ends.
let handsFree = false;
let appSpeaking = false;
let restartTimer = null;
let lastTranscript = '';

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function deriveState() {
  if (!session) return null;
  return GAME_MODULES[session.kind].rebuild(session.config, session.history);
}

function persistSession() {
  if (session) saveGame(session);
  else clearGame();
}

function recordGameHistoryIfFinished(state) {
  if (!session || !state.winnerId || session.recorded) return;
  session.recorded = true;

  const base = { id: uid(), date: new Date().toISOString(), gameType: session.kind };
  if (session.kind === 'x01') {
    Stats.recordGame({
      ...base,
      config: { startScore: state.startScore, doubleOut: state.doubleOut },
      players: state.players.map((p) => ({ name: p.name, won: p.id === state.winnerId, turns: p.turns })),
    });
  } else if (session.kind === 'cricket') {
    Stats.recordGame({
      ...base,
      players: state.players.map((p) => ({ name: p.name, won: p.id === state.winnerId, score: p.score })),
    });
  }
}

function speak(text) {
  if (!voiceEnabled || !text || !('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 1.05;
    // Keep the mic off while the app talks, otherwise it hears itself.
    const done = () => {
      appSpeaking = false;
      scheduleRestart();
    };
    u.onend = done;
    u.onerror = done;
    // Some Android voices never fire onend: don't leave the mic off forever.
    setTimeout(() => appSpeaking && done(), 2000 + text.length * 90);
    appSpeaking = true;
    speechInput?.stop();
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    appSpeaking = false;
  }
}

function canListen() {
  if (!handsFree || !session || inputMode !== 'voice' || !GAME_VIEW[session.kind] || view !== GAME_VIEW[session.kind]) return false;
  const state = deriveState();
  return !!state && !state.winnerId;
}

function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!listening && !appSpeaking && canListen()) speechInput?.start();
  }, 300);
}

function stopHandsFree() {
  handsFree = false;
  clearTimeout(restartTimer);
  speechInput?.stop();
}

// In a multi-player game, says whose turn it is when the turn moves on.
function turnAnnouncement(before, after) {
  if (after.winnerId || after.players.length < 2 || before.currentPlayerIndex === after.currentPlayerIndex) return '';
  const next = after.players[after.currentPlayerIndex];
  return session.kind === 'x01' ? `À ${next.name}, il reste ${next.score}.` : `À ${next.name}.`;
}

function joinSpoken(...parts) {
  return parts.filter(Boolean).join('. ');
}

function dartLabel(d) {
  if (d.segment === 0) return 'Raté';
  if (d.segment === 25) return d.mult === 2 ? 'D-Bull' : 'Bull';
  if (d.mult === 3) return `T${d.segment}`;
  if (d.mult === 2) return `D${d.segment}`;
  return `${d.segment}`;
}

function dartSpokenLabel(d) {
  if (d.segment === 0) return 'raté';
  if (d.segment === 25) return d.mult === 2 ? 'double bull' : 'bull';
  if (d.mult === 3) return `triple ${d.segment}`;
  if (d.mult === 2) return `double ${d.segment}`;
  return `${d.segment}`;
}

function turnTotal(state) {
  return state.currentTurn.reduce((s, d) => s + d.value, 0);
}

function pushDart(dart) {
  if (!session) return;
  const before = deriveState();
  if (before.winnerId || before.currentTurn.length >= 3) return;
  session.history.push(dart);
  const after = deriveState();
  recordGameHistoryIfFinished(after);
  persistSession();
  if (after.winnerId) stopHandsFree();
  speak(joinSpoken(after.message, turnAnnouncement(before, after)));
  render();
}

function handleVoiceFinalTranscript(text) {
  lastTranscript = text;
  if (!session) {
    render();
    return;
  }
  if (/\bannul/i.test(text)) {
    if (session.history.length > 0) {
      const removed = session.history.pop();
      persistSession();
      speak(`Annulé : ${dartSpokenLabel(removed)}`);
    }
    render();
    return;
  }
  const before = deriveState();
  const darts = parseDarts(text);
  if (darts.length === 0) {
    speak("Je n'ai pas compris, réessaie ou utilise le clavier.");
    render();
    return;
  }
  const spokenParts = [];
  for (const d of darts) {
    const state = deriveState();
    if (state.winnerId || state.currentTurn.length >= 3) break;
    session.history.push(d);
    spokenParts.push(dartSpokenLabel(d));
  }
  const finalState = deriveState();
  recordGameHistoryIfFinished(finalState);
  persistSession();
  if (finalState.winnerId) stopHandsFree();
  speak(joinSpoken(spokenParts.join(', '), finalState.message, turnAnnouncement(before, finalState)));
  render();
}

function ensureSpeechInput() {
  if (speechInput) return;
  speechInput = new VoiceInput({
    onResult: ({ finalText, isFinal }) => {
      if (isFinal && finalText) handleVoiceFinalTranscript(finalText);
    },
    onListeningChange: (isListening) => {
      listening = isListening;
      if (!isListening) scheduleRestart();
      render();
    },
    onError: (error) => {
      listening = false;
      // Mic refused: stop retrying instead of looping on the error.
      if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') handsFree = false;
      render();
    },
  });
}

function toggleListen() {
  ensureSpeechInput();
  if (!speechInput.supported) {
    alert("La reconnaissance vocale n'est pas disponible sur ce navigateur. Essaie avec Chrome, ou utilise le mode manuel.");
    return;
  }
  if (handsFree) {
    stopHandsFree();
  } else {
    handsFree = true;
    speechInput.start();
  }
  render();
}

// Android's system back gesture only knows how to navigate "back" if the
// WebView has browser history to pop; since this app is a single page that
// just swaps `view` and re-renders, there was nothing to pop and the
// gesture fell through to closing the app. These two helpers push one
// history entry whenever we leave the home screen, and pop it whenever we
// return, so the gesture (and the browser/PWA back button) works the same
// as the in-app "← Retour"/"✕" controls instead of exiting.
function navigateAway(newView) {
  history.pushState({ inApp: true }, '');
  view = newView;
}

function goHome() {
  stopHandsFree();
  view = 'home';
  if (history.state && history.state.inApp) {
    history.back();
  }
}

window.addEventListener('popstate', () => {
  stopHandsFree();
  view = 'home';
  render();
});

function startGame() {
  if (setupPlayers.length === 0) return;
  roster = Array.from(new Set([...roster, ...setupPlayers.map((p) => p.name)]));
  saveRoster(roster);

  const config =
    pendingGameKind === 'x01'
      ? { startScore: pendingX01Settings.startScore, doubleOut: pendingX01Settings.doubleOut, players: setupPlayers }
      : { players: setupPlayers };
  session = { kind: pendingGameKind, config, history: [], recorded: false };
  view = GAME_VIEW[pendingGameKind];
  inputMode = 'manual';
  manualMult = 1;
  lastTranscript = '';
  persistSession();
  render();
}

// ---------- Event delegation ----------

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  switch (action) {
    case 'choose-game':
      if (el.dataset.kind === 'montante') {
        navigateAway('montante');
      } else {
        pendingGameKind = el.dataset.kind;
        setupPlayers = [];
        navigateAway('setup');
      }
      break;
    case 'go-home':
      goHome();
      break;
    case 'resume':
      navigateAway(GAME_VIEW[session.kind]);
      break;
    case 'go-stats':
      navigateAway('stats');
      break;
    case 'set-start':
      pendingX01Settings.startScore = parseInt(el.dataset.value, 10);
      break;
    case 'move-player': {
      const dir = parseInt(el.dataset.dir, 10);
      const idx = setupPlayers.findIndex((p) => p.id === el.dataset.id);
      const swapIdx = idx + dir;
      if (idx >= 0 && swapIdx >= 0 && swapIdx < setupPlayers.length) {
        [setupPlayers[idx], setupPlayers[swapIdx]] = [setupPlayers[swapIdx], setupPlayers[idx]];
      }
      break;
    }
    case 'remove-player':
      setupPlayers = setupPlayers.filter((p) => p.id !== el.dataset.id);
      break;
    case 'quick-add':
      setupPlayers.push({ id: uid(), name: el.dataset.name });
      break;
    case 'solo-quick-start':
      setupPlayers = [{ id: uid(), name: 'Moi' }];
      startGame();
      return;
    case 'start-game':
      startGame();
      return;
    case 'confirm-quit':
      if (confirm('Quitter la partie en cours ?')) {
        session = null;
        clearGame();
        goHome();
      }
      break;
    case 'toggle-voice-output':
      voiceEnabled = !voiceEnabled;
      break;
    case 'undo':
      if (session && session.history.length > 0) {
        session.history.pop();
        persistSession();
      }
      break;
    case 'set-input-mode':
      inputMode = el.dataset.mode;
      if (inputMode === 'voice') ensureSpeechInput();
      else stopHandsFree();
      break;
    case 'set-mult':
      manualMult = parseInt(el.dataset.value, 10);
      break;
    case 'tap-number': {
      const n = parseInt(el.dataset.number, 10);
      pushDart({ segment: n, mult: manualMult, value: n * manualMult });
      manualMult = 1;
      return;
    }
    case 'tap-bull-single':
      pushDart({ segment: 25, mult: 1, value: 25 });
      return;
    case 'tap-bull-double':
      pushDart({ segment: 25, mult: 2, value: 50 });
      return;
    case 'tap-miss':
      pushDart({ segment: 0, mult: 1, value: 0 });
      return;
    case 'toggle-listen':
      toggleListen();
      return;
    case 'rematch':
      session = { kind: session.kind, config: session.config, history: [], recorded: false };
      lastTranscript = '';
      persistSession();
      break;
    default:
      return;
  }
  render();
});

root.addEventListener('submit', (e) => {
  const addForm = e.target.closest('[data-action="add-player-form"]');
  if (addForm) {
    e.preventDefault();
    const input = addForm.elements.name;
    const name = input.value.trim();
    if (name) {
      setupPlayers.push({ id: uid(), name });
      roster = Array.from(new Set([...roster, name]));
      saveRoster(roster);
      input.value = '';
    }
    render();
    return;
  }

  const montanteForm = e.target.closest('[data-action="montante-save-form"]');
  if (montanteForm) {
    e.preventDefault();
    const name = montanteForm.elements.name.value.trim();
    const darts = parseInt(montanteForm.elements.darts.value, 10);
    if (name && darts > 0) {
      montanteName = name;
      roster = Array.from(new Set([...roster, name]));
      saveRoster(roster);
      Stats.recordGame({ id: uid(), date: new Date().toISOString(), gameType: 'montante', players: [{ name, darts, won: true }] });
    }
    render();
  }
});

root.addEventListener('change', (e) => {
  if (e.target.dataset.action === 'toggle-double-out') {
    pendingX01Settings.doubleOut = e.target.checked;
    render();
  }
});

// ---------- Rendering ----------

function render() {
  if (view === 'home') renderHome();
  else if (view === 'setup') renderSetup();
  else if (view === 'montante') renderMontante();
  else if (view === 'stats') renderStats();
  else renderGame();
}

function renderHome() {
  root.innerHTML = `
    <div class="screen home">
      <h1>🎯 Fléchettes</h1>
      <p class="subtitle">Choisis un jeu</p>
      <div class="game-cards">
        <button class="game-card" data-action="choose-game" data-kind="x01">
          <span class="game-card-emoji">🎯</span>
          <span class="game-card-title">301 / 501</span>
          <span class="game-card-desc">Descends ton score à zéro</span>
        </button>
        <button class="game-card" data-action="choose-game" data-kind="cricket">
          <span class="game-card-emoji">🏏</span>
          <span class="game-card-title">Cricket</span>
          <span class="game-card-desc">Ferme le 15 à 20 et le centre</span>
        </button>
        <button class="game-card" data-action="choose-game" data-kind="montante">
          <span class="game-card-emoji">📈</span>
          <span class="game-card-title">La Montante</span>
          <span class="game-card-desc">1 à 20 dans l'ordre, le moins de fléchettes possible</span>
        </button>
      </div>
      ${session ? '<button class="btn btn-secondary resume-btn" data-action="resume">▶️ Reprendre la partie en cours</button>' : ''}
      <button class="btn btn-ghost" data-action="go-stats">📊 Statistiques</button>
    </div>
  `;
}

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function renderMontante() {
  const entries = montanteName ? Stats.montanteEntriesForPlayer(montanteName, null) : [];
  const best = entries.length ? Math.min(...entries.map((e) => e.darts)) : null;

  root.innerHTML = `
    <div class="screen setup">
      <button class="btn btn-ghost back-btn" data-action="go-home">← Retour</button>
      <h2>📈 La Montante</h2>
      <p class="subtitle">1 → 20 dans l'ordre. Note le nombre de fléchettes utilisées.</p>

      <form data-action="montante-save-form">
        <div class="add-player-form">
          <input type="text" name="name" placeholder="Prénom" maxlength="16" autocomplete="off" value="${escapeHtml(montanteName)}" list="montante-roster" />
        </div>
        <datalist id="montante-roster">${roster.map((n) => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
        <div class="add-player-form" style="margin-top: 8px;">
          <input type="number" name="darts" placeholder="Nombre de fléchettes" min="20" max="300" required />
          <button type="submit" class="btn btn-primary">Enregistrer</button>
        </div>
      </form>

      ${best ? `<div class="checkout-hint">🏆 Meilleur score de ${escapeHtml(montanteName)} : ${best} fléchettes</div>` : ''}

      <h3>Historique${montanteName ? ` de ${escapeHtml(montanteName)}` : ''}</h3>
      ${
        entries.length === 0
          ? '<p class="voice-hint">Aucune partie enregistrée pour le moment.</p>'
          : `<div class="player-chip-list">${entries
              .map(
                (e) => `
            <div class="player-row">
              <span class="player-row-name">${formatDate(e.date)}</span>
              <span>${e.darts} flé.${e.darts === best ? ' 🏆' : ''}</span>
            </div>
          `
              )
              .join('')}</div>`
      }
    </div>
  `;
}

function renderStats() {
  const names = Array.from(new Set([...roster, ...Stats.allPlayerNames()])).sort((a, b) => a.localeCompare(b));
  const fmtAvg = (v) => (v == null ? '—' : v.toFixed(1));

  root.innerHTML = `
    <div class="screen setup">
      <button class="btn btn-ghost back-btn" data-action="go-home">← Retour</button>
      <h2>📊 Statistiques</h2>
      <p class="subtitle">Moyenne par volée de 3 fléchettes (301/501)</p>
      ${names
        .map((name) => {
          const all = Stats.x01StatsForPlayer(name, null);
          if (all.gamesPlayed === 0) return '';
          const last20 = Stats.x01StatsForPlayer(name, 20);
          const last10 = Stats.x01StatsForPlayer(name, 10);
          return `
          <div class="player-row stats-card">
            <div class="player-row-name">${escapeHtml(name)}</div>
            <div class="stats-grid">
              <div class="stats-cell"><span class="stats-value">${fmtAvg(all.average)}</span><span class="stats-label">Ensemble</span></div>
              <div class="stats-cell"><span class="stats-value">${fmtAvg(last20.average)}</span><span class="stats-label">20 dernières</span></div>
              <div class="stats-cell"><span class="stats-value">${fmtAvg(last10.average)}</span><span class="stats-label">10 dernières</span></div>
            </div>
            <div class="stats-sub">${all.gamesPlayed} partie${all.gamesPlayed > 1 ? 's' : ''} · ${all.wins} victoire${all.wins > 1 ? 's' : ''}</div>
          </div>
        `;
        })
        .join('') || '<p class="voice-hint">Aucune partie de 301/501 terminée pour le moment.</p>'}
    </div>
  `;
}

function renderSetup() {
  const isX01 = pendingGameKind === 'x01';
  root.innerHTML = `
    <div class="screen setup">
      <button class="btn btn-ghost back-btn" data-action="go-home">← Retour</button>
      <h2>${isX01 ? '🎯 301 / 501' : '🏏 Cricket'}</h2>

      ${isX01 ? `
        <div class="chip-row">
          <button class="chip ${pendingX01Settings.startScore === 301 ? 'chip-active' : ''}" data-action="set-start" data-value="301">301</button>
          <button class="chip ${pendingX01Settings.startScore === 501 ? 'chip-active' : ''}" data-action="set-start" data-value="501">501</button>
        </div>
        <label class="toggle-row">
          <span>Sortie sur double (règle officielle)</span>
          <input type="checkbox" data-action="toggle-double-out" ${pendingX01Settings.doubleOut ? 'checked' : ''} />
        </label>
      ` : ''}

      <h3>Joueurs</h3>
      <div class="player-chip-list">
        ${setupPlayers
          .map(
            (p, i) => `
          <div class="player-row">
            <span class="player-row-name">${escapeHtml(p.name)}</span>
            <div class="player-row-actions">
              <button data-action="move-player" data-dir="-1" data-id="${p.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-action="move-player" data-dir="1" data-id="${p.id}" ${i === setupPlayers.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-action="remove-player" data-id="${p.id}">✕</button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <form data-action="add-player-form" class="add-player-form">
        <input type="text" name="name" placeholder="Nom du joueur" maxlength="16" autocomplete="off" />
        <button type="submit" class="btn btn-secondary">Ajouter</button>
      </form>

      ${
        roster.filter((r) => !setupPlayers.some((p) => p.name === r)).length
          ? `<div class="roster-suggestions">${roster
              .filter((r) => !setupPlayers.some((p) => p.name === r))
              .map((name) => `<button class="tag" data-action="quick-add" data-name="${escapeHtml(name)}">+ ${escapeHtml(name)}</button>`)
              .join('')}</div>`
          : ''
      }

      <button class="btn btn-ghost" data-action="solo-quick-start">🙋 Jouer seul</button>

      <button class="btn btn-primary start-btn" data-action="start-game" ${setupPlayers.length === 0 ? 'disabled' : ''}>
        Commencer la partie ▶️
      </button>
    </div>
  `;
}

function renderPlayersRowX01(state, total) {
  return `<div class="players-row">${state.players
    .map(
      (p, i) => `
    <div class="player-card ${i === state.currentPlayerIndex ? 'active' : ''}">
      <div class="player-card-name">${escapeHtml(p.name)}</div>
      <div class="player-card-score">${i === state.currentPlayerIndex ? Math.max(0, p.score - total) : p.score}</div>
      ${p.turns.length ? `<div class="player-card-last">Dernier : ${p.turns[p.turns.length - 1]}</div>` : ''}
    </div>
  `
    )
    .join('')}</div>`;
}

function marksSymbol(m) {
  return m === 1 ? '/' : m === 2 ? '✕' : m === 3 ? '⊗' : '';
}

function renderCricketTable(state) {
  return `
  <div class="cricket-wrap">
    <table class="cricket-table">
      <thead><tr><th></th>${state.players.map((p, i) => `<th class="${i === state.currentPlayerIndex ? 'active' : ''}">${escapeHtml(p.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${state.numbers
          .map(
            (n) => `
          <tr>
            <td class="cricket-num">${n === 25 ? '🎯' : n}</td>
            ${state.players.map((p) => `<td class="mark mark-${p.marks[n]}">${marksSymbol(p.marks[n])}</td>`).join('')}
          </tr>
        `
          )
          .join('')}
      </tbody>
      <tfoot>
        <tr class="cricket-score-row"><td>Score</td>${state.players.map((p) => `<td>${p.score}</td>`).join('')}</tr>
      </tfoot>
    </table>
  </div>`;
}

function renderManualPad(isX01) {
  const numbers = isX01 ? Array.from({ length: 20 }, (_, i) => i + 1) : [20, 19, 18, 17, 16, 15];
  return `
    <div class="mult-row">
      <button class="chip ${manualMult === 1 ? 'chip-active' : ''}" data-action="set-mult" data-value="1">Simple</button>
      <button class="chip ${manualMult === 2 ? 'chip-active' : ''}" data-action="set-mult" data-value="2">Double</button>
      <button class="chip ${manualMult === 3 ? 'chip-active' : ''}" data-action="set-mult" data-value="3">Triple</button>
    </div>
    <div class="number-grid">
      ${numbers.map((n) => `<button class="num-btn" data-action="tap-number" data-number="${n}">${n}</button>`).join('')}
      <button class="num-btn bull" data-action="tap-bull-single">25</button>
      <button class="num-btn bull" data-action="tap-bull-double">50</button>
      <button class="num-btn miss" data-action="tap-miss">${isX01 ? 'Raté' : 'Autre'}</button>
    </div>
  `;
}

function renderVoicePanel() {
  return `
    <div class="voice-panel">
      <button class="mic-btn ${handsFree ? 'listening' : ''}" data-action="toggle-listen">
        ${handsFree ? (listening ? '🎙️ J\'écoute… (appuie pour couper)' : '⏳ Micro en pause…') : '🎤 Activer le micro'}
      </button>
      <p class="voice-hint">Le micro reste allumé tant que tu ne le coupes pas.</p>
      <p class="voice-hint">Exemples : « triple 20 », « double 18 », « 5 », « raté », « annule »</p>
      ${lastTranscript ? `<p class="voice-transcript">J'ai entendu : « ${escapeHtml(lastTranscript)} »</p>` : ''}
      ${!speechSupported ? '<p class="voice-unsupported">⚠️ Reconnaissance vocale indisponible sur ce navigateur. Utilise le mode manuel.</p>' : ''}
    </div>
  `;
}

function renderGame() {
  const state = deriveState();
  if (!state) {
    view = 'home';
    renderHome();
    return;
  }

  const isX01 = session.kind === 'x01';
  const total = turnTotal(state);
  let checkoutHint = null;
  if (isX01 && !state.winnerId) {
    const player = state.players[state.currentPlayerIndex];
    const remaining = player.score - total;
    const dartsLeft = 3 - state.currentTurn.length;
    if (remaining > 0 && remaining <= 170 && dartsLeft > 0) {
      checkoutHint = suggestCheckout(remaining, dartsLeft, state.doubleOut);
    }
  }

  const winner = state.winnerId ? state.players.find((p) => p.id === state.winnerId) : null;

  root.innerHTML = `
    <div class="screen game">
      <div class="game-topbar">
        <button class="btn btn-ghost small" data-action="confirm-quit">✕</button>
        <span class="game-title">${isX01 ? `${state.startScore}${state.doubleOut ? ' · double' : ''}` : 'Cricket'}</span>
        <button class="btn btn-ghost small" data-action="toggle-voice-output">${voiceEnabled ? '🔊' : '🔇'}</button>
      </div>

      ${isX01 ? renderPlayersRowX01(state, total) : renderCricketTable(state)}

      ${state.message ? `<div class="toast">${escapeHtml(state.message)}</div>` : ''}
      ${checkoutHint ? `<div class="checkout-hint">💡 Pour finir : ${checkoutHint.join(' puis ')}</div>` : ''}

      <div class="turn-darts">
        ${[0, 1, 2].map((i) => `<div class="dart-slot ${state.currentTurn[i] ? 'filled' : ''}">${state.currentTurn[i] ? dartLabel(state.currentTurn[i]) : '–'}</div>`).join('')}
        <button class="btn btn-ghost undo-btn" data-action="undo" ${session.history.length === 0 ? 'disabled' : ''}>↩️</button>
      </div>

      ${
        !state.winnerId
          ? `
        <div class="input-mode-toggle">
          <button class="btn ${inputMode === 'manual' ? 'btn-primary' : 'btn-ghost'}" data-action="set-input-mode" data-mode="manual">⌨️ Manuel</button>
          <button class="btn ${inputMode === 'voice' ? 'btn-primary' : 'btn-ghost'}" data-action="set-input-mode" data-mode="voice">🎤 Vocal</button>
        </div>
        ${inputMode === 'manual' ? renderManualPad(isX01) : renderVoicePanel()}
      `
          : ''
      }
    </div>

    ${
      winner
        ? `
      <div class="win-overlay">
        <div class="win-card">
          <div class="win-emoji">🏆</div>
          <div class="win-title">${escapeHtml(winner.name)} gagne !</div>
          <button class="btn btn-primary" data-action="rematch">🔁 Rejouer</button>
          <button class="btn btn-ghost" data-action="go-home">🏠 Accueil</button>
        </div>
      </div>
    `
        : ''
    }
  `;
}

// ---------- Boot ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

render();
