import { fetchWithAuth } from "@/lib/apiClient";

const BASE_CURRENCY = "USD";
const EXCHANGE_RATE_API_KEY = import.meta.env.VITE_EXCHANGE_RATE_API_KEY as string;

export interface ServicePriceConversion {
  sourceCurrency: "USD";
  targetCurrency: string;
  sourceAmount: number;
  convertedAmount: number;
  exchangeRate: number;
  rateDate: string;
  provider: string;
  cached: boolean;
}

export async function convertClientServicePrice(
  clientId: string,
  sourceAmount: number,
  targetCurrency: string
): Promise<ServicePriceConversion> {
  const normalizedTargetCurrency = normalizeCurrency(targetCurrency);
  const normalizedSourceAmount = normalizeAmount(sourceAmount);

  if (normalizedTargetCurrency === BASE_CURRENCY) {
    return buildConversion(normalizedSourceAmount, normalizedTargetCurrency, 1, "identity", false);
  }

  try {
    const resp = await fetchWithAuth("/api/convert/service-price", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
    return (await resp.json()) as ServicePriceConversion;
  } catch {
    return convertServicePriceInBrowser(normalizedSourceAmount, normalizedTargetCurrency);
  }
}

async function convertServicePriceInBrowser(
  sourceAmount: number,
  targetCurrency: string
): Promise<ServicePriceConversion> {
  try {
    const rate = await fetchFrankfurterRate(targetCurrency);
    return buildConversion(sourceAmount, targetCurrency, rate.exchangeRate, rate.provider, false, rate.rateDate);
  } catch {
    const rate = await fetchExchangeRateApiRate(targetCurrency);
    return buildConversion(sourceAmount, targetCurrency, rate.exchangeRate, rate.provider, false, rate.rateDate);
  }
}

async function fetchFrankfurterRate(targetCurrency: string) {
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/${BASE_CURRENCY}/${targetCurrency}`);
  if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);
  const data = (await response.json()) as { date?: string; rate?: number; rates?: Record<string, number> };
  const exchangeRate = Number(data.rate ?? data.rates?.[targetCurrency]);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Frankfurter returned no exchange rate.");
  return {
    exchangeRate,
    rateDate: data.date ?? new Date().toISOString().slice(0, 10),
    provider: "frankfurter",
  };
}

async function fetchExchangeRateApiRate(targetCurrency: string) {
  const response = await fetch(
    `https://v6.exchangerate-api.com/v6/${EXCHANGE_RATE_API_KEY}/pair/${BASE_CURRENCY}/${targetCurrency}`
  );
  if (!response.ok) throw new Error(`ExchangeRate-API returned ${response.status}`);
  const data = (await response.json()) as {
    result?: "success" | "error";
    "error-type"?: string;
    conversion_rate?: number;
    time_last_update_utc?: string;
  };
  if (data.result === "error") throw new Error(`ExchangeRate-API error: ${data["error-type"] ?? "unknown"}`);
  const exchangeRate = Number(data.conversion_rate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("ExchangeRate-API returned no exchange rate.");
  return {
    exchangeRate,
    rateDate: parseRateDate(data.time_last_update_utc),
    provider: "exchangerate-api",
  };
}

function buildConversion(
  sourceAmount: number,
  targetCurrency: string,
  exchangeRate: number,
  provider: string,
  cached: boolean,
  rateDate = new Date().toISOString().slice(0, 10)
): ServicePriceConversion {
  return {
    sourceCurrency: BASE_CURRENCY,
    targetCurrency,
    sourceAmount,
    convertedAmount: Math.round(sourceAmount * exchangeRate * 100) / 100,
    exchangeRate,
    rateDate,
    provider,
    cached,
  };
}

function normalizeCurrency(value: string): string {
  const currency = String(value || BASE_CURRENCY).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return BASE_CURRENCY;
  return currency;
}

function normalizeAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function parseRateDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}
