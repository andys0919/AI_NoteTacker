// Azure Retail Prices API, exact MAI meter e366297b-9194-5c2f-91f9-2b6472d890b3:
// USD 0.36/hour and TWD 11.4903/hour, verified 2026-07-31.
export let USD_TO_TWD_RATE = 31.9175;
let twdPricingSource = 'Azure Retail Prices API';
let twdPricingVerifiedAt = '2026-07-31T00:00:00.000Z';

const twdFormatter = new Intl.NumberFormat('zh-TW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

export const applyTwdPricingReference = (reference) => {
  const verifiedAt = new Date(reference?.verifiedAt);
  if (
    !isFiniteNumber(reference?.usdToTwdRate) ||
    reference.usdToTwdRate <= 0 ||
    typeof reference?.source !== 'string' ||
    !reference.source.trim() ||
    Number.isNaN(verifiedAt.getTime())
  ) {
    return false;
  }

  USD_TO_TWD_RATE = reference.usdToTwdRate;
  twdPricingSource = reference.source.trim();
  twdPricingVerifiedAt = verifiedAt.toISOString();
  return true;
};

export const formatTwdFromUsd = (value) =>
  isFiniteNumber(value)
    ? `NT$${twdFormatter.format(value * USD_TO_TWD_RATE)}`
    : '未定價';

export const formatTwdInputFromUsd = (value) =>
  isFiniteNumber(value) ? (value * USD_TO_TWD_RATE).toFixed(2) : '';

export const twdQuotaToUsd = (value) => {
  const amount = typeof value === 'string' && value.trim() ? Number(value) : value;

  return isFiniteNumber(amount)
    ? Math.round((amount / USD_TO_TWD_RATE) * 1_000) / 1_000
    : Number.NaN;
};

export const getTwdPricingReferenceText = () =>
  `費用統一以新台幣顯示；依 ${twdPricingSource} 的 TWD 參考零售價換算` +
  `（${new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).format(new Date(twdPricingVerifiedAt))} 查詢，1 USD = NT$${USD_TO_TWD_RATE}）。` +
  '此為預估，正式帳單以 Azure invoice 為準。';
