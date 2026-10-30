const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
const ALL = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

const randomIndex = (max: number): number => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  // Rejection-free modulo is good enough for a human-readable password
  // generator; the bias is far below one character and the length stays high.
  return values[0] % max;
};

/**
 * Generates a 16-character password that always contains lowercase, uppercase,
 * a digit and a symbol. Uses the browser CSPRNG and avoids look-alike
 * characters (0/O, 1/l/I) so a password can be read aloud or typed from a
 * phone without ambiguity.
 */
export function generatePassword(length = 16): string {
  const target = Math.max(12, Math.min(length, 64));
  const required = [
    LOWERCASE[randomIndex(LOWERCASE.length)],
    UPPERCASE[randomIndex(UPPERCASE.length)],
    DIGITS[randomIndex(DIGITS.length)],
    SYMBOLS[randomIndex(SYMBOLS.length)],
  ];
  const rest = Array.from(
    { length: target - required.length },
    () => ALL[randomIndex(ALL.length)],
  );
  const chars = [...required, ...rest];

  // Fisher-Yates with the same CSPRNG so the required characters are not
  // always in the first four positions.
  for (let index = chars.length - 1; index > 0; index--) {
    const swap = randomIndex(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}
