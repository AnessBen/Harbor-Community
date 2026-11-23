const castStudio: Record<string, string> = {
  "Video sent as is": "Видео отправляется как есть",
  "Video converted to H.264 {height}p": "Видео преобразовано в H.264 {height}p",
  "Audio sent as is": "Звук отправляется как есть",
  "Audio as {codec}": "Звук в {codec}",
  "Same as the player": "Как в плеере",
  "Track {number}": "Дорожка {number}",
  "Add subtitle file…": "Добавить файл субтитров…",
  Device: "Устройство",
  "Device model": "Модель устройства",
  "Sent to the TV": "Отправляется на телевизор",
  Hardware: "Оборудование",
  "Processor only": "Только процессор",
  "If the TV shows nothing or stops:":
    "Если на телевизоре ничего нет или воспроизведение остановилось:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "Подключите телевизор и этот компьютер к одной сети Wi-Fi или роутеру.",
  "Allow Harbor through the Windows firewall on private networks.":
    "Разрешите Harbor в брандмауэре Windows для частных сетей.",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "Выберите MPEG-TS для старых телевизоров или HLS для ТВ-приставок.",
  "Turn on Force conversion if the picture or sound is missing.":
    "Включите «Принудительное преобразование», если нет изображения или звука.",
  "Lower the quality to 720p on a slow Wi-Fi.": "При медленном Wi-Fi снизьте качество до 720p.",
  "Converter ready. Hardware: {hardware}": "Конвертер готов. Оборудование: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg не найден, поэтому видео, которые нужно преобразовать, нельзя транслировать.",
  Surround: "Объёмный звук",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "Стерео работает на любом телевизоре. Для Dolby Digital 5.1 нужен телевизор или ресивер с его поддержкой.",
  "Stereo downmix": "Сведение в стерео",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "Оригинал (passthrough)",
  "Raises quiet films on the TV without clipping.":
    "Делает тихие фильмы громче на телевизоре без искажений.",
  "Clear dialogue": "Чёткие диалоги",
  "Audio delay": "Задержка звука",
  "Character set": "Кодировка текста",
  Encoding: "Кодирование",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "Для субтитров со странными символами. Арабские файлы обычно в Windows-1256.",
  "Arabic (Windows-1256)": "Арабская (Windows-1256)",
  "Western (Windows-1252)": "Западная (Windows-1252)",
  "Cyrillic (Windows-1251)": "Кириллица (Windows-1251)",
  "Greek (Windows-1253)": "Греческая (Windows-1253)",
  "Turkish (Windows-1254)": "Турецкая (Windows-1254)",
  "Hebrew (Windows-1255)": "Иврит (Windows-1255)",
  Rendering: "Отображение",
  "Burned-in subtitles always show, on any TV.":
    "Вшитые субтитры видны всегда, на любом телевизоре.",
  "Burn in video": "Вшить в видео",
  Pink: "Розовый",
  "Bottom edge": "Нижний край",
  "Slightly higher": "Чуть выше",
  "Higher up": "Выше",
  "Subtitle delay": "Задержка субтитров",
  Deinterlace: "Деинтерлейсинг",
  Always: "Всегда",
  "Fill screen": "Заполнить экран",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "Для высокого качества нужен быстрый Wi-Fi. Для 4K нужен 4K-телевизор.",
  "1080p HQ": "1080p HQ",
  "Force conversion": "Принудительное преобразование",
  Accelerate: "Ускорение",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "Использует {hardware}, чтобы компьютер не грелся, а телевизор запускался быстрее.",
  "No supported graphics card was found; the processor converts instead.":
    "Поддерживаемая видеокарта не найдена; преобразует процессор.",
  Decoding: "Декодирование",
  Scrubbing: "Быстрая перемотка",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "Только если телевизор сам воспроизводит H.265: фильм отправляется без изменений, вместе с HDR.",
  "Native playback": "Нативное воспроизведение",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "Преобразует цвета HDR и Dolby Vision для телевизоров, на которых они выглядят блёкло.",
  "Tone-map to SDR": "Тональная компрессия в SDR",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "Авто выбирает MPEG-TS для DLNA-телевизоров и HLS для остальных.",
  "About this cast": "Об этой трансляции",
  "Applying to the TV…": "Применение на телевизоре…",
  "HDR tone-mapped": "HDR преобразован",
  "Changes apply to the TV right away.": "Изменения сразу применяются на телевизоре.",
  "These settings apply when you pick a device.":
    "Эти настройки применяются при выборе устройства.",
  "Subtitles on TV": "Субтитры на телевизоре",
  "Cast settings": "Настройки трансляции",
  "Audio, subtitles, quality and acceleration": "Звук, субтитры, качество и ускорение",
  "TV volume": "Громкость телевизора",
  "Applying…": "Применение…",
  "Converting {speed}×": "Преобразование {speed}×",
  Direct: "Напрямую",
  "The TV stopped answering. Harbor keeps looking for it.":
    "Телевизор перестал отвечать. Harbor продолжает его искать.",
  "Playback stopped on the TV.": "Воспроизведение на телевизоре остановилось.",
  "Resume on TV": "Продолжить на телевизоре",
  "Not responding": "Не отвечает",
  "Stopped on": "Остановлено на",
  Synced: "Синхронизировано",
  "Set automatically for {device}": "Настроено автоматически для {device}",
  "Settings for {device}, with your changes": "Настройки для {device} с вашими изменениями",
  "Back to automatic": "Вернуть автоматические",
  "These settings set themselves for the device you pick.":
    "Эти настройки подстраиваются под выбранное устройство.",
  "Subtitles will look like this on the TV.": "Так субтитры будут выглядеть на телевизоре.",
  "Conversion speed": "Скорость преобразования",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "Компьютер преобразует медленнее, чем идёт фильм. Включите видеокарту или снизьте качество.",
};
export default castStudio;
