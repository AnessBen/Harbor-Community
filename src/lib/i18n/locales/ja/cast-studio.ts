const castStudio: Record<string, string> = {
  "Video sent as is": "映像はそのまま送信",
  "Video converted to H.264 {height}p": "映像を H.264 {height}p に変換",
  "Audio sent as is": "音声はそのまま送信",
  "Audio as {codec}": "音声は {codec}",
  "Same as the player": "プレーヤーと同じ",
  "Track {number}": "トラック {number}",
  "Add subtitle file…": "字幕ファイルを追加…",
  Device: "デバイス",
  "Device model": "デバイスのモデル",
  "Sent to the TV": "テレビへの送信内容",
  Hardware: "ハードウェア",
  "Processor only": "プロセッサのみ",
  "If the TV shows nothing or stops:": "テレビに何も映らない・止まる場合:",
  "Keep the TV and this computer on the same Wi-Fi or router.":
    "テレビとこのパソコンを同じ Wi-Fi またはルーターにつなぎます。",
  "Allow Harbor through the Windows firewall on private networks.":
    "プライベートネットワークで Windows ファイアウォールに Harbor を許可します。",
  "Set Streaming to MPEG-TS for older TVs, or HLS for TV boxes.":
    "古いテレビはストリーミングを MPEG-TS に、テレビボックスは HLS にします。",
  "Turn on Force conversion if the picture or sound is missing.":
    "映像や音声が出ないときは「強制変換」をオンにします。",
  "Lower the quality to 720p on a slow Wi-Fi.": "Wi-Fi が遅いときは画質を 720p に下げます。",
  "Converter ready. Hardware: {hardware}": "変換の準備完了。ハードウェア: {hardware}",
  "ffmpeg was not found, so videos that need converting cannot be cast.":
    "ffmpeg が見つからないため、変換が必要な動画はキャストできません。",
  Surround: "サラウンド",
  "Stereo works on every TV. Dolby Digital 5.1 needs a TV or receiver that decodes it.":
    "ステレオはどのテレビでも再生できます。Dolby Digital 5.1 には対応するテレビかレシーバーが必要です。",
  "Stereo downmix": "ステレオにダウンミックス",
  "Dolby Digital 5.1": "Dolby Digital 5.1",
  "Original (passthrough)": "オリジナル(パススルー)",
  "Raises quiet films on the TV without clipping.":
    "小さい音の映画をテレビで音割れなく大きくします。",
  "Clear dialogue": "セリフを聞きやすく",
  "Audio delay": "音声の遅延",
  "Character set": "文字コード",
  Encoding: "エンコード",
  "For subtitle files that show strange symbols. Arabic files are usually Windows-1256.":
    "字幕が文字化けする場合に。アラビア語のファイルは多くが Windows-1256 です。",
  "Arabic (Windows-1256)": "アラビア語 (Windows-1256)",
  "Western (Windows-1252)": "西欧 (Windows-1252)",
  "Cyrillic (Windows-1251)": "キリル文字 (Windows-1251)",
  "Greek (Windows-1253)": "ギリシャ語 (Windows-1253)",
  "Turkish (Windows-1254)": "トルコ語 (Windows-1254)",
  "Hebrew (Windows-1255)": "ヘブライ語 (Windows-1255)",
  Rendering: "表示方法",
  "Burned-in subtitles always show, on any TV.": "焼き込み字幕はどのテレビでも必ず表示されます。",
  "Burn in video": "映像に焼き込む",
  Pink: "ピンク",
  "Bottom edge": "画面の下端",
  "Slightly higher": "少し上",
  "Higher up": "さらに上",
  "Subtitle delay": "字幕の遅延",
  Deinterlace: "インターレース解除",
  Always: "常に",
  "Fill screen": "画面いっぱい",
  "Higher quality needs a faster Wi-Fi. 4K needs a 4K TV.":
    "高画質には速い Wi-Fi が必要です。4K には 4K テレビが必要です。",
  "1080p HQ": "1080p HQ",
  "Force conversion": "強制変換",
  Accelerate: "高速化",
  "Uses {hardware} so the computer stays cool and the TV starts sooner.":
    "{hardware} を使うので、パソコンが熱くならずテレビの開始も早くなります。",
  "No supported graphics card was found; the processor converts instead.":
    "対応するグラフィックカードが見つからないため、プロセッサで変換します。",
  Decoding: "デコード",
  Scrubbing: "スクラブ",
  "Only if your TV plays H.265 itself: the film is sent untouched, HDR included.":
    "テレビ自体が H.265 を再生できる場合のみ: 映画を HDR ごとそのまま送ります。",
  "Native playback": "ネイティブ再生",
  "Converts HDR and Dolby Vision colours for TVs that would show them washed out.":
    "HDR と Dolby Vision の色を、白っぽく映るテレビ向けに変換します。",
  "Tone-map to SDR": "SDR にトーンマップ",
  "Auto picks MPEG-TS for DLNA TVs and HLS for everything else.":
    "自動では DLNA テレビに MPEG-TS、それ以外に HLS を使います。",
  "About this cast": "このキャストについて",
  "Applying to the TV…": "テレビに適用中…",
  "HDR tone-mapped": "HDR をトーンマップ",
  "Changes apply to the TV right away.": "変更はすぐにテレビに反映されます。",
  "These settings apply when you pick a device.":
    "これらの設定はデバイスを選んだときに適用されます。",
  "Subtitles on TV": "テレビの字幕",
  "Cast settings": "キャスト設定",
  "Audio, subtitles, quality and acceleration": "音声・字幕・画質・高速化",
  "TV volume": "テレビの音量",
  "Applying…": "適用中…",
  "Converting {speed}×": "変換中 {speed}×",
  Direct: "ダイレクト",
  "The TV stopped answering. Harbor keeps looking for it.":
    "テレビが応答しなくなりました。Harbor が探し続けています。",
  "Playback stopped on the TV.": "テレビの再生が止まりました。",
  "Resume on TV": "テレビで再開",
  "Not responding": "応答なし",
  "Stopped on": "停止中:",
  Synced: "同期済み",
  "Set automatically for {device}": "{device} 用に自動設定済み",
  "Settings for {device}, with your changes": "{device} の設定（変更あり）",
  "Back to automatic": "自動に戻す",
  "These settings set themselves for the device you pick.":
    "これらの設定は選んだデバイスに合わせて自動で調整されます。",
  "Subtitles will look like this on the TV.": "テレビでは字幕がこのように表示されます。",
  "Conversion speed": "変換速度",
  "The computer converts slower than the film plays. Turn on the graphics card or lower the quality.":
    "変換が再生に追いついていません。グラフィックカードを有効にするか、画質を下げてください。",
};
export default castStudio;
