/**
 * Compares two strings in natural order (numbers within names sort numerically,
 * case-insensitive) so "Chapter 2" sorts before "Chapter 10".
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
