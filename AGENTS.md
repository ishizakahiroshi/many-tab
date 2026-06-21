# Agent Entry Point (many-tab)

This repository's operational guidance is maintained in `CLAUDE.md`.

- Project overview & rules: `./CLAUDE.md`
- Design (source of truth): `./chrome-tab-session-isolation-spec.md`
- Local/private additions (if present, not committed): `./CLAUDE.local.md`
- Tool-specific local notes (if present, not committed): `./AGENTS.local.md`

**many-tab** is a Chrome Manifest V3 extension that keeps multiple accounts of the same site logged in simultaneously across separate tabs, in one profile/window. It is general-purpose (user-specified domains), 100% local (no telemetry, no cloud sync), and uses least-privilege host permissions requested at runtime.

Key constraints (see `CLAUDE.md` / the spec for detail):
- True simultaneous isolation — never fall back to cookie-swap.
- Whole-domain cookie isolation — do not narrow to specific cookie names.
- No broad `host_permissions` in the manifest; request per-domain access at runtime.
- Confirm current Chrome extension API behavior from primary sources before implementing; do not hardcode API specs or cookie names from memory.
- Clean-room: reference closed/proprietary tools for design understanding only — never copy their code.
- Trademarks: do not use "X"/"Twitter"/the bird logo in name, icon, or store listing.

Personal/global AI rules are intentionally kept outside this repository. Use each AI tool's supported global instruction location for user-specific rules; this file must remain valid for a fresh public clone with no private files.

If any project guidance conflicts, follow `CLAUDE.md`.
