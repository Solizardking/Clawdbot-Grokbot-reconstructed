export interface Candle { time:number; open:number; high:number; low:number; close:number; volume:number }
export type BirdeyeResearch = {
  source:'Birdeye'; status:'ready'; retrievedAt:string; sourceUrl:string; amountMode:'raw';
  priceUsd:number|null; tokenLiquidityUsd:number|null; totalSupply:number|null; circulatingSupply:number|null;
  marketCapUsd:number|null; fdvUsd:number|null; holders:number|null; scaledUiToken:boolean|null; scalingMultiplier:number|null;
} | {source:'Birdeye';status:'access_denied'|'rate_limited'|'unavailable'|'unconfigured'|'not_indexed'|'unsupported_network';checkedAt:string};
export interface MarketResearch {
  kind:'market'; source:string; sourceUrl:string; retrievedAt:string; chartRetrievedAt:string;
  network:string; address:string; name:string; symbol:string; poolAddress:string; poolName:string; dex:string;
  priceUsd:number|null; poolLiquidityUsd:number|null; poolVolume24hUsd:number|null;
  priceChange24hPercent:number|null; marketCapUsd:number|null; fdvUsd:number|null;
  range:string; intervalSeconds:number; candles:Candle[]; notes:string[];
  birdeye?:BirdeyeResearch;
}
export interface WebResearch {
  kind:'web'; query:string; source:string; retrievedAt:string;
  results:Array<{url:string;title:string;content:string}>;
}
export interface TokenCandidate { network:string; address:string; name:string; symbol:string; priceUsd:number|null; poolLiquidityUsd:number|null; birdeye?:BirdeyeResearch }
export type ResearchData = MarketResearch | WebResearch;
