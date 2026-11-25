import { readMusicPreference, writeMusicPreference } from "./preferences";
const KEY = "harbor.music.lyrics.netease.v1";
const listeners = new Set<() => void>();
export const neteaseLyricsEnabled = () => readMusicPreference(KEY) === "true";
export function setNeteaseLyricsEnabled(enabled: boolean): void {
  if (neteaseLyricsEnabled() === enabled) return;
  writeMusicPreference(KEY, String(enabled));
  for (const listener of listeners) listener();
}
export function subscribeLyricsProviders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
