// Amounts selected by the operator on September 9, 2026. Store atomic USDC
// amounts as decimal strings; never calculate payment amounts with floats.
export const CLAWD_PRICES = {
  monthly: { usd: '$4.20', amountAtomic: '4200000', cadence: 'month' },
  oneTime: { usd: '$19.99', amountAtomic: '19990000', cadence: 'once' },
} as const;

// Receiver and the one-time purchase entitlement must be configured before
// payment requests can be enabled. These prices alone do not grant access.
export const USDC_MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
