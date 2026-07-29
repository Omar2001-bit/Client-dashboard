import type { Timestamp } from "firebase/firestore";
import type {
  ChartType as Ga4ChartType,
  DateRangeSel as Ga4DateRangeSel,
  CompareSel as Ga4CompareSel,
  FilterClause as Ga4FilterClause,
  ColorPeriod as Ga4ColorPeriod,
  FunnelConfig as Ga4FunnelConfig,
  ReportLayout as Ga4ReportLayout,
} from "@/lib/ga4Reports/types";

export type UserRole = "admin" | "executiveAdmin" | "client";

export interface UserDoc {
  uid: string;
  role: UserRole;
  email: string;
  name: string;
  clientId: string | null;
  createdAt: Timestamp;
  lastLogin: Timestamp | null;
}

export interface ClientDoc {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contractStartDate: Timestamp;
  contractEndDate?: Timestamp;
  agencyFee: number;
  servicePrice?: number;
  currency: string;
  logoUrl: string;
  status: "active" | "inactive";
  createdAt: Timestamp;
  updatedAt: Timestamp;
  ga4PropertyId?: string;
}

export interface GA4Property {
  propertyId: string;
  displayName: string;
  accountId: string;
  accountDisplayName: string;
}

export interface GA4Variation {
  audienceId: string;
  variationId: string;
  experimentId: string;
  displayName: string;
  description: string;
  isOriginal: boolean;
  activeUsers: number;
  sessions: number;
  purchaseRevenue: number;
  transactions: number;
  products: number;
}

export interface GA4Experiment {
  experimentId: string;
  /** Actual date range used for the GA4 query (from Convert running period). */
  startDate: string;
  endDate: string;
  variations: GA4Variation[];
}

export interface GoalStat {
  variationId: string;
  variationName: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}

export interface GoalSummary {
  id: string;
  name: string;
  type?: string;
  stats?: GoalStat[];
}

export interface DailyDataPoint {
  date: string;
  revenue: number;
  visitors: number;
  conversions: number;
}

export interface DailyVariantMetricPoint {
  date: string;
  visitors: number;
  revenue: number;
  conversions: number;
  products: number;
}

export interface DailyVariantSeries {
  variationId: string;
  variationName: string;
  isOriginal: boolean;
  trafficSplit: number;
  points: DailyVariantMetricPoint[];
}

export interface ExperimentAudience {
  id: string;
  name: string;
  description: string;
}

export interface ExperimentLocation {
  id: string;
  name: string;
  description: string;
}

export interface VariationPreview {
  id: string;
  name: string;
  isBaseline: boolean;
  trafficSplit: number;
  previewUrl: string;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  status: "running" | "completed" | "paused" | "draft" | "archived";
  startDate: string;
  endDate?: string;
  winnerVariantId?: string;
  primaryGoal?: string;
  goals?: GoalSummary[];
  estimatedRevenueImpact?: number;
  uplifts?: ExperimentUplifts;
  variants?: VariantSummary[];
  dailySeries?: DailyDataPoint[];
  dailyVariants?: DailyVariantSeries[];
  // Experiment details (populated after refresh)
  description?: string;
  objective?: string;
  siteUrl?: string;
  audiences?: ExperimentAudience[];
  locations?: ExperimentLocation[];
  variationPreviews?: VariationPreview[];
}

export interface VariantSummary {
  id: string;
  name: string;
  isOriginal?: boolean;
  trafficSplit: number;
  sessions: number;
  transactions: number;
  products: number;
  revenue: number;
  cvr: number;
  rpv: number;
  aov: number;
}

export type ExperimentMetricKey = "revenue" | "rpv" | "purchases" | "products" | "cvr" | "aov";

export interface MetricUplift {
  original: number;
  bestVariation: number;
  uplift: number;
  upliftPercent: number;
  bestVariationId?: string;
  bestVariationName?: string;
}

export type ExperimentUplifts = Record<ExperimentMetricKey, MetricUplift>;

export interface ROISnapshot {
  totalRevenueGained: number;
  totalPurchasesGained: number;
  productsGained: number;
  productsLost: number;
  blendedROI: number;
  calculatedAt: Timestamp;
  breakdown: ExperimentROIEntry[];
}

export interface ExperimentROIEntry {
  experimentId: string;
  experimentName: string;
  upliftPercent: number;
  revenueGained: number;
  purchasesGained: number;
}

export interface ExperimentMetricOverride {
  uplift?: number;
  upliftPercent?: number;
  original?: number;
  bestVariation?: number;
  bestVariationName?: string;
}

export interface ExperimentOverride {
  displayName?: string;
  isExcluded?: boolean;
  originalVariantId?: string;
  metricOverrides?: Partial<Record<ExperimentMetricKey, ExperimentMetricOverride>>;
  notes?: string;
}

export interface ManualExperiment {
  id: string;
  name: string;
  status: "running" | "completed" | "paused" | "draft" | "archived";
  startDate: string;
  endDate?: string;
  notes?: string;
  uplifts: ExperimentUplifts;
}

export interface DashboardSettings {
  roiNodeCount?: number;
  experimentOverrides?: Record<string, ExperimentOverride>;
  manualExperiments?: ManualExperiment[];
  auditTrackingEnabled?: boolean;
}

export interface ClientPreferences {
  excludedExperimentIds?: string[];
}

export type AuditFindingTool = "GA4" | "GTM" | "Google Search Console" | "Shopify" | "Behavioral Tool";
export type AuditSeverity = "Correct" | "Unable to Verify" | "Critical" | "High" | "Action Needed";
export type FixProgressStatus = "unreviewed" | "fixed" | "notfixed";

export interface AuditFindingDoc {
  // Identity / provenance — immutable after import
  id: string;
  row: string;
  sourceRow: string;
  sourceTab: string;
  tool: AuditFindingTool;
  issueId: string;

  // Audit classification — imported once
  auditStatus: AuditSeverity;
  manualReview: boolean;
  isCorrectRow: boolean;
  isChecklistRow: boolean;

  // Content — fields marked ADMIN-ONLY are never rendered for the client role
  issue: string;
  businessIssue: string;
  summary: string;
  detail: string;
  businessDetail: string;
  technicalExplanation?: string;
  fix: string; // ADMIN-ONLY
  businessFix: string; // ADMIN-ONLY
  verify: string; // ADMIN-ONLY
  businessVerify: string; // ADMIN-ONLY
  docs?: string; // ADMIN-ONLY
  owner?: string; // ADMIN-ONLY (routing)
  qaOutcome?: string; // ADMIN-ONLY (routing)
  reviewStatus?: string; // ADMIN-ONLY (routing)
  routingNote?: string; // ADMIN-ONLY (routing)
  evidenceLink?: string; // ADMIN-ONLY (routing)

  // Fix-progress — mutable, admin-write-only, client read-only
  progressStatus: FixProgressStatus;
  note: string;
  deleted: boolean;
  deletedAt: Timestamp | null;
  progressUpdatedAt: Timestamp | null;
  progressUpdatedBy: string | null;

  // Import bookkeeping
  importedAt: Timestamp;
  importBatchId: string;
  legacyProgressMigrated: boolean;
  legacyUpdatedAtIso?: string;
}

// A saved custom GA4 report ("Analytics Reports" feature), ported from GA4-simply-layer.
// One doc per report at clients/{clientId}/ga4Reports/{reportId} — clientId is implicit
// in the path, not a field here. Admin-write / admin-or-owning-client-read, same as every
// other per-client collection (see firestore.rules).
export interface Ga4ReportDoc {
  id: string;
  name: string;
  description?: string;
  group?: string; // free-text grouping label on the mega dashboard
  property: string; // "properties/123..."
  dimensions: string[]; // 0-9 GA4 dimension apiNames; [] = totals only
  metrics: string[]; // 1-10 GA4 metric apiNames (real or virtual event:/convu:/convs: names)
  chartType: Ga4ChartType;
  rangeA: Ga4DateRangeSel;
  rangeB: Ga4CompareSel;
  filters?: Ga4FilterClause[];
  colorPeriods?: Ga4ColorPeriod[];
  funnels?: Ga4FunnelConfig[];
  limit: number;
  layout?: Ga4ReportLayout;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ClickUpWorkspace {
  id: string;
  name: string;
}

export interface ClickUpFolder {
  id: string;
  name: string;
  spaceId?: string;
  spaceName?: string;
}

export interface ClickUpTask {
  id: string;
  name: string;
  status?: string;
  statusColor?: string | null;
  description?: string;
  startDate?: string | null;
  dueDate?: string;
  dateCreated?: string | null;
  dateClosed?: string | null;
  listId?: string;
  listName?: string;
  assigneeNames?: string[];
  url?: string;
  parentId?: string | null;
}

export interface ClickUpList {
  id: string;
  name: string;
}

// A single shared personal API token (set once, org-wide) browses the agency's
// own ClickUp workspace; each client's timeline is scoped to a workspace + an
// optional folder within it (folders are typically named after the client).
export interface ClickUpIntegration {
  connected?: boolean;
  workspaceId?: string | null;
  workspaceName?: string;
  folderId?: string | null;
  folderName?: string | null;
  tasks?: ClickUpTask[];
  lists?: ClickUpList[];
  lastSyncedAt?: string;
}

export interface ClickUpAccessConfig {
  configured?: boolean;
  source?: "firestore" | "env" | "";
  updatedAt?: string;
  updatedBy?: string;
  authorizedUserName?: string;
  authorizedUserEmail?: string;
}

export interface ClientTimelineConfig {
  title?: string;
  subtitle?: string;
  clickup?: ClickUpIntegration;
}

export interface SupportTicket {
  id: string;
  clientId: string;
  clientName: string;
  message: string;
  status: "open" | "resolved";
  createdAt: Timestamp;
  createdByUid: string;
  createdByEmail: string;
  createdByName: string;
}

export interface CreateClientFormData {
  role: UserRole;
  userName: string;
  userEmail: string;
  userPassword: string;
  clientName: string;
  contactName: string;
  contactEmail: string;
  contractStartDate: string;
  contractEndDate: string;
  servicePrice: number;
  currency: string;
  convertAccountId: string;
  convertProjectId: string;
  convertKeyId: string;
  convertKeySecret: string;
  ga4PropertyId?: string;
}
