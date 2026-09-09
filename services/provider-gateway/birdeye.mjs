const address = value => typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);

export function birdeyeRequest(body) {
  if (!record(body)) return null;
  if (body.action === 'market_data' && Object.keys(body).every(k => ['action', 'mints'].includes(k)) &&
      Array.isArray(body.mints) && body.mints.length >= 1 && body.mints.length <= 20 && body.mints.every(address)) {
    const mints = [...new Set(body.mints)];
    return { action: 'market_data', mints, path: '/defi/v3/token/market-data/multiple?' + new URLSearchParams({list_address:mints.join(','),ui_amount_mode:'raw'}) };
  }
  if (body.action === 'price' && Object.keys(body).every(k => ['action', 'mints'].includes(k)) &&
      Array.isArray(body.mints) && body.mints.length >= 1 && body.mints.length <= 10 && body.mints.every(address)) {
    const mints = [...new Set(body.mints)];
    return { action: 'price', mints, path: '/defi/multi_price?list_address=' + encodeURIComponent(mints.join(',')) };
  }
  if (body.action === 'overview' && Object.keys(body).every(k => ['action', 'mint'].includes(k)) && address(body.mint)) {
    return { action: 'overview', path: '/defi/token_overview?address=' + encodeURIComponent(body.mint) };
  }
  return null;
}

const numbers = (row, keys) => Object.fromEntries(keys.map(key => [key, typeof row[key] === 'number' && Number.isFinite(row[key]) ? row[key] : null]));
export async function birdeyeResponse(response, request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('Market response too large');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(payload) || payload.success !== true || !record(payload.data)) throw new Error('Invalid market response');
  if (request.action === 'market_data') return { success:true, data:Object.fromEntries(request.mints.map(mint=> {
    const row=payload.data[mint];
    if(!record(row)||row.address!==mint)return [mint,null];
    return [mint,{address:mint,...Object.fromEntries(['price','liquidity','total_supply','circulating_supply','market_cap','fdv','holder','multiplier'].map(key=>[key,typeof row[key]==='number'&&Number.isFinite(row[key])&&row[key]>=0?row[key]:null])),
      is_scaled_ui_token:typeof row.is_scaled_ui_token==='boolean'?row.is_scaled_ui_token:null}];
  })) };
  if (request.action === 'price') return { success: true, data: Object.fromEntries(request.mints.map(mint => [mint,
    record(payload.data[mint]) ? numbers(payload.data[mint], ['value', 'priceChange24h', 'updateUnixTime']) : null])) };
  const row = payload.data;
  return { success: true, data: { ...numbers(row, ['price', 'mc', 'liquidity', 'holder', 'v24hUSD', 'priceChange24hPercent']),
    ...Object.fromEntries(['symbol', 'name'].map(key => [key, typeof row[key] === 'string' ? row[key].slice(0, 200) : null])) } };
}

// This cache contains public market data only. The provider key stays inside Fly.
export function createBirdeyeEnrichment({fetchImpl,now,apiKey}) {
  const cache=new Map();
  let retryAt=0,blockedStatus='unavailable',blockedAt=0;
  const unavailable=status=>({source:'Birdeye',status,checkedAt:new Date(now()).toISOString()});
  async function load(mints,signal) {
    if(!apiKey?.trim())return unavailable('unconfigured');
    if(now()<retryAt)return {...unavailable(blockedStatus),checkedAt:new Date(blockedAt).toISOString()};
    const ids=[...new Set(mints)].sort(),key=ids.join(','),cached=cache.get(key);
    if(cached&&now()-cached.at<30000)return cached.value;
    const request=birdeyeRequest({action:'market_data',mints:ids});
    if(!request)return unavailable('unavailable');
    try {
      const response=await fetchImpl('https://public-api.birdeye.so'+request.path,{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),headers:{'X-API-KEY':apiKey.trim(),'x-chain':'solana',accept:'application/json'}});
      if(!response.ok){await response.body?.cancel();blockedStatus=[401,403].includes(response.status)?'access_denied':response.status===429?'rate_limited':'unavailable';blockedAt=now();retryAt=now()+([401,403].includes(response.status)?300000:60000);return unavailable(blockedStatus);}
      const result=await birdeyeResponse(response,request);
      const value={source:'Birdeye',status:'ready',retrievedAt:new Date(now()).toISOString(),data:result.data};
      if(cache.size>=100)cache.delete(cache.keys().next().value);cache.set(key,{at:now(),value});return value;
    } catch {blockedStatus='unavailable';blockedAt=now();retryAt=now()+60000;return unavailable(blockedStatus);}
  }
  function tokenData(result,mint) {
    if(result.status!=='ready')return result;
    const row=result.data[mint];
    if(!row)return unavailable('not_indexed');
    return {source:'Birdeye',status:'ready',retrievedAt:result.retrievedAt,sourceUrl:'https://birdeye.so/token/'+mint+'?chain=solana',
      amountMode:'raw',priceUsd:row.price,tokenLiquidityUsd:row.liquidity,totalSupply:row.total_supply,circulatingSupply:row.circulating_supply,
      marketCapUsd:row.market_cap,fdvUsd:row.fdv,holders:row.holder,scaledUiToken:row.is_scaled_ui_token,scalingMultiplier:row.multiplier};
  }
  return async(data,signal)=>{
    if(data.kind==='market')return {...data,birdeye:data.network==='solana'?tokenData(await load([data.address],signal),data.address):unavailable('unsupported_network')};
    if(data.kind==='tokens') {
      const mints=data.tokens.filter(t=>t.network==='solana').map(t=>t.address);
      if(!mints.length)return data;
      const result=await load(mints,signal);
      return {...data,tokens:data.tokens.map(token=>token.network==='solana'?{...token,birdeye:tokenData(result,token.address)}:token)};
    }
    return data;
  };
}
