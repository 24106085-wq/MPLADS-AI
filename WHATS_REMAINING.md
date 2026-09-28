# MPLADS-AI CSS Task — What's Remaining

> Note: this file tracks the CSS/responsive-design task only. For login
> instructions and demo account credentials, see the "Logging in" section
> of `README.md` — that content isn't duplicated here since it belongs to
> a separate (auth) piece of work.

Work stopped mid-task. `frontend/src/index.css` has the new token system, dark
mode, safe-area insets, and rem conversions already applied and verified
clean (no raw hex/rgba after the token block). Everything below is NOT done
yet.

## 1. Propagate color tokens to the other 8 stylesheets — DONE
All 8 stylesheets swept and every raw hex/rgba swapped for the matching
`index.css` token:

- style/alerts.css        — `--ondark-heading`, `--ondark-green-text`, `--ondark-green-border`, `--ondark-green-dot`, `--ondark-muted`, `--red-border`, `--orange-border`, `--amber-border`, `--green-border`
- style/dashcss.css       — same on-dark set plus `--signal-critical/high/amber/blue`, `--white`, `--green-border`
- style/investigation.css — `--blue-border`, `--amber-border`, `--orange-border`, `--green-border`, `--white`
- style/map.css           — `--map-canvas-bg`, `--white`, `--overlay-scrim`, `--overlay-map`, `--shadow-color-soft` (as a nested var() fallback)
- style/mlops.css         — `--ondark-body`, `--ondark-subtle`, `--ondark-note`, `--white`, `--accent-hover`
- style/projectDetails.css — verified clean, no changes needed
- style/reports.css       — verified clean, no changes needed
- style/settings.css      — verified clean, no changes needed

Confirmed via a repo-wide grep for `#[0-9A-Fa-f]{3,8}|rgba?\(` — the only
remaining matches are inside `index.css`'s `:root` and dark-mode token
blocks, which is where the raw values are supposed to live (item 9 done).

Bonus (not part of the original audit): the Dashboard's first three KPI
cards were all rendering the same blue `tone="default"` icon, which read as
"blue everywhere" in screenshots. Added `--field` (green) and `--accent`
(orange) stat-card icon tones in `index.css` and switched "Total Sanctioned
Amount" and "Total Expenditure" to use them in `Dashboard.jsx`, so the KPI
strip now reads blue → green → orange → red → amber → green → green → amber
→ red → red instead of three identical blue icons in a row.

## 2. Compact merged project-table (item 2) — DONE
`components/ProjectTable.jsx` now renders the merged columns:
- State + District → one `.td-stacked` "Location" cell (district as primary, state as secondary)
- Sanctioned + Expenditure → one `.td-stacked` "Financials" cell (expenditure as primary, "of ‹sanctioned›" as secondary)
- Financial % + Physical % → one `.td-progress-pair` cell (the two existing `ProgressBar`s stacked)
- Risk Score + Risk Level → one `.td-risk-combined` cell (score ring + `RiskBadge` side by side)
- `COLUMNS` array/header labels updated to match (Project ID, Work Name, MP / Constituency, Location, Financials, Progress, Status, Risk, Action)
- Every `<td>` now has a `data-label` attribute matching its header, ready for item 3's stacked card layout

## 3. Responsive breakpoints (item 3) — DONE
Added `@media (max-width: 768px)` and `@media (max-width: 375px)` blocks to
`index.css`, placed in proper widest-to-narrowest cascade order (1200 → 900
→ 768 → 640 → 375) so nothing gets silently overridden by an
out-of-order rule.

- **768px**: `.project-table` converts to a stacked card layout —
  `thead { display: none }`, each `tr` becomes a bordered card
  (`border`/`border-radius`/`background`), each `td` becomes a flex row
  with `content: attr(data-label)` on `::before` (using the `data-label`
  attrs added to every `<td>` in item 2's `ProjectTable.jsx` work). Cells
  whose content is itself a block (`.td-stacked`, `.td-progress-pair`,
  `.td-risk-combined`, `.td-mp`) switch to label-above-content instead of
  label-beside-content via `:has()`. Also stacks the toolbar (search/filter
  selects go full-width) and the pagination bar.
- **375px**: tightens `.app-shell__content` padding, shrinks the dashboard
  title, forces every table-card row into label-above-value (overriding the
  768px label-beside-value default), and stacks the remaining toolbar/
  pagination controls that were still side-by-side at 768px.

## 4. Safe-area insets (item 4)
DONE for `.sidebar` and `.topbar` (padding-top/bottom env() added,
`viewport-fit=cover` added to index.html). Double check no other
fixed/sticky bars exist elsewhere (e.g. modal footers) that also need it —
a quick grep for `position: (fixed|sticky)` across the 8 style/*.css files
was not yet done.

## 5. Stat-card stacking (item 5) — DONE
Added a dedicated `@media (max-width: 480px)` rule (in correct cascade
position, between the 640px and 375px blocks) for each of the three grids:
- `.kpi-grid` → `index.css`
- `.alerts-summary` → `style/alerts.css`
- `.ai-summary__grid` → `style/dashcss.css`

All three now go to `grid-template-columns: 1fr` below 480px.

## 6. Focus/hover audit (item 6) — DONE
Checked every element in the list — all render as real `<button>` (or `<a>`
for `.sidebar__link`) elements, so the global
`a/button/input/select/textarea:focus-visible` rule at the bottom of
`index.css` covers keyboard focus for all of them. Hover was the gap:

- `.btn-primary`, `.btn-secondary`, `.btn-view`, `.sidebar__link`,
  `.role-switcher__tab`, `.report-type-card` — already had `:hover`, no
  change needed.
- `.map-chip` — had **no** `:hover` at all. Added one (border/background/
  text color shift) plus a slightly darker `.map-chip--active:hover`, and
  gave the base rule a `transition` so the state change isn't instant.
- `.inv-action-btn` — had **no** `:hover`, despite already declaring
  `transition: opacity 0.15s ease` (clearly intended for a hover dim that
  was never written). Added `:hover:not(:disabled) { opacity: 0.85; }`.
- Pagination buttons (`.pagination__controls button`) — had **no** `:hover`.
  Added a background/border/text-color shift matching the pattern used
  elsewhere in the file.

## 7. rem/% conversion (item 7) — DONE
Spot-checked the three flagged spots — all three were already converted:
`.pm-compare__label` is `width: 8.75rem` (index.css), `.ev-card__filename`
is `max-width: 10rem` (investigation.css), `.map-legend` is
`min-width: 10.5rem` (map.css). Went a step further and did a repo-wide
grep for any remaining px width/height/min-*/max-* values, filtering out
icon-sized ones (which are meant to stay in px). Found and converted four
more layout-relevant leftovers: `.notif-panel` max-height 420px → 26.25rem
(index.css), `.mini-progress` 84×16px → 5.25rem×1rem (index.css),
`.ev-card__media` height 150px → 9.375rem (investigation.css), and
`.report-preview__body` max-height 480px → 30rem (reports.css).

## 8. Print stylesheet (item 8) — DONE
Added an `@media print` block at the end of `index.css`:
- Hides `.sidebar`, `.sidebar-backdrop`, `.topbar__search`,
  `.topbar__icon-btn`, `.topbar__menu-btn`, `.topbar__profile`,
  `.project-table__toolbar`, `.project-table__pagination`, and
  `.pagination__controls`
- Zeroes `.app-shell__main`'s margin-left and `.app-shell__content`'s
  padding, and forces `.project-table`/`.project-table--preview` to full
  width
- Forces black-on-white by overriding the surface/text/border tokens to
  print-safe values (also under `:root[data-theme="dark"]` so a dark-mode
  user still gets a light printout), plus a `body` background/color
  override, drops the app-shell grid background, strips box/text shadows,
  and removes the browser's auto-appended link-href suffix

## 9. Consolidate remaining raw colors (item 9) — DONE
Depends on item 1, which was already finished; re-ran the repo-wide grep
for `#[0-9A-Fa-f]{3,8}|rgba?\(` after this pass's changes — still only
matches inside `index.css`'s `:root` / dark-mode / print token blocks.

## 10. `.project-table--compact` rename (item 10) — DONE
`components/UploadDataModal.jsx`'s three `className="project-table
project-table--compact"` occurrences (~lines 199, 226, 318) now read
`project-table--preview`, matching the CSS rename from earlier.

## 11. Dark mode manual toggle (item 1, tail end) — DONE
- Added `utils/theme.js`: a single small module owning the
  `mplads_theme_preference` localStorage key and the three valid values
  (`"system" | "light" | "dark"`), with `getStoredThemePreference`,
  `applyThemePreference` (sets/clears `data-theme` on `<html>`), and
  `setThemePreference` (persists + applies in one call).
- `main.jsx` calls `applyThemePreference(getStoredThemePreference())`
  before the app renders, so a saved preference takes effect with no flash
  of the wrong theme on load.
- `pages/Settings.jsx` gets a new "Appearance" card with a three-way
  Light/Dark/System toggle (`Sun`/`Moon`/`Monitor` icons from
  lucide-react). It's rendered ahead of the backend-online check, since
  the theme preference is purely client-side and should still work when
  the backend is unreachable. Clicking an option calls
  `setThemePreference` immediately — it's not gated behind Save Changes,
  since it's a separate localStorage-backed preference from the
  server-persisted form fields.
- `style/settings.css` gets the new `.theme-toggle` / `.theme-toggle__option`
  rules (plus a small `.settings-page > .settings-card` margin so the new
  card sits flush with the existing form's row gap).

---
Everything above was catalogued from a full read of all 9 stylesheets and
the relevant JSX components (ProjectTable.jsx, UploadDataModal.jsx,
Sidebar.jsx, Topbar.jsx, Settings.jsx, App.jsx, main.jsx), so a fresh pass
can pick this up without needing to re-explore the codebase.
