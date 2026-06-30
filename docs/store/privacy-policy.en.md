# Privacy Policy

Last updated: 2026-06-30

Many Tab Session Isolator (many-tab) does not collect, store, sell, or share personal information.

## Information Collection

This extension does not transmit any data externally, including telemetry, analytics, or crash reports. The developer of this extension does not collect browsing history, page content, form inputs, cookies, or credentials from users.

## External Communication

This extension does not make external network requests. Request modification via declarativeNetRequest (DNR) is used only to inject the cookies captured by the user into HTTP requests to domains the user explicitly added via the popup. The modification target and the injected content are determined entirely locally; no network communication is involved.

## Locally Stored Data

The following data is stored only in `chrome.storage.local`. It is not synced via Chrome Sync or to any Google account.

- List of domains added by the user
- Named sessions (a set of captured cookies and a localStorage snapshot)
- Tab-to-session assignments (automatically cleared when a tab is closed)
- Debug feature ON/OFF setting (default OFF)
- Operation logs while the debug feature is ON (ring buffer of 200 lines)

This data stays inside the user's browser and is not transmitted externally. When the user removes the extension from Chrome, the contents of `chrome.storage.local` are also removed by Chrome.

## Permissions

- declarativeNetRequestWithHostAccess: Per-tab cookie header injection
- cookies: Capture the existing cookies of a domain for a session snapshot
- storage: Store the local data listed above
- tabs: Read the active tab's URL and id to associate sessions with tabs
- scripting: Inject the session bootstrap data early so virtualization is in place before page scripts read storage
- webNavigation: Detect same-URL reload loops on assigned tabs and recover automatically
- optional_host_permissions (*://*/*): Not requested at install time; granted at runtime only when the user explicitly adds a domain via the popup

## Third-Party Sharing

None.

## Contact

Please report issues via GitHub Issues: <https://github.com/ishizakahiroshi/many-tab/issues>

## Changelog

- 2026-06-30: Initial release (v0.1.0)
