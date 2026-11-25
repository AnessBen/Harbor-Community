import { freshContinuationTracks } from "./queue-continuation";
import { queueTrackKey } from "./queue-order";
import type { MusicTrack } from "./types";

export const RECOMMENDATION_LOW_WATER = 4;
export const RECOMMENDATION_BATCH_SIZE = 18;
const RETRY_DELAY_MS = 60_000;

type Snapshot = {
  current: MusicTrack | null;
  queue: MusicTrack[];
  phase: string;
  enabled: boolean;
};

type Dependencies = {
  snapshot: () => Snapshot;
  remaining: () => number;
  recommendations: (seed: MusicTrack) => Promise<MusicTrack[]>;
  filter: (tracks: MusicTrack[]) => MusicTrack[];
  apply: (queue: MusicTrack[]) => void;
  now?: () => number;
  onInvalidated?: () => void;
};

/** One owner per generated queue. Metadata updates and advancing within it keep
 * the owner; an explicit queue replacement/edit cancels it. */
export class RecommendationContinuation {
  private stopped = false;
  private pending: Promise<boolean> | null = null;
  private attempted = new Set<string>();
  private retryAfter = 0;

  private api: Dependencies;
  private ownedQueue: MusicTrack[];
  private ownedKeys: string[];

  constructor(api: Dependencies) {
    this.api = api;
    this.ownedQueue = api.snapshot().queue;
    this.ownedKeys = this.ownedQueue.map(queueTrackKey);
  }

  private matchesQueue(queue: MusicTrack[]): boolean {
    if (queue === this.ownedQueue) return true;
    if (
      queue.length !== this.ownedKeys.length ||
      !queue.every((track, i) => queueTrackKey(track) === this.ownedKeys[i])
    ) {
      this.stop();
      this.api.onInvalidated?.();
      return false;
    }
    this.ownedQueue = queue;
    return true;
  }

  stop(): void {
    this.stopped = true;
  }

  request(force = false): Promise<boolean> | null {
    if (this.stopped) return null;
    const state = this.api.snapshot();
    if (!this.matchesQueue(state.queue)) return null;
    const seed = state.current;
    if (
      !state.enabled ||
      !seed ||
      seed.mediaKind === "video" ||
      !state.queue.some((track) => queueTrackKey(track) === queueTrackKey(seed)) ||
      state.phase === "error" ||
      state.phase === "idle"
    )
      return null;
    if (this.pending) return this.pending;
    if (!force && state.phase !== "playing") return null;
    const key = queueTrackKey(seed);
    const now = this.api.now ?? Date.now;
    if (
      this.attempted.has(key) ||
      now() < this.retryAfter ||
      (!force && this.api.remaining() > RECOMMENDATION_LOW_WATER)
    )
      return null;
    this.attempted.add(key);
    // Defer the work so the single-flight promise is installed before any synchronous
    // callback can publish another player snapshot.
    const work = Promise.resolve().then(async () => {
      if (this.stopped || !this.api.snapshot().enabled) return false;
      try {
        const candidates = await this.api.recommendations(seed);
        const latest = this.api.snapshot();
        if (
          this.stopped ||
          !latest.enabled ||
          !latest.current ||
          latest.current.mediaKind === "video" ||
          latest.phase === "error" ||
          latest.phase === "idle" ||
          !this.matchesQueue(latest.queue) ||
          !latest.queue.some((track) => queueTrackKey(track) === queueTrackKey(latest.current!))
        )
          return false;
        const tracks = freshContinuationTracks(
          this.api.filter(candidates),
          latest.queue,
        ).slice(0, RECOMMENDATION_BATCH_SIZE);
        if (!tracks.length) {
          this.retryAfter = now() + RETRY_DELAY_MS;
          return false;
        }
        const next = [...latest.queue, ...tracks];
        this.ownedQueue = next;
        this.ownedKeys = next.map(queueTrackKey);
        this.api.apply(next);
        return true;
      } catch {
        this.retryAfter = now() + RETRY_DELAY_MS;
        return false;
      }
    });
    this.pending = work.finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
