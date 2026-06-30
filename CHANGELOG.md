# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

-

### Changed

-

### Fixed

-

## [0.1.0] - 2026-06-30

Initial public release prepared for Chrome Web Store submission.

### Added

- Per-tab Cookie isolation via `declarativeNetRequestWithHostAccess` session rules with `tabIds` condition
- Per-session `document.cookie` and `localStorage` virtualization via MAIN-world content script
- Manual session capture from a logged-in tab (cookies + localStorage snapshot stored locally)
- One-click per-tab session assignment with badge color and initial-letter indicator
- Runtime per-domain `host_permissions` grant via popup (no broad install-time permissions)
- Auto reload-loop detection: unassign a tab and badge it `!` after 4+ same-URL navigations in 3 seconds
- Emergency "Unassign all tabs" button in the popup
- Debug feature with `chrome.storage.local.mtDebug` toggle, ring-buffered operation log (200 lines), and `console.warn` for critical errors regardless of the toggle
- Icons (16/32/48/128 PNG + SVG master) with a tab-branching motif
- Popup header with app icon, close button (`×`), and chrome.i18n-based bilingual UI (ja/en, switches by browser language)
- Popup header language selector (`Auto` / 日本語 / English) persisted in `chrome.storage.local.mtUiLang`; non-auto modes fetch `_locales/{lang}/messages.json` directly so the popup language can be forced independent of Chrome's UI language
- `manifest.json` localized via `__MSG_appName__` / `__MSG_appDescription__` and `default_locale: "ja"` (Web Store listing also localized)
- `_locales/{ja,en}/messages.json` covering all user-facing popup text (59 keys each, parity enforced by validate)
- Bilingual store listing (ja/en), privacy policy (ja/en), and submission notes (ja/en)
- `scripts/validate-extension.ps1` and `scripts/package-webstore.ps1` for local validation and packaging
