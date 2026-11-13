# Сборка и устройство

JDK 17, Android SDK 35, Gradle Wrapper 8.10.2. В `local.properties` укажите `sdk.dir=...` либо настройте SDK через Android Studio. Для сборки исходный монорепозиторий веб-проектов не требуется.

```bash
sh ./gradlew assembleDebug testDebugUnitTest lintDebug
```

Windows: `gradlew.bat assembleDebug testDebugUnitTest lintDebug`.

APK находится в `app/build/outputs/apk/debug/app-debug.apk`. В APK уже есть страницы и WASM (~32 МБ до упаковки). Никаких скачиваний кодеков во время работы приложения нет.

## Структура

- `MainActivity.java`: системный выбор файлов, запись микрофона по разрешению, сохранение, буфер и отправка текста.
- `LocalPages.java`: локальный HTTPS-origin через WebViewAssetLoader. Не сервер, порт не открывается. Внешние запросы WebView блокируются.
- `app/src/main/assets/web/`: оригинальные веб-инструменты, адаптированные к локальным путям.
- `android.js`: экспорт Blob/data-результатов в Android через чанки по 64 КиБ. Полный файл не переводится в одну огромную base64-строку.
- `vendor/`: FFmpeg wrapper 0.12.10 / single-thread core 0.12.6, JS и WASM. `manifest.json` фиксирует источники и SHA-256.
- `about.html`: описание приложения, FAQ, веб-версия и приватность.

Криптография использует локальный защищённый origin `https://appassets.androidplatform.net`, поэтому доступны WebCrypto и module workers. CSP Шакалографии ограничивает исполняемые скрипты локальными файлами. Фраза и текст не передаются в Android-логи, URL или хранилище настроек.

Фото ограничено 2048 px по длинной стороне и рабочей площадью 4 млн пикселей для экономии памяти. Видео и аудио используют исходный FFmpeg-пайплайн, а не нативную адаптацию из «Шакал Камеры».

## Обновление веб-исходников

Не требуется для обычной сборки. Если есть полный исходный checkout семейства сайтов:

```bash
node tools/import-web.mjs /path/to/original/checkout
node tools/vendor.mjs
```

Не удаляйте `web/android.js` и `web/about.html`: они принадлежат Android-обёртке. После обновления проверьте импортированные пути и прогоните тесты. Скрипт vendor загружает закреплённые версии при подготовке исходников, не при работе приложения.

## Проверки

```bash
sh ./gradlew testDebugUnitTest lintDebug
sh ./gradlew connectedDebugAndroidTest
```

Android-тесты запускаются на современном WebView. Workflow `Offline Android tests` использует API 35 и x64-эмулятор на GitHub, независимо от архитектуры компьютера автора. В тестах проверяется отсутствие INTERNET, загрузка страниц, фото-уровни, текст, крипто-воркер, PNG-пакет и обработка аудио / видео локальным WASM. Тесты используют синтетические данные.

Окна выбора / сохранения, микрофон и совместимость с реальными Android-телефонами требуют отдельной ручной проверки. Для Google Play нужен собственный постоянный release-ключ.
