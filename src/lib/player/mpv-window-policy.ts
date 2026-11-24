import type { Settings } from "@/lib/settings";

type WindowSettings = Pick<
  Settings,
  "playerMpvEmbed" | "playerHdrToSdr" | "playerHdrOpaqueWindow"
>;

/** Linux's GTK3 render API is SDR-only; native HDR needs mpv's own window.
 * Keep the saved embed preference intact so switching back to SDR restores it. */
export function mpvWindowPolicy(settings: WindowSettings, linux: boolean, windows: boolean) {
  const linuxHdrWindow = linux && !settings.playerHdrToSdr;
  const hdrWindow = linuxHdrWindow || (windows && settings.playerHdrOpaqueWindow);
  return { linuxHdrWindow, hdrWindow, embed: settings.playerMpvEmbed && !hdrWindow };
}
