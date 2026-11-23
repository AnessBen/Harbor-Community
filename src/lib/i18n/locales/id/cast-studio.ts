const castStudio: Record<string, string> = {
  "Video sent as is": "Video dikirim apa adanya",
  "Video converted to H.264 {height}p": "Video diubah ke H.264 {height}p",
  "Audio sent as is": "Audio dikirim apa adanya",
  "Audio as {codec}": "Audio sebagai {codec}",
  "Same as the player": "Sama dengan pemutar",
  "Track {number}": "Trek {number}",
  "Add subtitle file…": "Tambah file subtitle…",
  Device: "Perangkat",
  "Device model": "Model perangkat",
  "Sent to the TV": "Dikirim ke TV",
  Hardware: "Perangkat keras",
  "Processor only": "Hanya prosesor",
  "If the TV shows nothing or stops:": "Jika TV tidak menampilkan apa pun atau berhenti:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Pastikan TV dan komputer ini di Wi-Fi atau router yang sama.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Izinkan Harbor di firewall Windows untuk jaringan pribadi.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Pilih MPEG-TS untuk TV lama, atau HLS untuk TV box.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Aktifkan «Paksa konversi» jika gambar atau suara hilang.",
  "Lower the quality to 720p on a slow Wi-Fi.": "Turunkan kualitas ke 720p jika Wi-Fi lambat.",
  "Converter ready. Hardware: {hardware}": "Konverter siap. Perangkat keras: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg tidak ditemukan, jadi video yang perlu dikonversi tidak bisa dikirim.",
  Surround: "Surround",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Stereo berfungsi di semua TV. Dolby Digital 5.1 butuh TV atau receiver yang mendukungnya.",
  "Stereo downmix": "Downmix stereo",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Asli (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Menaikkan suara film yang pelan di TV tanpa pecah.",
  "Clear dialogue": "Dialog lebih jelas",
  "Audio delay": "Jeda audio",
  "Character set": "Set karakter",
  Encoding: "Pengodean",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Untuk file subtitle yang menampilkan simbol aneh. File Arab biasanya Windows-1256.",
  "Arabic (Windows-1256)": "Arab (Windows-1256)",
  "Western (Windows-1252)": "Barat (Windows-1252)",
  "Cyrillic (Windows-1251)": "Sirilik (Windows-1251)",
  "Greek (Windows-1253)": "Yunani (Windows-1253)",
  "Turkish (Windows-1254)": "Turki (Windows-1254)",
  "Hebrew (Windows-1255)": "Ibrani (Windows-1255)",
  Rendering: "Tampilan",
  "Burned-in subtitles always show, on any TV.":
    "Subtitle yang dibakar selalu tampil di TV apa pun.",
  "Burn in video": "Bakar ke video",
  Pink: "Merah muda",
  "Bottom edge": "Tepi bawah",
  "Slightly higher": "Sedikit lebih tinggi",
  "Higher up": "Lebih tinggi",
  "Subtitle delay": "Jeda subtitle",
  Deinterlace: "Deinterlace",
  Always: "Selalu",
  "Fill screen": "Penuhi layar",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Kualitas lebih tinggi butuh Wi-Fi lebih cepat. 4K butuh TV 4K.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Paksa konversi",
  Accelerate: "Akselerasi",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Memakai {hardware} agar komputer tetap dingin dan TV mulai lebih cepat.",
  "No supported graphics card was found; the processor converts instead.":
    "Tidak ada kartu grafis yang didukung; prosesor yang mengonversi.",
  Decoding: "Pendekodean",
  Scrubbing: "Lompat cepat",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Hanya jika TV Anda memutar H.265 sendiri: film dikirim utuh, termasuk HDR.",
  "Native playback": "Pemutaran asli",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Mengubah warna HDR dan Dolby Vision untuk TV yang akan menampilkannya pucat.",
  "Tone-map to SDR": "Tone-map ke SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Otomatis memilih MPEG-TS untuk TV DLNA dan HLS untuk lainnya.",
  "About this cast": "Tentang pengiriman ini",
  "Applying to the TV…": "Menerapkan ke TV…",
  "HDR tone-mapped": "HDR di-tone-map",
  "Changes apply to the TV right away.": "Perubahan langsung diterapkan ke TV.",
  "These settings apply when you pick a device.":
    "Pengaturan ini berlaku saat Anda memilih perangkat.",
  "Subtitles on TV": "Subtitle di TV",
  "Cast settings": "Pengaturan cast",
  "Audio, subtitles, quality and acceleration": "Audio, subtitle, kualitas, dan akselerasi",
  "TV volume": "Volume TV",
  "Applying…": "Menerapkan…",
  "Converting {speed}×": "Mengonversi {speed}×",
  Direct: "Langsung",
  "The TV stopped answering. Harbor keeps looking for it.":
    "TV berhenti merespons. Harbor terus mencarinya.",
  "Playback stopped on the TV.": "Pemutaran di TV berhenti.",
  "Resume on TV": "Lanjutkan di TV",
  "Not responding": "Tidak merespons",
  "Stopped on": "Berhenti di",
  Synced: "Disinkronkan",
  "Set automatically for {device}": "Diatur otomatis untuk {device}",
  "Settings for {device}, with your changes": "Pengaturan untuk {device}, dengan perubahan Anda",
  "Back to automatic": "Kembali ke otomatis",
  "These settings set themselves for the device you pick.":
    "Pengaturan ini menyesuaikan diri dengan perangkat yang Anda pilih.",
  "Subtitles will look like this on the TV.": "Beginilah tampilan subtitle di TV.",
  "Conversion speed": "Kecepatan konversi",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Komputer mengonversi lebih lambat daripada film diputar. Aktifkan kartu grafis atau turunkan kualitas.",
};
export default castStudio;
