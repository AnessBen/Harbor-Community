/** One speculative job at a time, even when the queue changes during a native request. */
export class NextTrackWarmup {
  private active = false;
  private generation = 0;
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
    if (this.active || !current() || (this.attempts.get(key) ?? 0) > Date.now()) return;
    const generation = this.generation;
    const stillCurrent = () => generation === this.generation && current();
    this.active = true;
    let ok = false;
    try {
      ok = await work(stillCurrent);
    } catch {
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
