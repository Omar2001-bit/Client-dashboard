import { useState, type ReactNode } from "react";
import { Bell, Search, Plus } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  ConfirmDialog,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  KPICard,
  Logo,
  MenuItem,
  Pagination,
  SegmentedControl,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  Textarea,
  Toggle,
  Tooltip,
  type BadgeTone,
} from "@/components/ui";

const badgeTones: BadgeTone[] = [
  "neutral",
  "muted",
  "brand",
  "success",
  "warning",
  "attention",
  "danger",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/50">{title}</h2>
      <Card>
        <CardBody className="flex flex-wrap items-center gap-4">{children}</CardBody>
      </Card>
    </section>
  );
}

/** Dev-only visual catalog of the Optimizers design system. Route: /dev/design-system */
export function DesignSystemPage() {
  const [tab, setTab] = useState<"overview" | "details">("overview");
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [toggle, setToggle] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(1);

  return (
    <div className="min-h-screen bg-canvas px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="flex items-center justify-between">
          <Logo variant="full" className="h-8 w-auto text-ink" />
          <span className="text-sm text-ink/50">Design System</span>
        </header>

        <Section title="Logo tones">
          <div className="flex items-center gap-2 rounded-brand bg-white p-3 text-ink">
            <Logo variant="mark" className="h-8 w-8" />
            <span className="text-xs text-ink/50">primary</span>
          </div>
          <div className="flex items-center gap-2 rounded-brand bg-ink p-3 text-white">
            <Logo variant="mark" className="h-8 w-8" />
            <span className="text-xs text-white/50">secondary</span>
          </div>
          <div className="flex items-center gap-2 rounded-brand bg-ink p-3 text-brand-500">
            <Logo variant="mark" className="h-8 w-8" />
            <span className="text-xs text-white/50">tertiary</span>
          </div>
        </Section>

        <Section title="Colors">
          {[
            ["Pastel Green", "bg-brand-500", "#6ae499"],
            ["Big Stone", "bg-ink", "#162a3d"],
            ["Black Forest", "bg-ink-deep", "#020601"],
            ["Canvas", "bg-canvas border border-ink/10", "#f7fafb"],
          ].map(([name, cls, hex]) => (
            <div key={name} className="space-y-1.5">
              <div className={`h-16 w-28 rounded-brand ${cls}`} />
              <p className="text-xs font-medium text-ink">{name}</p>
              <code className="text-[11px] text-ink/50">{hex}</code>
            </div>
          ))}
        </Section>

        <Section title="Buttons">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="dark">Dark</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <div className="flex gap-3 rounded-brand bg-ink p-3">
            <Button variant="onDark">On dark</Button>
          </div>
          <IconButton aria-label="Add">
            <Plus className="h-4 w-4" />
          </IconButton>
        </Section>

        <Section title="Badges">
          {badgeTones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <StatusBadge status="running" />
          <StatusBadge status="paused" />
          <StatusBadge status="archived" />
        </Section>

        <Section title="Chips & toggles">
          <Chip active>Active chip</Chip>
          <Chip>Inactive chip</Chip>
          <Toggle checked={toggle} onChange={setToggle} label="Toggle" />
          <Checkbox label="Checkbox" defaultChecked />
        </Section>

        <Section title="Form controls">
          <div className="w-56">
            <Input label="Input" placeholder="Type here…" />
          </div>
          <div className="w-56">
            <Select label="Select" defaultValue="a">
              <option value="a">Option A</option>
              <option value="b">Option B</option>
            </Select>
          </div>
          <div className="w-56">
            <Input label="With error" error="Something's off" defaultValue="bad" />
          </div>
          <div className="w-72">
            <Textarea label="Textarea" placeholder="Notes…" rows={3} />
          </div>
        </Section>

        <Section title="Alerts">
          <div className="w-full space-y-3">
            <Alert tone="info" icon={<Bell className="h-4 w-4" />} title="Info">
              An informational message.
            </Alert>
            <Alert tone="success" title="Success">
              Saved successfully.
            </Alert>
            <Alert tone="warning" title="Warning">
              Double-check this.
            </Alert>
            <Alert tone="danger" title="Error">
              Something went wrong.
            </Alert>
          </div>
        </Section>

        <Section title="KPI cards">
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
            <KPICard title="Revenue" value="$128,430" delta="12.4%" deltaPositive icon={<Bell className="h-4 w-4" />} />
            <KPICard title="Conversion" value="3.2%" delta="0.4%" deltaPositive={false} />
            <KPICard title="Sessions" value="—" loading />
          </div>
        </Section>

        <Section title="Tabs & segmented">
          <div className="w-full space-y-4">
            <Tabs
              items={[
                { value: "overview", label: "Overview" },
                { value: "details", label: "Details" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <SegmentedControl
              items={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
              value={period}
              onChange={setPeriod}
            />
          </div>
        </Section>

        <Section title="Table">
          <div className="w-full space-y-3">
            <TableContainer>
              <Table>
                <THead>
                  <TR>
                    <TH>Client</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Sessions</TH>
                  </TR>
                </THead>
                <TBody>
                  {[
                    ["Acme Co", "running", "12,004"],
                    ["Globex", "paused", "3,540"],
                  ].map(([c, s, v]) => (
                    <TR key={c}>
                      <TD className="font-medium text-ink">{c}</TD>
                      <TD>
                        <StatusBadge status={s as "running" | "paused"} />
                      </TD>
                      <TD className="text-right tabular-nums">{v}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
            <Pagination page={page} pageCount={5} onPageChange={setPage} total={230} pageSize={50} />
          </div>
        </Section>

        <Section title="Overlays">
          <Button onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
          <Dropdown
            trigger={<Button variant="secondary">Menu ▾</Button>}
            children={(close) => (
              <>
                <MenuItem onClick={close}>Edit</MenuItem>
                <MenuItem onClick={close}>Duplicate</MenuItem>
                <MenuItem className="text-red-600 hover:bg-red-50" onClick={close}>
                  Delete
                </MenuItem>
              </>
            )}
          />
          <Tooltip label="Search everything">
            <IconButton aria-label="Search">
              <Search className="h-4 w-4" />
            </IconButton>
          </Tooltip>
          <ConfirmDialog
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => {}}
            title="Delete report?"
            message="This action can't be undone."
            confirmLabel="Delete"
            danger
          />
        </Section>

        <Section title="Empty & loading states">
          <div className="w-full space-y-4">
            <EmptyState
              dashed
              icon={<Search className="h-6 w-6" />}
              title="No results"
              description="Try adjusting your filters."
              action={<Button size="sm">Clear filters</Button>}
            />
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
