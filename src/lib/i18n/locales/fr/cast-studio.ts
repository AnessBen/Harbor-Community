const castStudio: Record<string, string> = {
  "Video sent as is": "Vidéo envoyée telle quelle",
  "Video converted to H.264 {height}p": "Vidéo convertie en H.264 {height}p",
  "Audio sent as is": "Audio envoyé tel quel",
  "Audio as {codec}": "Audio en {codec}",
  "Same as the player": "Comme le lecteur",
  "Track {number}": "Piste {number}",
  "Add subtitle file…": "Ajouter un fichier de sous-titres…",
  Device: "Appareil",
  "Device model": "Modèle de l’appareil",
  "Sent to the TV": "Envoyé à la TV",
  Hardware: "Matériel",
  "Processor only": "Processeur seulement",
  "If the TV shows nothing or stops:": "Si la TV n’affiche rien ou s’arrête :",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Gardez la TV et cet ordinateur sur le même Wi-Fi ou routeur.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Autorisez Harbor dans le pare-feu Windows pour les réseaux privés.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Choisissez MPEG-TS pour les anciennes TV, ou HLS pour les box TV.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Activez « Forcer la conversion » si l’image ou le son manque.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Baissez la qualité à 720p si le Wi-Fi est lent.",
  "Converter ready. Hardware: {hardware}": "Convertisseur prêt. Matériel : {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg est introuvable : les vidéos à convertir ne peuvent pas être diffusées.",
  Surround: "Surround",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "La stéréo fonctionne sur toutes les TV. Le Dolby Digital 5.1 exige une TV ou un ampli qui le décode.",
  "Stereo downmix": "Mixage stéréo",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Original (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Augmente le volume des films trop calmes sur la TV, sans saturation.",
  "Clear dialogue": "Dialogues plus clairs",
  "Audio delay": "Décalage audio",
  "Character set": "Jeu de caractères",
  Encoding: "Encodage",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Pour les sous-titres qui affichent des symboles étranges. Les fichiers arabes sont souvent en Windows-1256.",
  "Arabic (Windows-1256)": "Arabe (Windows-1256)",
  "Western (Windows-1252)": "Occidental (Windows-1252)",
  "Cyrillic (Windows-1251)": "Cyrillique (Windows-1251)",
  "Greek (Windows-1253)": "Grec (Windows-1253)",
  "Turkish (Windows-1254)": "Turc (Windows-1254)",
  "Hebrew (Windows-1255)": "Hébreu (Windows-1255)",
  Rendering: "Rendu",
  "Burned-in subtitles always show, on any TV.":
    "Les sous-titres incrustés s’affichent toujours, sur toute TV.",
  "Burn in video": "Incruster dans l’image",
  Pink: "Rose",
  "Bottom edge": "Bas de l’écran",
  "Slightly higher": "Un peu plus haut",
  "Higher up": "Plus haut",
  "Subtitle delay": "Décalage des sous-titres",
  Deinterlace: "Désentrelacement",
  Always: "Toujours",
  "Fill screen": "Remplir l’écran",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Une meilleure qualité demande un Wi-Fi plus rapide. La 4K demande une TV 4K.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Forcer la conversion",
  Accelerate: "Accélération",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Utilise {hardware} pour que l’ordinateur reste frais et que la TV démarre plus vite.",
  "No supported graphics card was found; the processor converts instead.":
    "Aucune carte graphique compatible trouvée : le processeur convertit à la place.",
  Decoding: "Décodage",
  Scrubbing: "Avance rapide",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Seulement si votre TV lit le H.265 elle-même : le film est envoyé intact, HDR compris.",
  "Native playback": "Lecture native",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Convertit les couleurs HDR et Dolby Vision pour les TV qui les afficheraient délavées.",
  "Tone-map to SDR": "Tone mapping vers SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Auto choisit MPEG-TS pour les TV DLNA et HLS pour le reste.",
  "About this cast": "À propos de cette diffusion",
  "Applying to the TV…": "Application à la TV…",
  "HDR tone-mapped": "HDR converti",
  "Changes apply to the TV right away.": "Les changements s’appliquent tout de suite à la TV.",
  "These settings apply when you pick a device.":
    "Ces réglages s’appliquent quand vous choisissez un appareil.",
  "Subtitles on TV": "Sous-titres sur la TV",
  "Cast settings": "Réglages de diffusion",
  "Audio, subtitles, quality and acceleration": "Audio, sous-titres, qualité et accélération",
  "TV volume": "Volume de la TV",
  "Applying…": "Application…",
  "Converting {speed}×": "Conversion {speed}×",
  Direct: "Direct",
  "The TV stopped answering. Harbor keeps looking for it.":
    "La TV ne répond plus. Harbor continue de la chercher.",
  "Playback stopped on the TV.": "La lecture s’est arrêtée sur la TV.",
  "Resume on TV": "Reprendre sur la TV",
  "Not responding": "Ne répond pas",
  "Stopped on": "Arrêté sur",
  Synced: "Synchronisé",
  "Set automatically for {device}": "Réglé automatiquement pour {device}",
  "Settings for {device}, with your changes": "Réglages pour {device}, avec vos modifications",
  "Back to automatic": "Revenir au réglage automatique",
  "These settings set themselves for the device you pick.":
    "Ces réglages s’adaptent à l’appareil que vous choisissez.",
  "Subtitles will look like this on the TV.":
    "Voici à quoi ressembleront les sous-titres sur la TV.",
  "Conversion speed": "Vitesse de conversion",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "L’ordinateur convertit moins vite que le film ne défile. Activez la carte graphique ou baissez la qualité.",
};
export default castStudio;
