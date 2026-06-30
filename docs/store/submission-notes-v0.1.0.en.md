# Chrome Web Store Submission Notes (v0.1.0)

## Reviewer Notes

This is the initial release of Many Tab Session Isolator (many-tab). It is a developer-oriented tool that lets the user keep multiple accounts of the same domain logged in across different tabs of the same Chrome profile simultaneously.

How it works:

- The user explicitly adds a target domain via the popup, and `chrome.permissions.request` grants the host permission for that domain at that moment only (no broad host_permissions requested at install time).
- The extension snapshots the cookies and localStorage of a currently logged-in tab as a named session.
- When the user assigns a session to a different tab, the extension installs a declarativeNetRequest session rule with a `tabIds` condition to swap the Cookie header, and a MAIN-world content script virtualizes `document.cookie` and `localStorage` per session.
- If the same URL navigates 4 or more times within 3 seconds, the extension treats it as a reload loop and automatically unassigns that tab.

Major social platforms and large SaaS (X, Google, Slack, etc.) cannot be isolated by this approach because of IndexedDB / Service Worker usage and anti-multi-account detection. The listing explicitly declares these as "not designed for" and recommends alternatives (Chrome Profile, Ghost Browser, Wavebox).

## Permission Changes

- Initial release, no prior version to compare against.
- The extension only requests the following permissions:
  - declarativeNetRequestWithHostAccess
  - cookies
  - storage
  - tabs
  - scripting
  - webNavigation
- `host_permissions` is intentionally left empty at install time. Broad host access is delivered through `optional_host_permissions: ["*://*/*"]`, granted at runtime via `chrome.permissions.request` only when the user explicitly adds a domain via the popup.

## Data Handling

- **Personally identifiable information**: Captured cookies and localStorage may contain names, email addresses, etc. The Web Store Data usage declaration therefore answers Yes to both "Personally identifiable information" and "Authentication information".
- **External transmission**: None. No telemetry, analytics, crash reports, or usage statistics are collected.
- **Storage location**: Captured cookies and localStorage are stored only in `chrome.storage.local` and are not synced via Chrome Sync or to any Google account.
- **Deletion**: When the user removes the extension from Chrome, the contents of `chrome.storage.local` are removed by Chrome.

## Test Focus

- "Add target domain" in the popup triggers the runtime host permission dialog correctly
- A captured session applied to a different tab makes the server respond as the expected account
- The popup shows a `⚠` warning when the snapshot source tab had fewer than 5 localStorage keys
- A simulated reload loop (rapidly reloading the same URL 4 times) causes the assignment to be automatically removed and the badge to change to `!`
- The popup "Emergency stop" button clears all tab assignments
- Turning ON the Debug log toggle in the popup "Debug" section starts accumulating operation logs in `chrome.storage.local.__mt_logs` (and turning it OFF stops accumulation)
