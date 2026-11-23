const castStudio: Record<string, string> = {
  "Video sent as is": "Video wird unverändert gesendet",
  "Video converted to H.264 {height}p": "Video in H.264 {height}p umgewandelt",
  "Audio sent as is": "Audio wird unverändert gesendet",
  "Audio as {codec}": "Audio als {codec}",
  "Same as the player": "Wie im Player",
  "Track {number}": "Spur {number}",
  "Add subtitle file…": "Untertiteldatei hinzufügen…",
  Device: "Gerät",
  "Device model": "Gerätemodell",
  "Sent to the TV": "Zum Fernseher gesendet",
  Hardware: "Hardware",
  "Processor only": "Nur Prozessor",
  "If the TV shows nothing or stops:": "Wenn der Fernseher nichts zeigt oder stoppt:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Fernseher und Computer müssen im selben WLAN oder am selben Router sein.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Erlaube Harbor in der Windows-Firewall für private Netzwerke.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Wähle beim Streaming MPEG-TS für ältere Fernseher oder HLS für TV-Boxen.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Aktiviere „Umwandlung erzwingen“, wenn Bild oder Ton fehlen.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Senke die Qualität bei langsamem WLAN auf 720p.",
  "Converter ready. Hardware: {hardware}": "Konverter bereit. Hardware: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg wurde nicht gefunden, daher können Videos, die umgewandelt werden müssen, nicht gestreamt werden.",
  Surround: "Surround",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Stereo funktioniert auf jedem Fernseher. Dolby Digital 5.1 braucht einen Fernseher oder Receiver, der es dekodiert.",
  "Stereo downmix": "Stereo-Downmix",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Original (Passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Hebt leise Filme auf dem Fernseher an, ohne zu übersteuern.",
  "Clear dialogue": "Klarere Dialoge",
  "Audio delay": "Audioverzögerung",
  "Character set": "Zeichensatz",
  Encoding: "Kodierung",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Für Untertiteldateien mit seltsamen Zeichen. Arabische Dateien sind meist Windows-1256.",
  "Arabic (Windows-1256)": "Arabisch (Windows-1256)",
  "Western (Windows-1252)": "Westlich (Windows-1252)",
  "Cyrillic (Windows-1251)": "Kyrillisch (Windows-1251)",
  "Greek (Windows-1253)": "Griechisch (Windows-1253)",
  "Turkish (Windows-1254)": "Türkisch (Windows-1254)",
  "Hebrew (Windows-1255)": "Hebräisch (Windows-1255)",
  Rendering: "Darstellung",
  "Burned-in subtitles always show, on any TV.":
    "Eingebrannte Untertitel erscheinen immer, auf jedem Fernseher.",
  "Burn in video": "Ins Bild einbrennen",
  Pink: "Rosa",
  "Bottom edge": "Unterer Rand",
  "Slightly higher": "Etwas höher",
  "Higher up": "Weiter oben",
  "Subtitle delay": "Untertitelverzögerung",
  Deinterlace: "Deinterlacing",
  Always: "Immer",
  "Fill screen": "Bild füllen",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Höhere Qualität braucht schnelleres WLAN. 4K braucht einen 4K-Fernseher.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Umwandlung erzwingen",
  Accelerate: "Beschleunigung",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Nutzt {hardware}, damit der Computer kühl bleibt und der Fernseher schneller startet.",
  "No supported graphics card was found; the processor converts instead.":
    "Keine unterstützte Grafikkarte gefunden; der Prozessor wandelt stattdessen um.",
  Decoding: "Dekodierung",
  Scrubbing: "Schnelles Spulen",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Nur wenn dein Fernseher H.265 selbst abspielt: Der Film wird unverändert gesendet, inklusive HDR.",
  "Native playback": "Native Wiedergabe",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Wandelt HDR- und Dolby-Vision-Farben für Fernseher um, die sie sonst blass zeigen.",
  "Tone-map to SDR": "Tone-Mapping auf SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Automatisch wählt MPEG-TS für DLNA-Fernseher und HLS für alles andere.",
  "About this cast": "Über diese Übertragung",
  "Applying to the TV…": "Wird auf den Fernseher angewendet…",
  "HDR tone-mapped": "HDR per Tone-Mapping",
  "Changes apply to the TV right away.": "Änderungen gelten sofort auf dem Fernseher.",
  "These settings apply when you pick a device.":
    "Diese Einstellungen gelten, wenn du ein Gerät wählst.",
  "Subtitles on TV": "Untertitel auf dem Fernseher",
  "Cast settings": "Übertragungseinstellungen",
  "Audio, subtitles, quality and acceleration": "Audio, Untertitel, Qualität und Beschleunigung",
  "TV volume": "Fernsehlautstärke",
  "Applying…": "Wird angewendet…",
  "Converting {speed}×": "Umwandlung {speed}×",
  Direct: "Direkt",
  "The TV stopped answering. Harbor keeps looking for it.":
    "Der Fernseher antwortet nicht mehr. Harbor sucht weiter nach ihm.",
  "Playback stopped on the TV.": "Die Wiedergabe auf dem Fernseher wurde beendet.",
  "Resume on TV": "Auf dem Fernseher fortsetzen",
  "Not responding": "Reagiert nicht",
  "Stopped on": "Gestoppt auf",
  Synced: "Synchronisiert",
  "Set automatically for {device}": "Automatisch eingestellt für {device}",
  "Settings for {device}, with your changes": "Einstellungen für {device}, mit deinen Änderungen",
  "Back to automatic": "Zurück zu automatisch",
  "These settings set themselves for the device you pick.":
    "Diese Einstellungen passen sich dem Gerät an, das du auswählst.",
  "Subtitles will look like this on the TV.": "So sehen die Untertitel auf dem Fernseher aus.",
  "Conversion speed": "Konvertierungsgeschwindigkeit",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Der Computer wandelt langsamer um, als der Film läuft. Schalte die Grafikkarte ein oder senke die Qualität.",
};
export default castStudio;
