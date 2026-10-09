/** A caught error's message, or `fallback` when it is not an Error. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
