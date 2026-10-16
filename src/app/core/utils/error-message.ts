/** Readable text for any thrown value. No Angular imports: also used inside the worker. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
