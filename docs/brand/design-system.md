# Optimizers Design System

The reusable component library that makes the app brand-compliant. Everything here is a
**transformation of a pattern that already existed** in the app — consolidated, tokenized, and
made reusable. No net-new visual language.

## Foundations

### Tokens — one source of truth
`frontend/src/theme/tokens.js` (typed by `tokens.d.ts`) defines the brand primitives and is imported
by **both** `tailwind.config.js` (utility classes) and runtime code (e.g. the Recharts palette in
`src/lib/ga4Reports/theme.ts`). Change a color once, it propagates everywhere.

- Colors: `brand` (Pastel Green ramp, `500` = official `#6ae499`), `ink` (`DEFAULT` = Big Stone
  `#162a3d`, `deep`/`900` = Black Forest `#020601`), `canvas` (`#f7fafb`).
- Elevation: `shadow-card`, `shadow-card-hover`, `shadow-pop`, `shadow-overlay`.
- Radius: `rounded-brand` (16px) for cards.
- Motion: `animate-fade-in`, `animate-pop-in`, `animate-rise-in`, `animate-check-pop`.
- Focus: the `focus-ring` utility (defined in `index.css`) — a brand ring on keyboard focus.

### Class helper
Use `cn()` from `frontend/src/lib/cn.ts` (clsx + tailwind-merge) — **not** bare `clsx` — so later
utilities correctly override earlier ones. Component variants are expressed with
`class-variance-authority` (`cva`).

### Rules
- **Never** use stock `gray-*` / `slate-*`; use `ink` + opacity (`text-ink/70`, `border-ink/10`).
- Text on a **green** fill is Black Forest: `text-ink-deep`.
- Cards use `rounded-brand` + `shadow-card`; popovers use `shadow-pop`; dialogs use `shadow-overlay`.
- Icons: `lucide-react` only.

## Components (`frontend/src/components/ui/`)

Redesigned existing primitives and newly-extracted shared ones. Intended API:

| Component | Variants / props | Replaces (was) |
|---|---|---|
| `Button` | `variant: primary \| secondary \| danger \| ghost \| onDark`, `size: sm \| md \| lg`, `loading` | inline `bg-brand-500…` buttons, `bg-ink` tutorial button |
| `Card` / `CardHeader` / `CardBody` | `className` | inline `bg-white rounded-brand/2xl border …` panels |
| `Input`, `Textarea` | `label`, `error`, `hint` | ad-hoc inputs / textareas |
| `Select` | `label`, `error`, options as children | the two `<select>` class constants |
| `Badge` | `tone: neutral \| brand \| success \| warning \| danger \| info` | `StatusBadge` + `AuditSeverityBadge` + `FixProgressBadge` (now thin wrappers) |
| `KPICard` | `title, value, delta, deltaPositive, icon, loading` | existing KPICard + ga4 `KpiTileContent` |
| `Table` (+ `THead`/`Row`/`Cell`) | headless table primitives | 11 hand-rolled `<table>`s |
| `Tabs` / `SegmentedControl` | `items`, `value`, `onChange` | ReportCanvas toggles, ClientDetail tabs |
| `Dropdown` | trigger + floating panel | MetaPicker / MetricJumpMenu pattern |
| `Dialog` | `open`, `onClose`, `title` | native `confirm()` |
| `Alert` | `tone`, `title` | inline `text-red-600 bg-red-50 …` |
| `Checkbox`, `Toggle`, `Chip`, `IconButton`, `Pagination`, `EmptyState`, `Skeleton`, `Tooltip` | — | scattered ad-hoc versions |
| `Spinner` | `className` (colored via `currentColor`) | ad-hoc `animate-spin` divs — adoption is incomplete, e.g. `components/auth/ProtectedRoute.tsx`'s loading state still inlines its own rather than using this component |
| `Logo` | `variant: full \| mark` (color via `currentColor`) | placeholder OP monogram |

See the source of each component for exact props. A dev-only showcase route may render them all for
visual review.
