import type { Settings } from "@/lib/settings";

type WindowSettings = Pick<
  Settings,
  "playerMpvEmbed" | "playerHdrToSdr" | "playerHdrOpaqueWindow"
> &
  Partial<Pick<Settings, "playerLinuxEmbeddedHdr">>;

/** The optional experimental backend is only routed when explicitly selected
 * and the running desktop advertises a compatible renderer and compositor. */
export function mpvWindowPolicy(
  settings: WindowSettings,
  linux: boolean,
  windows: boolean,
  linuxEmbeddedHdrAvailable = false,
) {
  const linuxHdrEmbedded =
    linux &&
    !settings.playerHdrToSdr &&
    settings.playerLinuxEmbeddedHdr === true &&
    linuxEmbeddedHdrAvailable;
  const linuxHdrWindow = linux && !settings.playerHdrToSdr && !linuxHdrEmbedded;
  const hdrWindow = linuxHdrWindow || (windows && settings.playerHdrOpaqueWindow);
  return {
    linuxHdrWindow,
    linuxHdrEmbedded,
    hdrWindow,
    embed: linuxHdrEmbedded || (settings.playerMpvEmbed && !hdrWindow),
  };
}
