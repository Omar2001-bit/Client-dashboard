# Admin Dashboard Overrides

This document is the working inventory for every admin override or edit the dashboard should support for a client workspace.

It is split into:
- `Already implemented` in the current codebase.
- `Recommended next overrides` based on the current dashboard architecture.
- `Future / advanced overrides` that are useful once the basic controls are stable.

## 1. Already Implemented

### Client-level fields
These are edited from the admin client detail page and saved on the root client document.

- `name`
- `contactName`
- `contactEmail`
- `contractStartDate`
- `contractEndDate`
- `agencyFee`
- `servicePrice`
- `currency`
- `status`

### Dashboard settings
These are saved to `clients/{clientId}/settings/dashboard`.

- `roiNodeCount`
- `experimentOverrides`
- `manualExperiments`

### Experiment override fields already supported
These are stored per experiment inside `experimentOverrides`.

- `displayName`
- `isExcluded`
- `originalVariantId`
- `metricOverrides`
- `notes`

### Metric override fields already supported
These are stored under `metricOverrides[metricKey]`.

- `uplift`
- `upliftPercent`
- `original`
- `bestVariation`
- `bestVariationName`

### Client preferences already supported
These are stored separately in `clients/{clientId}/settings/clientPreferences`.

- `excludedExperimentIds`

## 2. Recommended Next Overrides

These are the highest-value additions for the admin layer.

### A. Main dashboard overrides
These control how the client-facing dashboard behaves by default.

- Default date range for the dashboard.
- Default chart granularity.
- Default metric mode for rate cards.
- Default behavior for excluding negative-revenue experiments.
- KPI card order.
- KPI card visibility toggles.
- KPI label overrides.
- ROI card title override.
- ROI breakeven label override.
- ROI milestone count override.
- ROI milestone spacing mode override.
- ROI axis labels override.
- Revenue chart title override.
- Revenue chart subtitle override.
- Revenue chart empty-state text.
- Revenue chart color palette override.
- Currency formatting override.
- Decimal precision override for each KPI.
- Default sort order for dashboard lists.
- Default page size for experiment tables.

### B. Experiment-level overrides
These are the most important admin corrections for a single experiment.

- Experiment display name.
- Experiment status override.
- Experiment start date override.
- Experiment end date override.
- Experiment visibility on the dashboard.
- Experiment pin-to-top flag.
- Experiment internal priority score.
- Experiment tags.
- Experiment notes for the client.
- Experiment internal notes for the admin team.
- Experiment objective text override.
- Experiment description override.
- Experiment URL override.
- Experiment original variant override.
- Variation display name overrides.
- Variation status overrides.
- Variation traffic split overrides.
- Goal label overrides.
- Goal ordering overrides.
- Goal visibility overrides.
- Winner variation override.
- Baseline variation override.
- A/B/C variant mapping override when Convert labels are wrong.

### C. Metric correction overrides
These are for correcting numbers without rewriting the source sync.

- Revenue uplift override.
- Purchases uplift override.
- Products uplift override.
- CVR uplift override.
- RPV uplift override.
- AOV uplift override.
- Original value override for each metric.
- Best variation value override for each metric.
- Best variation name override for each metric.
- Uplift percent override for each metric.
- Confidence or significance label override.
- Rounding precision override for each metric.

### D. Daily data correction overrides
These matter when the totals are right but the day alignment is wrong.

- Per-day revenue override.
- Per-day purchases override.
- Per-day products override.
- Per-day conversions override.
- Per-day RPV override.
- Per-day CVR override.
- Per-day AOV override.
- Per-day baseline series override.
- Per-day experiment series replacement.
- Per-day experiment series patch.
- Exclude specific dates from a series.
- Shift a series by one day or more.
- Force timezone for daily alignment.
- Replace daily series for one experiment with a manual series.
- Replace daily series for one goal only.

### E. Visibility and filtering overrides
These help the admin tailor what the client sees without deleting data.

- Hide experiment from client dashboard.
- Hide experiment from experiment list.
- Hide experiment from experiment detail page.
- Hide specific goals from detail pages.
- Hide specific variations from detail pages.
- Hide manual experiments from the main dashboard.
- Hide an experiment from ROI while keeping it visible elsewhere.
- Hide an experiment from list totals but keep it in detail.
- Exclude revenue losses by default.

### F. Manual content overrides
These help when the raw reporting is correct but the presentation needs editing.

- Client-facing note on the main dashboard.
- Client-facing note on the experiment list.
- Client-facing note on the experiment detail page.
- Internal-only note on the experiment detail page.
- Manual explanation for why a number was overridden.
- Manual explanation for why an experiment was excluded.
- Custom empty-state copy for no experiments.
- Custom empty-state copy for no goals.
- Custom empty-state copy for no daily data.

## 3. Future / Advanced Overrides

These are worth planning for once the basic control surface is stable.

### A. Audit and governance

- Created-by and updated-by fields for every override.
- `editedAt` timestamp for every override.
- Change history per override.
- Undo/restore previous version.
- Approval state for an override.
- Client-approved vs internal-only status.
- Reason code for each change.
- Notes attached to each change event.

### B. Segmentation and analytics

- Device-level override.
- Country-level override.
- Source / medium override.
- Audience-segment override.
- Page-level override.
- Browser-level override.
- Traffic-source exclusions.
- Segment-specific daily series.
- Segment-specific KPI calculations.

### C. Experiment interpretation controls

- Force a different control experiment.
- Force a different winner experiment.
- Choose the metric used to decide the winner.
- Choose the tie-breaker metric.
- Set a minimum traffic threshold before a winner is selected.
- Set a minimum day count before a winner is selected.
- Mark an experiment as inconclusive.
- Mark an experiment as statistically unstable.
- Mark an experiment as externally influenced.

### D. Reporting behavior

- Custom summary cards per client.
- Custom chart title per client.
- Custom chart note per client.
- Custom chart range presets.
- Custom comparison range presets.
- Manual report lock date.
- Freeze a report so later syncs do not change it.
- Snapshot version label for each reporting period.

### E. Manual data patches

- Add a one-off revenue adjustment.
- Add a one-off purchase adjustment.
- Add a one-off product-count adjustment.
- Add a one-off conversion adjustment.
- Add a one-off ROI adjustment.
- Add a manual experiment row.
- Add a manual goal row.
- Add a manual variation row.
- Add a manual daily point row.

## 4. Suggested Firestore Shape

The current `clients/{clientId}/settings/dashboard` document is good for small dashboard-wide preferences.

For more advanced overrides, split the data by concern:

```text
clients/{clientId}/settings/dashboard
clients/{clientId}/settings/clientPreferences
clients/{clientId}/settings/experiments/{experimentId}
clients/{clientId}/settings/experiments/{experimentId}/dailyOverrides/{date}
clients/{clientId}/settings/dashboardHistory/{versionId}
```

Recommended split:

- Keep `dashboard` for global preferences like ROI node count and default range.
- Keep `clientPreferences` for client-owned hide/show preferences.
- Move experiment-specific overrides into an `experiments` subcollection if the override set grows beyond a handful of fields.
- Use a dedicated daily override subcollection if you add date-level patches.

## 5. Priority Order

If the goal is the most useful admin surface with the least risk, I would add these first:

1. Default dashboard date range.
2. Default chart granularity.
3. Experiment status override.
4. Experiment start/end date override.
5. Variation name override.
6. Goal visibility override.
7. Per-day series patching.
8. Internal note vs client-facing note.
9. Override history and restore.
10. Pin / sort priority.

## 6. Notes From Current Code

- The dashboard already applies `displayName`, `isExcluded`, `originalVariantId`, `metricOverrides`, and `notes`.
- The experiment detail page already shows admin notes and the hide/show toggle.
- The experiment list already respects the same overrides and client hide preferences.
- ROI milestone count is already wired end-to-end from the dashboard settings page into the ROI card.
- The current save path for admin dashboard settings is `clients/{clientId}/settings/dashboard`.

## 7. Open Gap List

These are the highest-value missing edits if you want the admin layer to feel complete:

- Per-day overrides for bad daily data.
- Start/end date overrides for experiments.
- Goal and variation renaming controls.
- Pinning and priority ordering.
- Dashboard default range and granularity.
- Change history for every override.
- Separate internal vs client-facing notes.

