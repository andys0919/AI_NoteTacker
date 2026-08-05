import {
  applyAzureRetailPricingSnapshot,
  type AzureRetailPricingSnapshot
} from '../domain/cloud-usage.js';

const AZURE_RETAIL_PRICES_ENDPOINT =
  'https://prices.azure.com/api/retail/prices';
const AZURE_RETAIL_PRICING_REFRESH_MS = 24 * 60 * 60 * 1_000;
const AZURE_RETAIL_PRICING_TIMEOUT_MS = 10_000;
const MAI_METER_ID = 'e366297b-9194-5c2f-91f9-2b6472d890b3';
const LUNA_SKUS = {
  input: '5.6 luna ShortCo Inp Std Gl',
  cachedInput: '5.6 luna ShortCo Cd Inp Std Gl',
  cacheWrite: '5.6 luna ShortCo Cd Wr Std Gl',
  output: '5.6 luna ShortCo Opt Std Gl'
} as const;

type RetailPriceItem = Record<string, unknown>;
type RetailPriceResponse = {
  Items?: unknown;
  NextPageLink?: unknown;
};
type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>;

const buildRetailPriceUrl = (
  filter: string,
  currencyCode: 'TWD' | 'USD' = 'USD'
): string => {
  const url = new URL(AZURE_RETAIL_PRICES_ENDPOINT);
  url.searchParams.set('api-version', '2023-01-01-preview');
  url.searchParams.set('currencyCode', currencyCode);
  url.searchParams.set('$filter', filter);
  return url.toString();
};

export const AZURE_LUNA_RETAIL_PRICE_URL = buildRetailPriceUrl(
  "productName eq 'Azure OpenAI GPT5' and priceType eq 'Consumption' " +
    "and contains(skuName, '5.6 luna ShortCo') and contains(skuName, 'Std Gl')"
);

export const AZURE_MAI_RETAIL_PRICE_URL = buildRetailPriceUrl(
  `meterId eq '${MAI_METER_ID}' and armRegionName eq 'southeastasia' ` +
    "and priceType eq 'Consumption'"
);

export const AZURE_MAI_TWD_RETAIL_PRICE_URL = buildRetailPriceUrl(
  `meterId eq '${MAI_METER_ID}' and armRegionName eq 'southeastasia' ` +
    "and priceType eq 'Consumption'",
  'TWD'
);

const isRecord = (value: unknown): value is RetailPriceItem =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readEffectiveDate = (
  item: RetailPriceItem
): { date: string; timestamp: number } | undefined => {
  if (typeof item.effectiveStartDate !== 'string') {
    return undefined;
  }

  const timestamp = Date.parse(item.effectiveStartDate);
  return Number.isNaN(timestamp)
    ? undefined
    : {
        date: new Date(timestamp).toISOString().slice(0, 10),
        timestamp
      };
};

const readRetailPrice = (item: RetailPriceItem): number | undefined =>
  typeof item.retailPrice === 'number' &&
  Number.isFinite(item.retailPrice) &&
  item.retailPrice > 0
    ? item.retailPrice
    : undefined;

const readItems = async (
  url: string,
  fetcher: FetchLike,
  timeoutMs: number
): Promise<RetailPriceItem[]> => {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Azure Retail Prices API returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RetailPriceResponse;
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.Items) ||
    payload.Items.some((item) => !isRecord(item)) ||
    (payload.NextPageLink !== undefined &&
      payload.NextPageLink !== null &&
      payload.NextPageLink !== '')
  ) {
    throw new Error('Azure Retail Prices API returned an incomplete response');
  }

  return payload.Items as RetailPriceItem[];
};

const readConsistentRate = (
  items: RetailPriceItem[],
  skuName: string,
  effectiveDate: string
): number | undefined => {
  const rows = items.filter(
    (item) =>
      item.skuName === skuName &&
      readEffectiveDate(item)?.date === effectiveDate
  );
  const rates = rows.map(readRetailPrice);
  if (rates.length === 0 || rates.some((rate) => rate === undefined)) {
    return undefined;
  }

  const uniqueRates = new Set(rates as number[]);
  return uniqueRates.size === 1 ? rates[0] : undefined;
};

const parseLunaPricing = (
  items: RetailPriceItem[],
  now: Date
): AzureRetailPricingSnapshot['luna'] => {
  const skuNames = new Set<string>(Object.values(LUNA_SKUS));
  const exactRows = items.filter((item) => skuNames.has(String(item.skuName)));
  if (
    exactRows.length === 0 ||
    exactRows.some(
      (item) =>
        item.currencyCode !== 'USD' ||
        item.productName !== 'Azure OpenAI GPT5' ||
        item.type !== 'Consumption' ||
        item.unitOfMeasure !== '1M' ||
        !readEffectiveDate(item)
    )
  ) {
    throw new Error('Azure Luna retail meters have an invalid identity');
  }

  const effectiveDate = exactRows
    .map(readEffectiveDate)
    .filter(
      (value): value is { date: string; timestamp: number } =>
        value !== undefined && value.timestamp <= now.getTime()
    )
    .map((value) => value.date)
    .sort()
    .at(-1);
  if (!effectiveDate) {
    throw new Error('Azure Luna retail meters are not yet effective');
  }

  const inputUsdPerMillionTokens = readConsistentRate(
    exactRows,
    LUNA_SKUS.input,
    effectiveDate
  );
  const cachedInputUsdPerMillionTokens = readConsistentRate(
    exactRows,
    LUNA_SKUS.cachedInput,
    effectiveDate
  );
  const cacheWriteUsdPerMillionTokens = readConsistentRate(
    exactRows,
    LUNA_SKUS.cacheWrite,
    effectiveDate
  );
  const outputUsdPerMillionTokens = readConsistentRate(
    exactRows,
    LUNA_SKUS.output,
    effectiveDate
  );
  if (
    inputUsdPerMillionTokens === undefined ||
    cachedInputUsdPerMillionTokens === undefined ||
    cacheWriteUsdPerMillionTokens === undefined ||
    outputUsdPerMillionTokens === undefined
  ) {
    throw new Error('Azure Luna retail meters are incomplete or inconsistent');
  }

  return {
    effectiveDate,
    meterSource: AZURE_LUNA_RETAIL_PRICE_URL,
    inputUsdPerMillionTokens,
    cachedInputUsdPerMillionTokens,
    cacheWriteUsdPerMillionTokens,
    outputUsdPerMillionTokens
  };
};

const parseMaiMeter = (
  items: RetailPriceItem[],
  now: Date,
  currencyCode: 'TWD' | 'USD'
): { effectiveDate: string; rate: number } => {
  const exactRows = items.filter((item) => item.meterId === MAI_METER_ID);
  if (
    exactRows.length === 0 ||
    exactRows.some(
      (item) =>
        item.currencyCode !== currencyCode ||
        item.armRegionName !== 'southeastasia' ||
        item.productName !== 'Azure Speech' ||
        item.skuName !== 'Fast Transcription' ||
        item.meterName !== 'Fast Transcription Speech To Text' ||
        item.type !== 'Consumption' ||
        item.unitOfMeasure !== '1 Hour' ||
        !readEffectiveDate(item)
    )
  ) {
    throw new Error('Azure MAI retail meter has an invalid identity');
  }

  const effectiveRows = exactRows.filter(
    (item) => (readEffectiveDate(item)?.timestamp ?? Number.POSITIVE_INFINITY) <= now.getTime()
  );
  const effectiveDate = effectiveRows
    .map((item) => readEffectiveDate(item)?.date)
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
  const rows = effectiveRows.filter(
    (item) => readEffectiveDate(item)?.date === effectiveDate
  );
  const rates = rows.map(readRetailPrice);
  const uniqueRates = new Set(rates as number[]);
  if (
    !effectiveDate ||
    rates.length === 0 ||
    rates.some((rate) => rate === undefined) ||
    uniqueRates.size !== 1
  ) {
    throw new Error('Azure MAI retail meter is not effective or consistent');
  }

  return { effectiveDate, rate: rates[0] as number };
};

export const refreshAzureRetailPricing = async (
  options: {
    fetcher?: FetchLike;
    now?: Date;
    timeoutMs?: number;
  } = {}
): Promise<AzureRetailPricingSnapshot> => {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? AZURE_RETAIL_PRICING_TIMEOUT_MS;
  const [lunaItems, maiItems, twdItems] = await Promise.all([
    readItems(AZURE_LUNA_RETAIL_PRICE_URL, fetcher, timeoutMs),
    readItems(AZURE_MAI_RETAIL_PRICE_URL, fetcher, timeoutMs),
    readItems(AZURE_MAI_TWD_RETAIL_PRICE_URL, fetcher, timeoutMs)
  ]);
  const maiMeter = parseMaiMeter(maiItems, now, 'USD');
  const twdMeter = parseMaiMeter(twdItems, now, 'TWD');
  if (maiMeter.effectiveDate !== twdMeter.effectiveDate) {
    throw new Error('Azure MAI USD and TWD retail meter effective dates differ');
  }
  if (maiMeter.rate <= 0) {
    throw new Error('Azure MAI USD retail rate cannot derive a TWD reference');
  }
  const snapshot = {
    luna: parseLunaPricing(lunaItems, now),
    mai: {
      effectiveDate: maiMeter.effectiveDate,
      meterSource: AZURE_MAI_RETAIL_PRICE_URL,
      usdPerHour: maiMeter.rate
    },
    twd: {
      effectiveDate: twdMeter.effectiveDate,
      meterSource: AZURE_MAI_TWD_RETAIL_PRICE_URL,
      twdPerHour: twdMeter.rate,
      usdToTwdRate:
        Math.round((twdMeter.rate / maiMeter.rate) * 1_000_000) / 1_000_000,
      verifiedAt: now.toISOString()
    }
  };

  applyAzureRetailPricingSnapshot(snapshot);
  return snapshot;
};

const refreshAndLog = async (): Promise<void> => {
  try {
    const snapshot = await refreshAzureRetailPricing();
    console.info(
      '[control-plane] Azure retail pricing refreshed',
      JSON.stringify({
        lunaEffectiveDate: snapshot.luna.effectiveDate,
        lunaInput: snapshot.luna.inputUsdPerMillionTokens,
        lunaCachedInput: snapshot.luna.cachedInputUsdPerMillionTokens,
        lunaCacheWrite: snapshot.luna.cacheWriteUsdPerMillionTokens,
        lunaOutput: snapshot.luna.outputUsdPerMillionTokens,
        maiEffectiveDate: snapshot.mai.effectiveDate,
        maiUsdPerHour: snapshot.mai.usdPerHour,
        usdToTwdRate: snapshot.twd.usdToTwdRate,
        twdVerifiedAt: snapshot.twd.verifiedAt
      })
    );
  } catch (error) {
    console.warn(
      '[control-plane] Azure retail pricing refresh failed; keeping last verified catalog',
      error instanceof Error ? error.message : String(error)
    );
  }
};

export const startAzureRetailPricingRefresh = async (): Promise<NodeJS.Timeout> => {
  await refreshAndLog();
  const timer = setInterval(() => {
    void refreshAndLog();
  }, AZURE_RETAIL_PRICING_REFRESH_MS);
  timer.unref();
  return timer;
};
