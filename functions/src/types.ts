export interface ClientDoc {
  name: string;
  contactName: string;
  contactEmail: string;
  contractStartDate: FirebaseFirestore.Timestamp;
  contractEndDate?: FirebaseFirestore.Timestamp;
  agencyFee: number;
  servicePrice?: number;
  currency: string;
  logoUrl: string;
  status: "active" | "inactive";
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface ConvertCredentials {
  accountId: string;
  projectId: string;
  apiKey: string; // AES-256 encrypted
}

export interface ExperimentReport {
  experimentId: string;
  experimentName: string;
  status: string;
  startDate: string;
  endDate?: string;
  variants: VariantData[];
  winnerVariantId?: string;
  primaryGoal?: string;
  confidenceLevel?: number;
}

export interface VariantData {
  variantId: string;
  variantName: string;
  trafficSplit: number;
  sessions: number;
  conversions: number;
  revenue: number;
  cvr: number;
  rpv: number;
}

export interface ROISnapshot {
  totalRevenueGained: number;
  totalPurchasesGained: number;
  productsGained: number;
  productsLost: number;
  blendedROI: number;
  calculatedAt: FirebaseFirestore.Timestamp;
  breakdown: ExperimentROIEntry[];
}

export interface ExperimentROIEntry {
  experimentId: string;
  experimentName: string;
  upliftPercent: number;
  revenueGained: number;
  purchasesGained: number;
}
