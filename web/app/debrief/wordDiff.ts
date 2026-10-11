// Word-level "your call vs correct call" diff for the debrief.

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];

export type DiffWord = { word: string; ok: boolean };

/** Lowercase spoken form: digits read one by one ("27" -> "two seven"), punctuation dropped. */
export function toSpokenWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/\d/g, (digit) => ` ${DIGITS[Number(digit)]} `)
    .replace(/[^a-z'\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => (word === "nine" ? "niner" : word));
}

/**
 * Longest-common-subsequence alignment. Words of `said` outside the LCS are wrong/extra;
 * words of `correct` outside it are missing.
 */
export function diffCalls(said: string, correct: string): { said: DiffWord[]; correct: DiffWord[] } {
  const a = toSpokenWords(said);
  const b = toSpokenWords(correct);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const saidOut: DiffWord[] = a.map((word) => ({ word, ok: false }));
  const correctOut: DiffWord[] = b.map((word) => ({ word, ok: false }));
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      saidOut[i].ok = true;
      correctOut[j].ok = true;
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return { said: saidOut, correct: correctOut };
}
