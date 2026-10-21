# BarePod Panel — frontend

React 19 + TypeScript + Tailwind v4 (through `@tailwindcss/vite`), built by Vite.

- `npm run dev` — dev server for the SPA
- `npm run build` — `tsc -b` then the production bundle
- `npm run lint` — oxlint (`.oxlintrc.json`; `react/rules-of-hooks` is an error)

## Layout & responsiveness

The panel is used from a phone as much as from a desktop, so every view is
expected to reflow. Match these conventions rather than inventing a new one.

- **The shell is a drawer below `lg` (1024px).** `App.tsx` holds the drawer's open
  state and `hooks/useIsDesktop.ts` is the single source for where the breakpoint
  is. `Sidebar.tsx` is `fixed … -translate-x-full` on a phone (sliding in over the
  page, with a backdrop) and `lg:static` on a desktop (a column). The header's menu
  button has two jobs: it opens the drawer below `lg`, and collapses the column at
  `lg`+.
  Collapsing is a desktop idea — the labels render through
  `compact = collapsed && isDesktop`, so the drawer is always fully labelled.
- **View roots use `p-4 sm:p-6 lg:p-8`**, never a fixed `p-8`. A view is a
  `… max-w-Nxl mx-auto space-y-6` container; the padding is the only part that
  changes with the width.
- **Wide tables scroll, never squeeze.** Put the `<table>` in a
  `<div className="overflow-x-auto">` and give the table a `min-w-[…px]` floor —
  a `w-full` table with no floor simply gets narrower and unreadable. The card
  around it keeps `overflow-hidden` for its rounded corners.
- **Grids carry their breakpoints**: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N`.
  A bare `grid-cols-3` is what breaks on a 375px screen.
- **Fixed widths become fluid**: `w-full sm:w-64` for a search box,
  `min-w-0 sm:min-w-[220px]` for a field that should grow, and
  `w-[min(24rem,calc(100vw-2rem))]` for a floating panel. A side panel that only
  makes sense on a desktop becomes
  `absolute inset-y-0 right-0 … lg:static lg:w-72` — an overlay on a phone, a
  column on a desktop.
- **Heights use `dvh`, not `vh`** (`h-dvh`, `max-h-[92dvh]`): a phone's address bar
  changes the viewport and `vh` does not follow it.
- **The shell closes itself**: `App.tsx` dismisses the drawer on any navigation and
  on Escape, and locks body scroll while it is open.

## Linting

`npm run lint` (oxlint) is expected to finish with **0 errors and 0 warnings**.

- **`react/set-state-in-effect` and `react/immutability` are off** in
  `.oxlintrc.json`. They are React Compiler diagnostics that flag deliberate
  patterns in this codebase: a modal resetting its draft state when it opens, and
  the `alive` flag captured by an async effect so a late response is ignored.
  Re-enabling them means refactoring those screens, not adding a suppression.
- The rest stay on. `rules-of-hooks`, `exhaustive-deps`, `no-unused-vars`,
  `react/purity`, `react/refs` and `only-export-components` are enforced; the
  zero-warning sweep removed unused imports/bindings, moved non-component exports
  (`BAREPOD_DEMO_PODS`, scaffold helpers) out of component files, and fixed stale
  memo/effect dependencies.

## Known issues & deferred

- **Deferred — modal overlays are still vertically centred.** Every overlay is
  `fixed inset-0 … flex items-center justify-center`. Since each modal now caps
  itself at `max-h-[92dvh]`, nothing clips on a normal phone, so changing all 44
  call sites to `items-start sm:items-center` (plus `overflow-y-auto`) was judged
  not worth the churn. Do it if a short landscape screen ever cuts off a modal's
  header or footer. Recorded in `MASTER_PLAN.md` §4.2 as well.
