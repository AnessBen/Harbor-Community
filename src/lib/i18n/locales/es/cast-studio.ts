const castStudio: Record<string, string> = {
  "Video sent as is": "Vídeo enviado tal cual",
  "Video converted to H.264 {height}p": "Vídeo convertido a H.264 {height}p",
  "Audio sent as is": "Audio enviado tal cual",
  "Audio as {codec}": "Audio como {codec}",
  "Same as the player": "Igual que el reproductor",
  "Track {number}": "Pista {number}",
  "Add subtitle file…": "Añadir archivo de subtítulos…",
  Device: "Dispositivo",
  "Device model": "Modelo del dispositivo",
  "Sent to the TV": "Enviado a la TV",
  Hardware: "Hardware",
  "Processor only": "Solo el procesador",
  "If the TV shows nothing or stops:": "Si la TV no muestra nada o se detiene:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Mantén la TV y este ordenador en la misma Wi-Fi o router.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Permite Harbor en el firewall de Windows para redes privadas.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Elige MPEG-TS en Transmisión para TV antiguas, o HLS para TV boxes.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Activa «Forzar conversión» si falta la imagen o el sonido.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Baja la calidad a 720p si la Wi-Fi es lenta.",
  "Converter ready. Hardware: {hardware}": "Conversor listo. Hardware: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "No se encontró ffmpeg, así que no se pueden enviar los vídeos que necesitan conversión.",
  Surround: "Envolvente",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "El estéreo funciona en cualquier TV. Dolby Digital 5.1 necesita una TV o un receptor que lo decodifique.",
  "Stereo downmix": "Mezcla estéreo",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Original (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Sube el volumen de las películas bajas en la TV sin saturar.",
  "Clear dialogue": "Diálogos más claros",
  "Audio delay": "Retraso del audio",
  "Character set": "Juego de caracteres",
  Encoding: "Codificación",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Para subtítulos que muestran símbolos extraños. Los archivos árabes suelen ser Windows-1256.",
  "Arabic (Windows-1256)": "Árabe (Windows-1256)",
  "Western (Windows-1252)": "Occidental (Windows-1252)",
  "Cyrillic (Windows-1251)": "Cirílico (Windows-1251)",
  "Greek (Windows-1253)": "Griego (Windows-1253)",
  "Turkish (Windows-1254)": "Turco (Windows-1254)",
  "Hebrew (Windows-1255)": "Hebreo (Windows-1255)",
  Rendering: "Renderizado",
  "Burned-in subtitles always show, on any TV.":
    "Los subtítulos incrustados siempre se ven, en cualquier TV.",
  "Burn in video": "Incrustar en el vídeo",
  Pink: "Rosa",
  "Bottom edge": "Borde inferior",
  "Slightly higher": "Un poco más arriba",
  "Higher up": "Más arriba",
  "Subtitle delay": "Retraso de subtítulos",
  Deinterlace: "Desentrelazado",
  Always: "Siempre",
  "Fill screen": "Llenar pantalla",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Más calidad necesita una Wi-Fi más rápida. 4K necesita una TV 4K.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Forzar conversión",
  Accelerate: "Aceleración",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Usa {hardware} para que el ordenador no se caliente y la TV empiece antes.",
  "No supported graphics card was found; the processor converts instead.":
    "No se encontró una tarjeta gráfica compatible; el procesador hace la conversión.",
  Decoding: "Decodificación",
  Scrubbing: "Avance rápido",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Solo si tu TV reproduce H.265 por sí misma: la película se envía intacta, con HDR.",
  "Native playback": "Reproducción nativa",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Convierte los colores HDR y Dolby Vision para TV que los mostrarían apagados.",
  "Tone-map to SDR": "Mapeo de tonos a SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Automático elige MPEG-TS para TV DLNA y HLS para todo lo demás.",
  "About this cast": "Sobre esta transmisión",
  "Applying to the TV…": "Aplicando a la TV…",
  "HDR tone-mapped": "HDR con mapeo de tonos",
  "Changes apply to the TV right away.": "Los cambios se aplican a la TV al momento.",
  "These settings apply when you pick a device.":
    "Estos ajustes se aplican al elegir un dispositivo.",
  "Subtitles on TV": "Subtítulos en la TV",
  "Cast settings": "Ajustes de transmisión",
  "Audio, subtitles, quality and acceleration": "Audio, subtítulos, calidad y aceleración",
  "TV volume": "Volumen de la TV",
  "Applying…": "Aplicando…",
  "Converting {speed}×": "Convirtiendo {speed}×",
  Direct: "Directo",
  "The TV stopped answering. Harbor keeps looking for it.":
    "La TV dejó de responder. Harbor sigue buscándola.",
  "Playback stopped on the TV.": "La reproducción se detuvo en la TV.",
  "Resume on TV": "Reanudar en la TV",
  "Not responding": "No responde",
  "Stopped on": "Detenido en",
  Synced: "Sincronizado",
  "Set automatically for {device}": "Ajustado automáticamente para {device}",
  "Settings for {device}, with your changes": "Ajustes para {device}, con tus cambios",
  "Back to automatic": "Volver a automático",
  "These settings set themselves for the device you pick.":
    "Estos ajustes se adaptan al dispositivo que elijas.",
  "Subtitles will look like this on the TV.": "Así se verán los subtítulos en la TV.",
  "Conversion speed": "Velocidad de conversión",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "El ordenador convierte más despacio de lo que avanza la película. Activa la tarjeta gráfica o baja la calidad.",
};
export default castStudio;
