import { createListenQueueBuilder } from "./queue";
import {
  musicUpcoming,
  musicPriorityNext,
  getMusicTransport,
  subscribeTransport,
} from "@/lib/music/transport";
import { useEffect, useRef } from "react";
import type { RoomSnapshot, TogetherClient } from "@/lib/together/client";
import type { SyncState } from "@/lib/together/protocol";
import type { MusicAudioSettingsValue } from "@/lib/music/audio-settings";
import {
  getMusicAudioSettingsSnapshot,
  initializeMusicAudioSettings,
  saveMusicAudioSettings,
  subscribeMusicAudioSettings,
} from "@/lib/music/audio-settings";
import {
  followMusicQueue,
  getMusicState,
  playMusic,
  seekMusic,
  subscribeMusic,
  toggleMusicPlayback,
} from "@/lib/music/player";
import type { MusicTrack } from "@/lib/music/types";
import { createListenMixFollower, type ListenMixFollower } from "./mix-follow";
import { readListenMix, type ListenMix } from "./mix-state";
import {
  LISTEN_DRIFT_SECONDS,
  listenActionFor,
  reconcileListenSeek,
  listenRoleOf,
  listenShouldPublish,
} from "./session";
import { listenMixFromState, listenStateFromTrack, type ListenTrackRef } from "./track-state";

const SETTLE_MS = 1500;
const SAVE_RETRY_MS = 160;

export type ListenSessionParams = {
  room: string | null;
  clientId: string;
  snapshot: RoomSnapshot | null;
  clientRef: { current: TogetherClient | null };
};

function musicTrackFrom(ref: ListenTrackRef): MusicTrack {
  return {
    id: ref.id,
    connectorId: ref.connectorId ?? undefined,
    title: ref.title,
    artist: ref.artist,
    artwork: ref.artwork ?? "",
    durationSeconds: 0,
    durationLabel: "",
  };
}

function currentListenPosition(state: SyncState): number {
  const elapsed = state.playing ? Math.max(0, Date.now() - state.updatedAt) / 1000 : 0;
  return state.positionSeconds + elapsed * (state.speed ?? 1);
}

function applyTransport(playing: boolean): void {
  const phase = getMusicState().phase;
  if (playing && phase !== "playing") toggleMusicPlayback();
  if (!playing && phase === "playing") toggleMusicPlayback();
}

function writeAudioSettings(next: MusicAudioSettingsValue): Promise<unknown> {
  return saveMusicAudioSettings(next).catch(() =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, SAVE_RETRY_MS);
    }).then(() => saveMusicAudioSettings(next)),
  );
}

export function useListenSession(params: ListenSessionParams): void {
  const { room, clientId, snapshot, clientRef } = params;

  const joined = !!room && snapshot?.state === "joined" && snapshot.room === room;
  const isHost = joined && !!snapshot && listenRoleOf(snapshot, clientId) === "host";
  const following = joined && !isHost;
  const hostClientId = snapshot?.hostClientId ?? null;
  const syncState = snapshot?.syncState ?? null;

  const sessionId = snapshot?.listenSessionId;
  const guestSession = room && sessionId && snapshot.hostClientId !== clientId ? sessionId : null;
  useEffect(() => {
    if (guestSession) return followMusicQueue();
  }, [guestSession]);

  useEffect(() => {
    if (!sessionId || !isHost) return;
    const build = createListenQueueBuilder();
    let lastQueue: MusicTrack[] | undefined;
    let lastCurrent: MusicTrack | null | undefined;
    let lastIndex = -2;
    let lastTransport: ReturnType<typeof getMusicTransport> | undefined;
    let lastPriority: MusicTrack | null | undefined;
    const publish = () => {
      const { queue, queueIndex, current } = getMusicState();
      const transport = getMusicTransport();
      const priority = musicPriorityNext();
      if (
        lastQueue === queue &&
        lastIndex === queueIndex &&
        lastCurrent === current &&
        lastTransport === transport &&
        lastPriority === priority
      )
        return;
      lastQueue = queue;
      lastIndex = queueIndex;
      lastCurrent = current;
      lastTransport = transport;
      lastPriority = priority;
      const upcoming = musicUpcoming(queue, queueIndex, 200);
      if (priority && transport.repeat !== "one") {
        const at = upcoming.indexOf(priority);
        if (at >= 0) upcoming.splice(at, 1);
        upcoming.unshift(priority);
      }
      clientRef.current?.publishListenQueue(
        build(queue[queueIndex] ?? current, upcoming, transport),
      );
    };
    publish();
    const off = subscribeMusic(publish);
    const offTransport = subscribeTransport(publish);
    return () => {
      off();
      offTransport();
    };
  }, [isHost, sessionId, clientRef]);

  const settleUntil = useRef(0);
  const latestState = useRef<SyncState | null>(null);
  const loadingMedia = useRef<string | null>(null);
  const loadToken = useRef(0);
  const pendingMix = useRef<ListenMix | null>(null);
  const followerRef = useRef<ListenMixFollower | null>(null);
  if (!followerRef.current) {
    followerRef.current = createListenMixFollower({
      read: () => getMusicAudioSettingsSnapshot().settings,
      write: writeAudioSettings,
    });
  }

  useEffect(() => {
    if (!joined || !isHost) return;
    let published: SyncState | null = null;
    const tick = () => {
      const client = clientRef.current;
      if (!client) return;
      const music = getMusicState();
      const track = music.current;
      if (!track || track.connectorId === "local" || track.id.startsWith("local:")) return;
      if (music.phase !== "playing" && music.phase !== "paused") return;
      const audio = getMusicAudioSettingsSnapshot();
      const next = listenStateFromTrack(
        track,
        music.currentTime,
        music.phase === "playing",
        clientId,
        hostClientId,
        Date.now(),
        audio.ready ? readListenMix(audio.settings) : null,
      );
      if (!listenShouldPublish(published, next)) return;
      published = next;
      client.publishState(next);
    };
    void initializeMusicAudioSettings().then(tick, () => {});
    tick();
    const offMusic = subscribeMusic(tick);
    const offAudio = subscribeMusicAudioSettings(tick);
    return () => {
      offMusic();
      offAudio();
    };
  }, [joined, isHost, clientId, hostClientId, clientRef]);

  useEffect(() => {
    if (!following) {
      settleUntil.current = 0;
      loadingMedia.current = null;
      latestState.current = null;
      loadToken.current += 1;
      return;
    }
    if (!syncState) return;
    if (syncState.updatedBy === clientId) return;
    const music = getMusicState();
    latestState.current = syncState;
    if (loadingMedia.current === syncState.mediaId) return;
    const action = listenActionFor(
      { ...syncState, positionSeconds: currentListenPosition(syncState) },
      {
        track: music.current,
        positionSeconds: music.currentTime,
        playing: music.phase === "playing",
      },
    );
    if (action.kind === "none") return;
    const now = Date.now();
    if (action.kind === "play" || action.kind === "pause") {
      applyTransport(action.kind === "play");
      return;
    }
    if (action.kind === "seek") {
      return reconcileListenSeek(settleUntil.current, syncState.playing, applyTransport, () => {
        const position = currentListenPosition(syncState);
        if (Math.abs(getMusicState().currentTime - position) > LISTEN_DRIFT_SECONDS) {
          settleUntil.current = Date.now() + SETTLE_MS;
          seekMusic(position);
        }
        applyTransport(syncState.playing);
      });
    }
    settleUntil.current = now + SETTLE_MS;
    const token = (loadToken.current += 1);
    loadingMedia.current = syncState.mediaId;
    const wanted = action;
    void playMusic(musicTrackFrom(wanted.track))
      .then(() => {
        if (token !== loadToken.current) return;
        settleUntil.current = Date.now() + SETTLE_MS;
        const latest = latestState.current;
        if (!latest || latest.mediaId !== syncState.mediaId) return;
        const position = currentListenPosition(latest);
        if (position > LISTEN_DRIFT_SECONDS) seekMusic(position);
        applyTransport(latest.playing);
      })
      .catch(() => {})
      .finally(() => {
        if (token === loadToken.current) loadingMedia.current = null;
      });
  }, [following, syncState, clientId]);

  useEffect(() => {
    const follower = followerRef.current;
    if (!follower || !following) return;
    let live = true;
    void initializeMusicAudioSettings().then(
      () => {
        if (!live) return;
        follower.begin();
        void follower.apply(pendingMix.current);
      },
      () => {},
    );
    return () => {
      live = false;
      pendingMix.current = null;
      void follower.end();
    };
  }, [following]);

  useEffect(() => {
    const follower = followerRef.current;
    if (!follower || !following) return;
    const mix = listenMixFromState(syncState);
    if (!mix) return;
    pendingMix.current = mix;
    void follower.apply(mix);
  }, [following, syncState]);
}
