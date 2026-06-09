# Store Fix

Store Fix is a Safari Web Extension that keeps App Store links on the storefront region you choose.

Examples with the default `cn` region:

- `https://apps.apple.com/us/app/wechat/id414478124`
  becomes `https://apps.apple.com/cn/app/wechat/id414478124`
- `https://apps.apple.com/app/id414478124`
  becomes `https://apps.apple.com/cn/app/id414478124`

It also handles direct address bar navigation, so typing or pasting an App Store URL in Safari is redirected the same way as clicking a link.

## Features

- Fix App Store links to one selected country or region.
- Optionally force clicked App Store links to open in a new Safari window or tab instead of launching App Store.
- Choose from the bundled App Store storefront list, including common regions such as `cn`, `hk`, `jp`, `us`, and `ca`.
- Search regions by country name, localized name, or two-letter region code.
- Filter the region list by area, including Asia Pacific, USA/Canada, Europe, Latin America/Caribbean, and Africa/Middle East/India.
- Quick Jump appears only when the current tab is an `apps.apple.com` app page.
- Quick Jump can open the selected region in the current tab or a new tab.
- Frequently used regions are promoted to the front of both the fixed-region selector and Quick Jump list.
- The popup closes automatically after a successful Quick Jump.

## Localization

The default language is English.

Supported locales:

- English: `_locales/en`
- Simplified Chinese: `_locales/zh_CN`
- Traditional Chinese: `_locales/zh_TW`

Popup strings use Safari Web Extension i18n messages. Region names are shown in English by default and use browser-provided localized names in Chinese UI languages.

## Project Layout

- `Store Fix/Shared (Extension)/Resources/manifest.json`: Safari Web Extension manifest.
- `Store Fix/Shared (Extension)/Resources/app-store-url.js`: App Store URL parsing and rewrite logic.
- `Store Fix/Shared (Extension)/Resources/content.js`: page-level redirect and link rewrite handling.
- `Store Fix/Shared (Extension)/Resources/background.js`: web navigation redirects and Quick Jump tab handling.
- `Store Fix/Shared (Extension)/Resources/popup.html`: popup markup.
- `Store Fix/Shared (Extension)/Resources/popup.js`: popup state, settings, region search, and Quick Jump behavior.
- `Store Fix/Shared (Extension)/Resources/store-regions.js`: bundled storefront region data.
- `Store Fix/Shared (Extension)/Resources/_locales`: localized extension strings.

## Build

Open the Xcode project:

```sh
open "Store Fix/Store Fix.xcodeproj"
```

Or build the macOS target from the command line:

```sh
xcodebuild -project "Store Fix/Store Fix.xcodeproj" \
  -scheme "Store Fix (macOS)" \
  -configuration Debug \
  -destination "platform=macOS" \
  build
```

After building, enable the extension in Safari settings.
