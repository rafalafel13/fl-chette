const SEGMENTS = [];
for (let n = 1; n <= 20; n++) {
  SEGMENTS.push({ label: `${n}`, value: n, isDouble: false });
  SEGMENTS.push({ label: `D${n}`, value: n * 2, isDouble: true });
  SEGMENTS.push({ label: `T${n}`, value: n * 3, isDouble: false });
}
SEGMENTS.push({ label: 'Bull', value: 25, isDouble: false });
SEGMENTS.push({ label: 'D-Bull', value: 50, isDouble: true });

const BY_VALUE_DESC = [...SEGMENTS].sort((a, b) => b.value - a.value);

function finishIn(rem, darts, doubleOut) {
  if (rem <= 0) return null;
  if (darts === 1) {
    for (const seg of BY_VALUE_DESC) {
      if (seg.value === rem && (!doubleOut || seg.isDouble)) return [seg.label];
    }
    return null;
  }
  for (const seg of BY_VALUE_DESC) {
    if (seg.value >= rem) continue;
    const left = rem - seg.value;
    if (doubleOut && left === 1) continue;
    const rest = finishIn(left, darts - 1, doubleOut);
    if (rest) return [seg.label, ...rest];
  }
  return null;
}

// Returns an array of dart labels (e.g. ["T20", "D20"]) suggesting the
// quickest way to reach exactly zero, or null if no suggestion applies.
export function suggestCheckout(remaining, dartsLeft, doubleOut) {
  const maxDarts = Math.min(dartsLeft, 3);
  for (let d = 1; d <= maxDarts; d++) {
    const result = finishIn(remaining, d, doubleOut);
    if (result) return result;
  }
  return null;
}
