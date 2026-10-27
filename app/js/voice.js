// Keys are already accent-free since normalize() strips accents before lookup.
const WORD_NUMBERS = {
  zero: 0,
  un: 1, une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  vingt: 20,
  cinquante: 50,
};

const MULT_WORDS = { simple: 1, double: 2, triple: 3 };
const MISS_WORDS = ['rate', 'ratee', 'manque', 'rien', 'zero'];
const BULL_WORDS = ['bull', 'mouche', 'centre'];

const ACCENTS = {
  'à': 'a', 'â': 'a', 'ä': 'a',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'î': 'i', 'ï': 'i',
  'ô': 'o', 'ö': 'o',
  'ù': 'u', 'û': 'u', 'ü': 'u',
  'ç': 'c',
};

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[àâäéèêëîïôöùûüç]/g, (c) => ACCENTS[c] || c)
    .replace(/[-']/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parses a spoken transcript (French) into up to 3 dart objects:
// { segment, mult, value } where segment is 0-20 or 25 (bull).
export function parseDarts(transcript) {
  const words = normalize(transcript).split(' ').filter(Boolean);
  const darts = [];
  let pendingMult = 1;
  let i = 0;

  while (i < words.length && darts.length < 3) {
    const w = words[i];

    if (MULT_WORDS[w] !== undefined) {
      pendingMult = MULT_WORDS[w];
      i++;
      continue;
    }

    if (MISS_WORDS.includes(w)) {
      darts.push({ segment: 0, mult: 1, value: 0 });
      pendingMult = 1;
      i++;
      continue;
    }

    if (BULL_WORDS.includes(w)) {
      const mult = pendingMult === 2 ? 2 : 1;
      darts.push({ segment: 25, mult, value: mult === 2 ? 50 : 25 });
      pendingMult = 1;
      i++;
      continue;
    }

    let num = null;
    if (/^\d+$/.test(w)) {
      num = parseInt(w, 10);
      i++;
    } else if (WORD_NUMBERS[w] !== undefined) {
      num = WORD_NUMBERS[w];
      i++;
      const next = words[i];
      const nextVal = next !== undefined ? WORD_NUMBERS[next] : undefined;
      if ((num === 10 || num === 20) && nextVal !== undefined && nextVal >= 1 && nextVal <= 9) {
        num += nextVal;
        i++;
      }
    }

    if (num !== null) {
      if (num === 25) {
        const mult = pendingMult === 2 ? 2 : 1;
        darts.push({ segment: 25, mult, value: mult === 2 ? 50 : 25 });
      } else if (num === 50) {
        darts.push({ segment: 25, mult: 2, value: 50 });
      } else if (num >= 1 && num <= 20) {
        const mult = [1, 2, 3].includes(pendingMult) ? pendingMult : 1;
        darts.push({ segment: num, mult, value: num * mult });
      } else if (num === 0) {
        darts.push({ segment: 0, mult: 1, value: 0 });
      }
      pendingMult = 1;
      continue;
    }

    i++;
  }

  return darts;
}

export class VoiceInput {
  constructor({ onResult, onListeningChange, onError } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.onResult = onResult;
    this.onListeningChange = onListeningChange;
    this.onError = onError;
    if (!this.supported) return;

    this.recognition = new SR();
    this.recognition.lang = 'fr-FR';
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.continuous = false;

    this.recognition.onstart = () => this.onListeningChange?.(true);
    this.recognition.onend = () => this.onListeningChange?.(false);
    this.recognition.onerror = (e) => {
      this.onError?.(e.error);
      this.onListeningChange?.(false);
    };
    this.recognition.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += `${res[0].transcript} `;
        else interimText += res[0].transcript;
      }
      finalText = finalText.trim();
      this.onResult?.({ finalText, interimText, isFinal: finalText.length > 0 });
    };
  }

  start() {
    if (!this.supported) return;
    try {
      this.recognition.start();
    } catch {
      /* already listening */
    }
  }

  stop() {
    if (!this.supported) return;
    try {
      this.recognition.stop();
    } catch {
      /* already stopped */
    }
  }
}
