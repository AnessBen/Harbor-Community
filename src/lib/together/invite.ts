import { isListenRoomCode } from "@/lib/listen-together/room";
import { ROOM_CODE_LENGTH } from "./protocol";
import { HARBOR_RELAY_BASE } from "@/lib/config/endpoints";
import { migratePublicRelayUrl } from "./relay-version";

const RELAY_PARAM = "harbor-relay";
const SESSION_PARAM = "harbor-session";
const ROOM_PARAM = "harbor-room";

export type ParsedInvite = {
  relayUrl: string;
  roomCode: string;
  sessionId?: string;
};

export const WEB_JOIN_BASE = HARBOR_RELAY_BASE;

// Native launch URLs can arrive before the Together provider has mounted.
function inviteChannel() {
  let pending: ParsedInvite | null = null;
  const listeners = new Set<(invite: ParsedInvite) => void>();
  return {
    emit(invite: ParsedInvite) {
      if (!listeners.size) pending = invite;
      else listeners.forEach((listener) => listener(invite));
    },
    subscribe(listener: (invite: ParsedInvite) => void): () => void {
      listeners.add(listener);
      const invite = pending;
      pending = null;
      if (invite) listener(invite);
      return () => listeners.delete(listener);
    },
  };
}

const watchInvites = inviteChannel();
const listenInvites = inviteChannel();
export const onTogetherInvite = watchInvites.subscribe;
export const onListenInvite = listenInvites.subscribe;

export function emitTogetherInvite(invite: ParsedInvite): void {
  const channel = isListenRoomCode(invite.roomCode) ? listenInvites : watchInvites;
  channel.emit(invite);
}

export function parseInviteParams(params: URLSearchParams): ParsedInvite | null {
  if (params.getAll(RELAY_PARAM).length !== 1 || params.getAll(ROOM_PARAM).length !== 1)
    return null;
  const relay = migratePublicRelayUrl(params.get(RELAY_PARAM)?.trim() ?? "");
  const roomRaw = params.get(ROOM_PARAM)?.trim();
  if (!relay || !roomRaw) return null;
  const room = roomRaw.toUpperCase();
  if ((room.length !== ROOM_CODE_LENGTH && !isListenRoomCode(room)) || /[^A-Z0-9]/.test(room))
    return null;
  try {
    const url = new URL(relay);
    if (
      !["ws:", "wss:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  const sessions = params.getAll(SESSION_PARAM);
  if (sessions.length) {
    const [sessionId] = sessions;
    if (
      sessions.length !== 1 ||
      !isListenRoomCode(room) ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)
    )
      return null;
    return { relayUrl: relay, roomCode: room, sessionId };
  }
  return { relayUrl: relay, roomCode: room };
}

export function parseTogetherDeepLink(input: string): ParsedInvite | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "harbor:" ||
      url.hostname !== "together" ||
      (url.pathname && url.pathname !== "/")
    )
      return null;
    if (url.username || url.password || url.port || url.hash) return null;
    return parseInviteParams(url.searchParams);
  } catch {
    return null;
  }
}

export function buildInviteUrl(
  relayUrl: string,
  roomCode: string,
  origin?: string,
  sessionId?: string,
): string {
  const local =
    typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)
      ? window.location.origin
      : WEB_JOIN_BASE;
  const base = origin ?? local;
  const params = new URLSearchParams();
  params.set(RELAY_PARAM, relayUrl);
  params.set(ROOM_PARAM, roomCode.toUpperCase());
  if (sessionId) params.set(SESSION_PARAM, sessionId);
  return `${base}/?${params.toString()}`;
}

export function parseInviteFromLocation(): ParsedInvite | null {
  if (typeof window === "undefined") return null;
  return parseInviteParams(new URLSearchParams(window.location.search));
}

export function clearInviteParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete(RELAY_PARAM);
  url.searchParams.delete(ROOM_PARAM);
  url.searchParams.delete(SESSION_PARAM);
  window.history.replaceState(null, "", url.toString());
}
