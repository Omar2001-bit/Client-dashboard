/**
 * Experiment naming convention.
 *
 * Matches names that start with "ID<number>" followed (after optional whitespace)
 * by either a pipe `|`, a square bracket `[`, or a parenthesis `(`.
 *
 * Examples that match (case-insensitive):
 *   ID5|
 *   ID5 |
 *   id 5|
 *   id 5 |
 *   ID5(Y.A)|
 *   id 5 (Y.A)|
 *   ID6[ABC]
 *
 * The number itself is just a label — any digit count is accepted.
 */
export const NAMING_REGEX = /^id\s*\d+\s*[|[(]/i;

export function matchesNamingConvention(name: unknown): boolean {
  return typeof name === "string" && NAMING_REGEX.test(name);
}
