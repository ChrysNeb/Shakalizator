# Сторонние компоненты

- AndroidX Activity и WebKit — Apache-2.0, [AndroidX](https://android.googlesource.com/platform/frameworks/support/).
- `@ffmpeg/ffmpeg` 0.12.10 — MIT, [исходники](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10), текст MIT включён в `app/src/main/assets/web/vendor/ffmpeg/LICENSE`.
- `@ffmpeg/core` 0.12.6 — готовое ядро FFmpeg 5.1.4; [проект и инструкции сборки](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.6). FFmpeg и включённые кодеки имеют собственные лицензии; лицензия JS-обёртки не заменяет их. [FFmpeg legal](https://ffmpeg.org/legal.html).
- Исходные веб-инструменты и словари перенесены из проекта семейства «Шакализатор»; во время работы приложение не обращается к их сайтам.
- `stress.bin` — сжатый словарь ударений, подготовленный из [StressRNN](https://github.com/dbklim/StressRNN) (Apache-2.0, исходные данные на основе Зализняка).

Точные URL и контрольные суммы включённых файлов — в `app/src/main/assets/web/vendor/manifest.json`. Для публичной перепаковки / публикации в магазине учитывайте лицензии конкретной сборки FFmpeg и её кодеков.

Тексты лицензий FFmpeg включены в [licenses/](licenses/). Исходный код FFmpeg 5.1.4 доступен в [официальном архиве](https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz); конфигурация WASM-ядра — в указанном выше репозитории ffmpeg.wasm.
