import { freshContinuationTracks } from "./queue-continuation";
import { queueTrackKey } from "./queue-order";
import { musicTrackIdentity } from "./track-identity";
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
 * the owner; only an explicit takeover or unrecognized replacement cancels it. */
export class RecommendationContinuation {
  private stopped = false;
  private pending: Promise<boolean> | null = null;
  private attempted = new Set<string>();
  private retryAfter = 0;

  private api: Dependencies;
  private ownedQueue: MusicTrack[];
  private ownedKeys: string[];
  private seenKeys = new Set<string>();
  private seenRecordings = new Set<string>();
  private ready: boolean;

  constructor(api: Dependencies, ready = true) {
    this.api = api;
    this.ownedQueue = api.snapshot().queue;
    this.ownedKeys = this.ownedQueue.map(queueTrackKey);
    this.ready = ready;
    this.remember(this.ownedQueue);
  }

  activate(): void {
    this.ready = true;
  }

  private remember(queue: readonly MusicTrack[]): void {
    for (const track of queue) {
      this.seenKeys.add(queueTrackKey(track));
      this.seenRecordings.add(musicTrackIdentity(track));
    }
  }

  excludeSeen(tracks: MusicTrack[]): MusicTrack[] {
    return tracks.filter(
      (track) =>
        !this.seenKeys.has(queueTrackKey(track)) &&
        !this.seenRecordings.has(musicTrackIdentity(track)),
    );
  }

  /** Explicit individual edits retain the owner, including while a refill is pending. */
  adoptEdit(queue: MusicTrack[]): boolean {
    if (this.stopped) return false;
    const state = this.api.snapshot();
    if (
      !state.current ||
      !this.matchesQueue(state.queue) ||
      !queue.some((track) => queueTrackKey(track) === queueTrackKey(state.current!))
    )
      return false;
    this.remember(state.queue);
    this.remember(queue);
    this.ownedQueue = queue;
    this.ownedKeys = queue.map(queueTrackKey);
    return true;
  }

  acceptsQueue(queue: MusicTrack[]): boolean {
    return !this.stopped && this.matchesQueue(queue);
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
    this.remember(queue);
    return true;
  }

  stop(): void {
    this.stopped = true;
  }

  request(force = false): Promise<boolean> | null {
    if (this.stopped || !this.ready) return null;
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
          this.excludeSeen(this.api.filter(candidates)),
          latest.queue,
        ).slice(0, RECOMMENDATION_BATCH_SIZE);
        if (!tracks.length) {
          this.retryAfter = now() + RETRY_DELAY_MS;
          return false;
        }
        const next = [...latest.queue, ...tracks];
        this.ownedQueue = next;
        this.ownedKeys = next.map(queueTrackKey);
        this.remember(next);
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
