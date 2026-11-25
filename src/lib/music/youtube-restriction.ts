/** Distinguish provider-wide temporary restrictions from individual unavailable songs. */
export function youtubeRestrictionDelay(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    !/youtube/i.test(message) ||
    !/rate limit|limiting requests|browser verification|not a bot|http(?: error)? 429|too many requests/i.test(
      message,
    )
  )
    return null;
  const seconds = /wait\s+(\d+)\s+seconds/i.exec(message);
  return seconds ? Math.max(1000, Math.min(900_000, Number(seconds[1]) * 1000)) : 120_000;
}
