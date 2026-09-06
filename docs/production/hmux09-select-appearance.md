# HM-UX-09 — native select inset and Appearance navigation

Owner-approved scope: inset dropdown chevrons consistently with reserved text space; retain native select accessibility/keyboard operation. Settings contains one Appearance submenu row opening a separate shared-header page with existing UI scale and scratch accent controls. Preserve scale persistence/storage reset and temporary-only scratch accent. No transport/auth/session/composer changes, dependencies, runtime/reverse-proxy changes or canonical builds.

Baseline: `19727603ed7d7fd202b751d28eec00b04dc5db1d` (local and remote main verified). Owner screenshots reviewed using vision: `1788684692664830784` (Chats filters) and `1788684743934702170` (inline Settings panels).

Gate: scoped source → builder build/lint + targeted built-browser checks (75/100/125 at narrow widths, inset/text clearance, Appearance open/back/forward, persistence/accent/reset) → screenshots and frozen artifact → parent quick visual review → unchanged required CI + existing static publisher → parent independent live readback. No full local suite repetition. At most two correction rounds. Rollback is the isolated source diff, not route/service manipulation.

Read-only production guard verified: exact existing `https://nuc.tailcf7779.ts.net:8451/` handler and entry `6f91f1f0c7f7f9cfa7fc207806d1ee78d2ffdc68f1664fe3f4406ae57ac1598f`; full-route digest `b8f93e33860152933c5314075d09f5995437755d59b621f7a258a64d141450c6` matches the current independently accepted HM-UX-08 guard. Port 8457 preserved. No backend or auth requests in this check.

Responsive clearance: the first built-browser measurement showed 320px Compact left only 80px for the 82.7px default Project label. Filters therefore reflow at <=360px, and at <=400px in Large mode; wider screens retain the same row. The existing read-browser fixture now asserts this exact two-row geometry only at narrow widths, keeping its original <=68px row bound elsewhere. CI workflow and all safety assertions remain unchanged.

Builder handoff: candidate review and frozen evidence under `/tmp/hmux09-candidate/`; publication intentionally belongs to the parent after quick review. Canonical untracked `.hermes/` and `design/reviews/` untouched.
