import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAdminFirestore } from "./lib/firebaseAdmin";
import { callableCors } from "./lib/cors";
import axios, { AxiosError } from "axios";
import * as admin from "firebase-admin";

const BASE_CURRENCY = "USD";
const RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v2";
const EXCHANGE_RATE_API_BASE_URL = "https://v6.exchangerate-api.com/v6";
const EXCHANGE_RATE_API_KEY = process.env.EXCHANGE_RATE_API_KEY;

interface ConvertServicePriceRequest {
  clientId?: string;
}

interface FrankfurterRateResponse {
  date?: string;
  rate?: number;
  rates?: Record<string, number>;
}

interface ExchangeRateApiPairResponse {
  result?: "success" | "error";
  "error-type"?: string;
  conversion_rate?: number;
  time_last_update_utc?: string;
}

interface ExchangeRateLookup {
  exchangeRate: number;
  rateDate: string;
  provider: string;
  cached: boolean;
}

export const convertServicePrice = onCall(
  { cors: callableCors, timeoutSeconds: 30 },
  async (request) => {
    const { clientId } = request.data as ConvertServicePriceRequest;
    if (!clientId) throw new HttpsError("invalid-argument", "clientId required.");

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.");
    }

    const db = getAdminFirestore();
    await assertClientAccess(db, request.auth.uid, request.auth.token, clientId);

    const clientDoc = await db.collection("clients").doc(clientId).get();
    if (!clientDoc.exists) throw new HttpsError("not-found", "Client not found.");

    const clientData = clientDoc.data()!;
    const servicePriceUsd = normalizeAmount(clientData.servicePrice ?? clientData.agencyFee ?? 0);
    const targetCurrency = normalizeCurrency(clientData.currency ?? BASE_CURRENCY);
    const conversion = await getUsdExchangeRate(targetCurrency);

    return {
      sourceCurrency: BASE_CURRENCY,
      targetCurrency,
      sourceAmount: servicePriceUsd,
      convertedAmount: roundMoney(servicePriceUsd * conversion.exchangeRate),
      exchangeRate: conversion.exchangeRate,
      rateDate: conversion.rateDate,
      provider: conversion.provider,
      cached: conversion.cached,
    };
  }
);

async function assertClientAccess(
  db: FirebaseFirestore.Firestore,
  uid: string,
  token: Record<string, unknown>,
  clientId: string
) {
  const tokenRole = token.role as string | undefined;
  const tokenClientId = token.clientId as string | undefined;
  if (tokenRole === "admin" || tokenRole === "executiveAdmin" || tokenClientId === clientId) return;

  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data();
  if (userData?.role === "admin" || userData?.role === "executiveAdmin" || userData?.clientId === clientId) return;

  throw new HttpsError("permission-denied", "Access denied.");
}

async function getUsdExchangeRate(targetCurrency: string) {
  if (targetCurrency === BASE_CURRENCY) {
    return {
      exchangeRate: 1,
      rateDate: new Date().toISOString().slice(0, 10),
      provider: "identity",
      cached: false,
    };
  }

  const db = getAdminFirestore();
  const cacheRef = db.collection("exchangeRates").doc(`${BASE_CURRENCY}_${targetCurrency}`);
  const cached = await cacheRef.get();
  const cachedData = cached.data();
  const cachedFetchedAt = cachedData?.fetchedAt?.toDate?.() as Date | undefined;
  const cachedRate = Number(cachedData?.exchangeRate);

  if (
    Number.isFinite(cachedRate) &&
    cachedRate > 0 &&
    cachedFetchedAt &&
    Date.now() - cachedFetchedAt.getTime() < RATE_CACHE_TTL_MS
  ) {
    return {
      exchangeRate: cachedRate,
      rateDate: String(cachedData?.rateDate ?? cachedFetchedAt.toISOString().slice(0, 10)),
      provider: String(cachedData?.provider ?? "frankfurter"),
      cached: true,
    };
  }

  try {
    const freshRate = await fetchFrankfurterRate(targetCurrency);
    await cacheRef.set(
      {
        baseCurrency: BASE_CURRENCY,
        targetCurrency,
        exchangeRate: freshRate.exchangeRate,
        rateDate: freshRate.rateDate,
        provider: freshRate.provider,
        fetchedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true }
    );

    return freshRate;
  } catch (err) {
    console.warn(`[convertServicePrice] Frankfurter lookup failed for ${BASE_CURRENCY}/${targetCurrency}:`, summarizeRateError(err));

    try {
      const fallbackRate = await fetchExchangeRateApiRate(targetCurrency);
      await cacheRef.set(
        {
          baseCurrency: BASE_CURRENCY,
          targetCurrency,
          exchangeRate: fallbackRate.exchangeRate,
          rateDate: fallbackRate.rateDate,
          provider: fallbackRate.provider,
          fetchedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true }
      );

      return fallbackRate;
    } catch (fallbackErr) {
      if (isUnsupportedCurrencyError(err) && isUnsupportedCurrencyError(fallbackErr)) {
        throw new HttpsError(
          "failed-precondition",
          `Reporting currency ${targetCurrency} is not supported by the exchange-rate providers.`
        );
      }

      throw new HttpsError(
        "unavailable",
        `Could not fetch ${BASE_CURRENCY}/${targetCurrency} exchange rate.`
      );
    }
  }
}

async function fetchFrankfurterRate(targetCurrency: string): Promise<ExchangeRateLookup> {
  const url = `${FRANKFURTER_BASE_URL}/rate/${BASE_CURRENCY}/${targetCurrency}`;
  const response = await axios.get<FrankfurterRateResponse>(url, { timeout: 10000 });
  const rate = Number(response.data.rate ?? response.data.rates?.[targetCurrency]);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new HttpsError(
      "unavailable",
      `No ${BASE_CURRENCY}/${targetCurrency} exchange rate returned by Frankfurter.`
    );
  }

  return {
    exchangeRate: rate,
    rateDate: String(response.data.date ?? new Date().toISOString().slice(0, 10)),
    provider: "frankfurter",
    cached: false,
  };
}

async function fetchExchangeRateApiRate(targetCurrency: string): Promise<ExchangeRateLookup> {
  const url = `${EXCHANGE_RATE_API_BASE_URL}/${EXCHANGE_RATE_API_KEY}/pair/${BASE_CURRENCY}/${targetCurrency}`;
  const response = await axios.get<ExchangeRateApiPairResponse>(url, { timeout: 10000 });
  const result = response.data;

  if (result.result === "error") {
    throw new HttpsError(
      result["error-type"] === "unsupported-code" ? "failed-precondition" : "unavailable",
      `ExchangeRate-API error: ${result["error-type"] ?? "unknown"}`
    );
  }

  const rate = Number(result.conversion_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new HttpsError(
      "unavailable",
      `No ${BASE_CURRENCY}/${targetCurrency} exchange rate returned by ExchangeRate-API.`
    );
  }

  return {
    exchangeRate: rate,
    rateDate: parseExchangeRateApiDate(result.time_last_update_utc),
    provider: "exchangerate-api",
    cached: false,
  };
}

function parseExchangeRateApiDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function isUnsupportedCurrencyError(err: unknown): boolean {
  if (err instanceof HttpsError) return err.code === "failed-precondition";
  const axiosError = err as AxiosError<{ message?: string }>;
  const status = axiosError.response?.status;
  return status === 400 || status === 404 || status === 422;
}

function summarizeRateError(err: unknown) {
  if (err instanceof HttpsError) return { code: err.code, message: err.message };
  const axiosError = err as AxiosError<{ message?: string }>;
  return {
    status: axiosError.response?.status,
    message: axiosError.message,
  };
}

function normalizeCurrency(value: unknown): string {
  const currency = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpsError("failed-precondition", "Client reporting currency must be a 3-letter ISO code.");
  }
  return currency;
}

function normalizeAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, amount);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
