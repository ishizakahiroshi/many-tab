# Chrome Web Store Listing Draft

## Name

Many Tab Session Isolator

## Short Description

Developer tool that isolates per-tab cookies and localStorage so you can keep multiple accounts of the same site logged in simultaneously. 100% local.

## Detailed Description

Many Tab Session Isolator (many-tab) keeps multiple accounts of the same site logged in simultaneously across different tabs of the same Chrome profile and window. It is built for QA and development of multi-tenant SaaS, side-by-side testing of admin and end-user roles on internal tools, and parallel use of self-hosted services (Nextcloud, Gitea, Bitwarden, etc.) without juggling Chrome profiles.

Features:

- Per-domain runtime permission grant: no broad host_permissions requested at install time
- Snapshot the cookies and localStorage of a logged-in tab as a named session
- Assign any tab to a saved session and reload to apply
- Auto reload-loop detection: unassigns a session automatically if the same URL navigates 4+ times within 3 seconds
- Emergency stop: clears all tab assignments with one click

Designed for:

Lightweight web apps where authentication and UI state are contained in cookies + localStorage:

- In-house web apps and admin consoles
- Internal/business systems
- Self-hosted services (Nextcloud, Gitea, Forgejo, Vaultwarden, etc.)
- Lightweight multi-tenant SaaS dev/QA environments

Not designed for:

The following services rely on IndexedDB, Service Workers, cross-domain SSO, or anti-multi-account detection that this extension cannot isolate:

- X, Google services (Gmail, Drive, GCP, YouTube, etc.)
- Instagram, TikTok, Facebook
- Slack, Discord
- Notion, Figma, Linear
- Most major social networks and large SaaS platforms

For these, use Chrome's built-in Profile feature, or dedicated multi-session browsers like Ghost Browser or Wavebox.

Privacy:

- No external network requests
- No telemetry, analytics, or crash reports
- Captured cookies and localStorage live only in `chrome.storage.local` on this device

Permissions:

- declarativeNetRequestWithHostAccess: Per-tab cookie header injection
- cookies: Capture the existing cookies of a domain for a session snapshot
- storage: Persist session definitions, tab assignments, and the localStorage overlay locally
- tabs: Read the active tab's URL and id to associate sessions with tabs
- scripting: Inject the session bootstrap data early so virtualization is in place before page scripts read storage
- webNavigation: Detect same-URL reload loops on assigned tabs and recover automatically
- optional_host_permissions (*://*/*): Not requested at install time; granted at runtime only when the user explicitly adds a domain via the popup

Source (MIT, 100% local):
https://github.com/ishizakahiroshi/many-tab

Privacy policy:
https://github.com/ishizakahiroshi/many-tab/blob/main/PRIVACY.md

## Category Candidate

Developer Tools

## Screenshot Ideas

- Popup UI (domain add / session list / assignment selection)
- Two tabs side-by-side (admin tab and tenant user tab)
- Architecture diagram (Tab A -> Cookie A injection / Tab B -> Cookie B injection)
- Popup debug section expanded (transparency)
