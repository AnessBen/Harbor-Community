import { youtubeRestrictionDelay } from "./youtube-restriction";

/** One speculative job at a time, even when the queue changes during a native request. */
export class NextTrackWarmup {
  private active = false;
  private generation = 0;
  private suspendedUntil = 0;

  suspendFor(ms: number): void {
    this.suspendedUntil = Math.max(this.suspendedUntil, Date.now() + ms);
  }

  isSuspended(): boolean {
    return Date.now() < this.suspendedUntil;
  }
  private attempts = new Map<string, number>();

  reset(): void {
    this.generation++;
    this.attempts.clear();
  }

  async run(
    key: string,
    current: () => boolean,
    work: (stillCurrent: () => boolean) => Promise<boolean>,
  ): Promise<void> {
    if (
      this.active ||
      this.isSuspended() ||
      !current() ||
      (this.attempts.get(key) ?? 0) > Date.now()
    )
      return;
    const generation = this.generation;
    const stillCurrent = () => generation === this.generation && current();
    this.active = true;
    let ok = false;
    try {
      ok = await work(stillCurrent);
    } catch (error) {
      const delay = youtubeRestrictionDelay(error);
      if (delay !== null) this.suspendFor(delay);
      // Prefetch is optional. A failed warmup never prevents foreground playback.
    } finally {
      if (stillCurrent()) {
        this.attempts.set(key, Date.now() + (ok ? 600_000 : 30_000));
        while (this.attempts.size > 16) this.attempts.delete(this.attempts.keys().next().value!);
      }
      this.active = false;
    }
  }
}
