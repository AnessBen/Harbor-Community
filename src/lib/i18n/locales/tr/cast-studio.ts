const castStudio: Record<string, string> = {
  "Video sent as is": "Video olduğu gibi gönderilir",
  "Video converted to H.264 {height}p": "Video H.264 {height}p olarak dönüştürüldü",
  "Audio sent as is": "Ses olduğu gibi gönderilir",
  "Audio as {codec}": "Ses {codec} olarak",
  "Same as the player": "Oynatıcıyla aynı",
  "Track {number}": "Parça {number}",
  "Add subtitle file…": "Altyazı dosyası ekle…",
  Device: "Cihaz",
  "Device model": "Cihaz modeli",
  "Sent to the TV": "TV'ye gönderilen",
  Hardware: "Donanım",
  "Processor only": "Yalnızca işlemci",
  "If the TV shows nothing or stops:": "TV hiçbir şey göstermiyor veya duruyorsa:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "TV'yi ve bu bilgisayarı aynı Wi-Fi'ye veya modeme bağlayın.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Özel ağlarda Windows güvenlik duvarında Harbor'a izin verin.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Eski TV'ler için Akışı MPEG-TS, TV kutuları için HLS yapın.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Görüntü veya ses yoksa «Dönüştürmeyi zorla»yı açın.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Wi-Fi yavaşsa kaliteyi 720p'ye düşürün.",
  "Converter ready. Hardware: {hardware}": "Dönüştürücü hazır. Donanım: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg bulunamadı, bu yüzden dönüştürülmesi gereken videolar yayınlanamaz.",
  Surround: "Surround",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Stereo her TV'de çalışır. Dolby Digital 5.1 için bunu çözebilen bir TV veya alıcı gerekir.",
  "Stereo downmix": "Stereoya indir",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Orijinal (doğrudan geçiş)",
  "Raises quiet films on the TV without clipping.":
    "Kısık filmlerin sesini TV'de bozmadan yükseltir.",
  "Clear dialogue": "Net diyaloglar",
  "Audio delay": "Ses gecikmesi",
  "Character set": "Karakter kümesi",
  Encoding: "Kodlama",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Garip simgeler gösteren altyazılar için. Arapça dosyalar genelde Windows-1256'dır.",
  "Arabic (Windows-1256)": "Arapça (Windows-1256)",
  "Western (Windows-1252)": "Batı (Windows-1252)",
  "Cyrillic (Windows-1251)": "Kiril (Windows-1251)",
  "Greek (Windows-1253)": "Yunanca (Windows-1253)",
  "Turkish (Windows-1254)": "Türkçe (Windows-1254)",
  "Hebrew (Windows-1255)": "İbranice (Windows-1255)",
  Rendering: "Gösterim",
  "Burned-in subtitles always show, on any TV.":
    "Görüntüye gömülü altyazılar her TV'de her zaman görünür.",
  "Burn in video": "Görüntüye göm",
  Pink: "Pembe",
  "Bottom edge": "Alt kenar",
  "Slightly higher": "Biraz daha yukarı",
  "Higher up": "Daha yukarı",
  "Subtitle delay": "Altyazı gecikmesi",
  Deinterlace: "Taramayı birleştir",
  Always: "Her zaman",
  "Fill screen": "Ekranı doldur",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Daha yüksek kalite daha hızlı Wi-Fi ister. 4K için 4K TV gerekir.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Dönüştürmeyi zorla",
  Accelerate: "Hızlandırma",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "{hardware} kullanılır; bilgisayar ısınmaz ve TV daha hızlı başlar.",
  "No supported graphics card was found; the processor converts instead.":
    "Desteklenen ekran kartı bulunamadı; dönüştürmeyi işlemci yapar.",
  Decoding: "Kod çözme",
  Scrubbing: "Hızlı sarma",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Yalnızca TV'niz H.265'i kendisi oynatıyorsa: film HDR dahil olduğu gibi gönderilir.",
  "Native playback": "Yerel oynatma",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "HDR ve Dolby Vision renklerini soluk gösterecek TV'ler için dönüştürür.",
  "Tone-map to SDR": "SDR'ye ton eşleme",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Otomatik, DLNA TV'ler için MPEG-TS'yi, diğerleri için HLS'yi seçer.",
  "About this cast": "Bu yayın hakkında",
  "Applying to the TV…": "TV'ye uygulanıyor…",
  "HDR tone-mapped": "HDR ton eşlendi",
  "Changes apply to the TV right away.": "Değişiklikler TV'ye hemen uygulanır.",
  "These settings apply when you pick a device.": "Bu ayarlar bir cihaz seçtiğinizde uygulanır.",
  "Subtitles on TV": "TV'de altyazı",
  "Cast settings": "Yayın ayarları",
  "Audio, subtitles, quality and acceleration": "Ses, altyazı, kalite ve hızlandırma",
  "TV volume": "TV ses düzeyi",
  "Applying…": "Uygulanıyor…",
  "Converting {speed}×": "Dönüştürülüyor {speed}×",
  Direct: "Doğrudan",
  "The TV stopped answering. Harbor keeps looking for it.":
    "TV yanıt vermiyor. Harbor onu aramaya devam ediyor.",
  "Playback stopped on the TV.": "TV'de oynatma durdu.",
  "Resume on TV": "TV'de devam et",
  "Not responding": "Yanıt vermiyor",
  "Stopped on": "Durdu:",
  Synced: "Senkronize",
  "Set automatically for {device}": "{device} için otomatik ayarlandı",
  "Settings for {device}, with your changes": "{device} ayarları, değişikliklerinizle",
  "Back to automatic": "Otomatiğe dön",
  "These settings set themselves for the device you pick.":
    "Bu ayarlar seçtiğiniz cihaza göre kendiliğinden ayarlanır.",
  "Subtitles will look like this on the TV.": "Altyazılar TV'de böyle görünecek.",
  "Conversion speed": "Dönüştürme hızı",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Bilgisayar, filmin oynatılmasından daha yavaş dönüştürüyor. Ekran kartını açın veya kaliteyi düşürün.",
};
export default castStudio;
