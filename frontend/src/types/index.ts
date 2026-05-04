import type { Timestamp } from "firebase/firestore";

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
}

export interface ClientPreferences {
  excludedExperimentIds?: string[];
}

export interface TimelinePhase {
  id: string;
  title: string;
  color: string;
  startDate: string;
  endDate: string;
  description?: string;
  deliverables?: string[];
}

export interface ClickUpWorkspace {
  id: string;
  name: string;
}

export interface ClickUpTask {
  id: string;
  name: string;
  status?: string;
  dueDate?: string;
  listId?: string;
  listName?: string;
  assigneeNames?: string[];
  url?: string;
  parentId?: string | null;
}

export interface ClickUpIntegration {
  connected?: boolean;
  authorizedUserName?: string;
  authorizedUserEmail?: string;
  activeWorkspaceId?: string;
  activeWorkspaceName?: string;
  workspaces?: ClickUpWorkspace[];
  tasks?: ClickUpTask[];
  taskAssignments?: Record<string, string>;
  lastSyncedAt?: string;
}

export interface ClickUpAppConfig {
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
  hasSecret?: boolean;
  source?: "firestore" | "env" | "";
  configured?: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ClientTimelineConfig {
  title?: string;
  subtitle?: string;
  phases?: TimelinePhase[];
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
