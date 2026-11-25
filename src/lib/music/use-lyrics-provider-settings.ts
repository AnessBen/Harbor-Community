import { useSyncExternalStore } from "react";
import { neteaseLyricsEnabled, subscribeLyricsProviders } from "./lyrics-provider-settings";
export function useNeteaseLyricsEnabled(): boolean {
  return useSyncExternalStore(subscribeLyricsProviders, neteaseLyricsEnabled, () => false);
}
