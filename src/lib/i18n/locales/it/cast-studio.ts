const castStudio: Record<string, string> = {
  "Video sent as is": "Video inviato così com’è",
  "Video converted to H.264 {height}p": "Video convertito in H.264 {height}p",
  "Audio sent as is": "Audio inviato così com’è",
  "Audio as {codec}": "Audio come {codec}",
  "Same as the player": "Come il player",
  "Track {number}": "Traccia {number}",
  "Add subtitle file…": "Aggiungi file di sottotitoli…",
  Device: "Dispositivo",
  "Device model": "Modello del dispositivo",
  "Sent to the TV": "Inviato alla TV",
  Hardware: "Hardware",
  "Processor only": "Solo processore",
  "If the TV shows nothing or stops:": "Se la TV non mostra nulla o si ferma:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Tieni la TV e questo computer sulla stessa Wi-Fi o sullo stesso router.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Consenti Harbor nel firewall di Windows per le reti private.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Scegli MPEG-TS per le TV più vecchie, oppure HLS per i TV box.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Attiva «Forza conversione» se mancano immagine o audio.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Abbassa la qualità a 720p se la Wi-Fi è lenta.",
  "Converter ready. Hardware: {hardware}": "Convertitore pronto. Hardware: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg non trovato: i video da convertire non possono essere trasmessi.",
  Surround: "Surround",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Lo stereo funziona su ogni TV. Il Dolby Digital 5.1 richiede una TV o un ricevitore che lo decodifichi.",
  "Stereo downmix": "Downmix stereo",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Originale (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Alza i film troppo bassi sulla TV senza distorsioni.",
  "Clear dialogue": "Dialoghi più chiari",
  "Audio delay": "Ritardo audio",
  "Character set": "Set di caratteri",
  Encoding: "Codifica",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Per i sottotitoli che mostrano simboli strani. I file arabi sono di solito Windows-1256.",
  "Arabic (Windows-1256)": "Arabo (Windows-1256)",
  "Western (Windows-1252)": "Occidentale (Windows-1252)",
  "Cyrillic (Windows-1251)": "Cirillico (Windows-1251)",
  "Greek (Windows-1253)": "Greco (Windows-1253)",
  "Turkish (Windows-1254)": "Turco (Windows-1254)",
  "Hebrew (Windows-1255)": "Ebraico (Windows-1255)",
  Rendering: "Visualizzazione",
  "Burned-in subtitles always show, on any TV.":
    "I sottotitoli impressi si vedono sempre, su ogni TV.",
  "Burn in video": "Imprimi nel video",
  Pink: "Rosa",
  "Bottom edge": "Bordo inferiore",
  "Slightly higher": "Un po’ più in alto",
  "Higher up": "Più in alto",
  "Subtitle delay": "Ritardo sottotitoli",
  Deinterlace: "Deinterlacciamento",
  Always: "Sempre",
  "Fill screen": "Riempi schermo",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Più qualità richiede una Wi-Fi più veloce. Il 4K richiede una TV 4K.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Forza conversione",
  Accelerate: "Accelerazione",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Usa {hardware} così il computer resta fresco e la TV parte prima.",
  "No supported graphics card was found; the processor converts instead.":
    "Nessuna scheda grafica supportata: converte il processore.",
  Decoding: "Decodifica",
  Scrubbing: "Avanzamento rapido",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Solo se la tua TV riproduce H.265 da sola: il film viene inviato intatto, HDR incluso.",
  "Native playback": "Riproduzione nativa",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Converte i colori HDR e Dolby Vision per le TV che li mostrerebbero sbiaditi.",
  "Tone-map to SDR": "Tone mapping in SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Auto sceglie MPEG-TS per le TV DLNA e HLS per tutto il resto.",
  "About this cast": "Info su questa trasmissione",
  "Applying to the TV…": "Applicazione alla TV…",
  "HDR tone-mapped": "HDR convertito",
  "Changes apply to the TV right away.": "Le modifiche si applicano subito alla TV.",
  "These settings apply when you pick a device.":
    "Queste impostazioni si applicano quando scegli un dispositivo.",
  "Subtitles on TV": "Sottotitoli sulla TV",
  "Cast settings": "Impostazioni di trasmissione",
  "Audio, subtitles, quality and acceleration": "Audio, sottotitoli, qualità e accelerazione",
  "TV volume": "Volume della TV",
  "Applying…": "Applicazione…",
  "Converting {speed}×": "Conversione {speed}×",
  Direct: "Diretto",
  "The TV stopped answering. Harbor keeps looking for it.":
    "La TV non risponde più. Harbor continua a cercarla.",
  "Playback stopped on the TV.": "La riproduzione sulla TV si è fermata.",
  "Resume on TV": "Riprendi sulla TV",
  "Not responding": "Non risponde",
  "Stopped on": "Fermato su",
  Synced: "Sincronizzato",
  "Set automatically for {device}": "Impostato automaticamente per {device}",
  "Settings for {device}, with your changes": "Impostazioni per {device}, con le tue modifiche",
  "Back to automatic": "Torna ad automatico",
  "These settings set themselves for the device you pick.":
    "Queste impostazioni si adattano al dispositivo che scegli.",
  "Subtitles will look like this on the TV.": "Ecco come appariranno i sottotitoli sulla TV.",
  "Conversion speed": "Velocità di conversione",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Il computer converte più lentamente di quanto scorre il film. Attiva la scheda grafica o abbassa la qualità.",
};
export default castStudio;
