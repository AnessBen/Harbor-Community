const castStudio: Record<string, string> = {
  "Video sent as is": "الفيديو يُرسل كما هو",
  "Video converted to H.264 {height}p": "الفيديو محوّل إلى H.264 بدقة {height}p",
  "Audio sent as is": "الصوت يُرسل كما هو",
  "Audio as {codec}": "الصوت بصيغة {codec}",
  "Same as the player": "نفس المشغّل",
  "Track {number}": "المسار {number}",
  "Add subtitle file…": "إضافة ملف ترجمة…",
  Device: "الجهاز",
  "Device model": "طراز الجهاز",
  "Sent to the TV": "المُرسل إلى التلفزيون",
  Hardware: "العتاد",
  "Processor only": "المعالج فقط",
  "If the TV shows nothing or stops:": "إذا لم يظهر شيء على التلفزيون أو توقف:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "اجعل التلفزيون وهذا الكمبيوتر على نفس شبكة Wi-Fi أو الراوتر.",
  "Allow Harbor through the Windows firewall on private networks.":
    "اسمح لـ Harbor عبر جدار حماية Windows على الشبكات الخاصة.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "اختر طريقة البث MPEG-TS للتلفزيونات القديمة، أو HLS لأجهزة التلفزيون الذكية.",
  "Turn on Force conversion if the picture or sound is missing.":
    "فعّل «فرض التحويل» إذا غابت الصورة أو الصوت.",
  "Lower the quality to 720p on a slow Wi-Fi.": "خفّض الجودة إلى 720p إذا كانت شبكة Wi-Fi بطيئة.",
  "Converter ready. Hardware: {hardware}": "المحوّل جاهز. العتاد: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "لم يُعثر على ffmpeg، لذا لا يمكن بث الفيديوهات التي تحتاج إلى تحويل.",
  Surround: "الصوت المحيطي",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "الستيريو يعمل على كل تلفزيون. أما Dolby Digital 5.1 فيحتاج تلفزيونًا أو مُستقبِلًا يدعمه.",
  "Stereo downmix": "دمج إلى ستيريو",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "الأصلي (تمرير مباشر)",
  "Raises quiet films on the TV without clipping.":
    "يرفع صوت الأفلام الهادئة على التلفزيون دون تشويه.",
  "Clear dialogue": "حوار أوضح",
  "Audio delay": "تأخير الصوت",
  "Character set": "ترميز الأحرف",
  Encoding: "الترميز",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "لملفات الترجمة التي تظهر برموز غريبة. الملفات العربية غالبًا بترميز Windows-1256.",
  "Arabic (Windows-1256)": "العربية (Windows-1256)",
  "Western (Windows-1252)": "الغربية (Windows-1252)",
  "Cyrillic (Windows-1251)": "السيريلية (Windows-1251)",
  "Greek (Windows-1253)": "اليونانية (Windows-1253)",
  "Turkish (Windows-1254)": "التركية (Windows-1254)",
  "Hebrew (Windows-1255)": "العبرية (Windows-1255)",
  Rendering: "طريقة العرض",
  "Burned-in subtitles always show, on any TV.":
    "الترجمة المدموجة في الصورة تظهر دائمًا على أي تلفزيون.",
  "Burn in video": "دمج في الصورة",
  Pink: "وردي",
  "Bottom edge": "أسفل الشاشة",
  "Slightly higher": "أعلى قليلًا",
  "Higher up": "أعلى",
  "Subtitle delay": "تأخير الترجمة",
  Deinterlace: "إزالة التشابك",
  Always: "دائمًا",
  "Fill screen": "ملء الشاشة",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "الجودة الأعلى تحتاج Wi-Fi أسرع، ودقة 4K تحتاج تلفزيون 4K.",
  "1080p HQ": "1080p عالية الجودة",
  "Force conversion": "فرض التحويل",
  Accelerate: "التسريع",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "يستخدم {hardware} ليبقى الكمبيوتر باردًا ويبدأ التلفزيون أسرع.",
  "No supported graphics card was found; the processor converts instead.":
    "لم يُعثر على كرت شاشة مدعوم، لذلك يتولى المعالج التحويل.",
  Decoding: "فك الترميز",
  Scrubbing: "التقديم السريع",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "فقط إذا كان تلفزيونك يشغّل H.265 بنفسه: يُرسل الفيلم دون تعديل مع HDR.",
  "Native playback": "تشغيل أصلي",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "يحوّل ألوان HDR وDolby Vision للتلفزيونات التي تعرضها باهتة.",
  "Tone-map to SDR": "تحويل الألوان إلى SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "الوضع التلقائي يختار MPEG-TS لتلفزيونات DLNA وHLS لغيرها.",
  "About this cast": "عن هذا البث",
  "Applying to the TV…": "جارٍ التطبيق على التلفزيون…",
  "HDR tone-mapped": "ألوان HDR محوّلة",
  "Changes apply to the TV right away.": "تُطبق التغييرات على التلفزيون فورًا.",
  "These settings apply when you pick a device.": "تُطبق هذه الإعدادات عند اختيار جهاز.",
  "Subtitles on TV": "الترجمة على التلفزيون",
  "Cast settings": "إعدادات البث",
  "Audio, subtitles, quality and acceleration": "الصوت والترجمة والجودة والتسريع",
  "TV volume": "صوت التلفزيون",
  "Applying…": "جارٍ التطبيق…",
  "Converting {speed}×": "تحويل {speed}×",
  Direct: "مباشر",
  "The TV stopped answering. Harbor keeps looking for it.":
    "التلفزيون توقف عن الاستجابة. يواصل Harbor البحث عنه.",
  "Playback stopped on the TV.": "توقف التشغيل على التلفزيون.",
  "Resume on TV": "استئناف على التلفزيون",
  "Not responding": "لا يستجيب",
  "Stopped on": "متوقف على",
  Synced: "متزامن",
  "Set automatically for {device}": "مضبوطة تلقائيًا لـ {device}",
  "Settings for {device}, with your changes": "إعدادات {device} مع تعديلاتك",
  "Back to automatic": "العودة إلى التلقائي",
  "These settings set themselves for the device you pick.":
    "تُضبط هذه الإعدادات تلقائيًا حسب الجهاز الذي تختاره.",
  "Subtitles will look like this on the TV.": "هكذا ستظهر الترجمة على التلفاز.",
  "Conversion speed": "سرعة التحويل",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "الكمبيوتر يحوّل أبطأ من سرعة تشغيل الفيلم. فعّل كرت الشاشة أو خفّض الجودة.",
};
export default castStudio;
