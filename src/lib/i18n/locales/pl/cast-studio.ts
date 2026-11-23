const castStudio: Record<string, string> = {
  "Video sent as is": "Wideo wysyłane bez zmian",
  "Video converted to H.264 {height}p": "Wideo przekonwertowane do H.264 {height}p",
  "Audio sent as is": "Dźwięk wysyłany bez zmian",
  "Audio as {codec}": "Dźwięk jako {codec}",
  "Same as the player": "Tak jak w odtwarzaczu",
  "Track {number}": "Ścieżka {number}",
  "Add subtitle file…": "Dodaj plik napisów…",
  Device: "Urządzenie",
  "Device model": "Model urządzenia",
  "Sent to the TV": "Wysyłane do telewizora",
  Hardware: "Sprzęt",
  "Processor only": "Tylko procesor",
  "If the TV shows nothing or stops:": "Jeśli telewizor nic nie pokazuje lub się zatrzymuje:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Telewizor i ten komputer muszą być w tej samej sieci Wi-Fi lub przy tym samym routerze.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Zezwól na Harbor w zaporze Windows w sieciach prywatnych.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Wybierz MPEG-TS dla starszych telewizorów lub HLS dla przystawek TV.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Włącz „Wymuś konwersję”, jeśli brakuje obrazu lub dźwięku.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Przy wolnym Wi-Fi obniż jakość do 720p.",
  "Converter ready. Hardware: {hardware}": "Konwerter gotowy. Sprzęt: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "Nie znaleziono ffmpeg, więc filmów wymagających konwersji nie można przesłać.",
  Surround: "Dźwięk przestrzenny",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Stereo działa na każdym telewizorze. Dolby Digital 5.1 wymaga telewizora lub amplitunera, który je dekoduje.",
  "Stereo downmix": "Miks do stereo",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Oryginał (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Podgłaśnia ciche filmy na telewizorze bez przesterowań.",
  "Clear dialogue": "Wyraźniejsze dialogi",
  "Audio delay": "Opóźnienie dźwięku",
  "Character set": "Zestaw znaków",
  Encoding: "Kodowanie",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Dla napisów z dziwnymi znakami. Pliki arabskie to zwykle Windows-1256.",
  "Arabic (Windows-1256)": "Arabskie (Windows-1256)",
  "Western (Windows-1252)": "Zachodnie (Windows-1252)",
  "Cyrillic (Windows-1251)": "Cyrylica (Windows-1251)",
  "Greek (Windows-1253)": "Greckie (Windows-1253)",
  "Turkish (Windows-1254)": "Tureckie (Windows-1254)",
  "Hebrew (Windows-1255)": "Hebrajskie (Windows-1255)",
  Rendering: "Wyświetlanie",
  "Burned-in subtitles always show, on any TV.":
    "Wtopione napisy zawsze są widoczne, na każdym telewizorze.",
  "Burn in video": "Wtop w obraz",
  Pink: "Różowy",
  "Bottom edge": "Dolna krawędź",
  "Slightly higher": "Nieco wyżej",
  "Higher up": "Wyżej",
  "Subtitle delay": "Opóźnienie napisów",
  Deinterlace: "Usuwanie przeplotu",
  Always: "Zawsze",
  "Fill screen": "Wypełnij ekran",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Wyższa jakość wymaga szybszego Wi-Fi. 4K wymaga telewizora 4K.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Wymuś konwersję",
  Accelerate: "Przyspieszanie",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Używa {hardware}, więc komputer się nie grzeje, a telewizor startuje szybciej.",
  "No supported graphics card was found; the processor converts instead.":
    "Nie znaleziono obsługiwanej karty graficznej; konwertuje procesor.",
  Decoding: "Dekodowanie",
  Scrubbing: "Szybkie przewijanie",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Tylko jeśli Twój telewizor sam odtwarza H.265: film jest wysyłany bez zmian, z HDR.",
  "Native playback": "Odtwarzanie natywne",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Konwertuje kolory HDR i Dolby Vision dla telewizorów, które pokazałyby je wyblakłe.",
  "Tone-map to SDR": "Mapowanie tonów do SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Auto wybiera MPEG-TS dla telewizorów DLNA i HLS dla pozostałych.",
  "About this cast": "O tej transmisji",
  "Applying to the TV…": "Stosowanie na telewizorze…",
  "HDR tone-mapped": "HDR z mapowaniem tonów",
  "Changes apply to the TV right away.": "Zmiany od razu trafiają na telewizor.",
  "These settings apply when you pick a device.": "Te ustawienia działają po wybraniu urządzenia.",
  "Subtitles on TV": "Napisy na telewizorze",
  "Cast settings": "Ustawienia przesyłania",
  "Audio, subtitles, quality and acceleration": "Dźwięk, napisy, jakość i przyspieszanie",
  "TV volume": "Głośność telewizora",
  "Applying…": "Stosowanie…",
  "Converting {speed}×": "Konwersja {speed}×",
  Direct: "Bezpośrednio",
  "The TV stopped answering. Harbor keeps looking for it.":
    "Telewizor przestał odpowiadać. Harbor nadal go szuka.",
  "Playback stopped on the TV.": "Odtwarzanie na telewizorze zostało zatrzymane.",
  "Resume on TV": "Wznów na telewizorze",
  "Not responding": "Nie odpowiada",
  "Stopped on": "Zatrzymano na",
  Synced: "Zsynchronizowano",
  "Set automatically for {device}": "Ustawione automatycznie dla {device}",
  "Settings for {device}, with your changes": "Ustawienia dla {device}, z Twoimi zmianami",
  "Back to automatic": "Wróć do automatycznych",
  "These settings set themselves for the device you pick.":
    "Te ustawienia dopasowują się do wybranego urządzenia.",
  "Subtitles will look like this on the TV.": "Tak napisy będą wyglądać na telewizorze.",
  "Conversion speed": "Szybkość konwersji",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Komputer konwertuje wolniej, niż film jest odtwarzany. Włącz kartę graficzną lub obniż jakość.",
};
export default castStudio;
