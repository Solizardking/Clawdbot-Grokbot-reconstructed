const NETWORKS = { solana: 'solana', ethereum: 'eth', base: 'base', bsc: 'bsc', arbitrum: 'arbitrum', polygon: 'polygon_pos' };
const RANGES = { '24h': ['hour', 1, 24], '7d': ['hour', 4, 42], '30d': ['day', 1, 30] };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const error = (message, status = 502) => Object.assign(new Error(message), { status });
function address(network,value) {
  if(typeof value!=='string')return false;
  if(network!=='solana')return /^0x[a-fA-F0-9]{40}$/.test(value);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))return false;
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decoded=0n;for(const character of value)decoded=decoded*58n+BigInt(alphabet.indexOf(character));
  let bytes=0;while(decoded>0n){bytes++;decoded>>=8n;}
  return bytes+(value.match(/^1*/)?.[0].length??0)===32;
}
export const MARKET_TOOLS = [
  {name:'market_search',description:'Find on-chain tokens by ticker, name or contract address. Select the exact chain and address before fetching a quote or chart.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:200}},required:['query'],additionalProperties:false}},
  {name:'market_snapshot',description:'Fetch a timestamped USD price and real OHLCV candles from a liquid pool for the exact token. Includes pool liquidity and volume, source URL and retrieval times. Wrapped tokens are not native-coin supply figures.',inputSchema:{type:'object',properties:{network:{type:'string',enum:Object.keys(NETWORKS)},address:{type:'string',description:'Exact contract address. For Wrapped SOL on Solana, use the unambiguous alias wrapped-sol to avoid copying its long mint incorrectly.'},range:{type:'string',enum:Object.keys(RANGES)}},required:['network','address','range'],additionalProperties:false}},
].map(tool=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:true}}));

export function marketRequest(body) {
  if (!object(body)) return null;
  if(body.network==='solana'&&body.address==='wrapped-sol')body={...body,address:'So11111111111111111111111111111111111111112'};
  if (body.action === 'search' && Object.keys(body).every(k => ['action','query'].includes(k)) && typeof body.query === 'string' && body.query.trim() && body.query.length <= 200) return { action: 'search', query: body.query.trim() };
  if (body.action === 'snapshot' && Object.keys(body).every(k => ['action','network','address','range'].includes(k)) &&
      Object.hasOwn(NETWORKS, body.network) && address(body.network, body.address) && Object.hasOwn(RANGES, body.range)) return {...body,address:body.network==='solana'?body.address:body.address.toLowerCase()};
  return null;
}

export function normalizeCandles(rows, now) {
  if (!Array.isArray(rows)) throw error('No historical candles returned');
  const seen = new Set();
  return rows.filter(row => Array.isArray(row) && row.length >= 6 && row.slice(0,6).every(value => typeof value === 'number' && Number.isFinite(value)) &&
    Number.isSafeInteger(row[0]) && row[0] > 0 && row[0] * 1000 <= now && row.slice(1,6).every(value => value >= 0) &&
    row[2] >= Math.max(row[1],row[3],row[4]) && row[3] <= Math.min(row[1],row[2],row[4]))
    .sort((a,b) => a[0]-b[0]).filter(row => { if (seen.has(row[0])) return false; seen.add(row[0]); return true; })
    .map(([time,open,high,low,close,volume]) => ({ time,open,high,low,close,volume }));
}

export function createMarketService({ fetchImpl, now }) {
  const cache = new Map(), pending = new Map(), budgets = new Map();
  async function get(url, signal) {
    const cached = cache.get(url);
    if (cached && now() - cached.at < 30000) return cached;
    if (pending.has(url)) return pending.get(url);
    const origin = new URL(url).origin;
    let bucket = budgets.get(origin);
    if (!bucket || now()-bucket.at >= 60000) { bucket = { at: now(), count: 0 }; budgets.set(origin,bucket); }
    if (++bucket.count > 25) throw error('Market provider rate limit reached; retry in one minute',429);
    const load = (async () => {
      const response = await fetchImpl(url, { redirect: 'error', signal, headers: { accept: 'application/json' } });
      if (!response.ok) { await response.body?.cancel(); throw error(`Market provider returned HTTP ${response.status}`, response.status === 429 ? 429 : 502); }
      let size=0; const chunks=[];
      for await (const chunk of response.body) { size+=chunk.length; if(size>2_097_152)throw error('Market response too large'); chunks.push(chunk); }
      const entry={at:now(),data:JSON.parse(Buffer.concat(chunks).toString('utf8'))};
      if(cache.size>=100)cache.delete(cache.keys().next().value); cache.set(url,entry); return entry;
    })();
    pending.set(url,load); try{return await load;}finally{pending.delete(url);}
  }
  return async (request, signal) => {
    if (request.action === 'search') {
      const found=await get('https://api.dexscreener.com/latest/dex/search?q='+encodeURIComponent(request.query),signal);
      if(!Array.isArray(found.data.pairs))throw error('Invalid token search response');
      const seen=new Set();
      const tokens=found.data.pairs.filter(pair=>Object.hasOwn(NETWORKS,pair.chainId)&&address(pair.chainId,pair.baseToken?.address))
        .sort((a,b)=>(number(b.liquidity?.usd)??0)-(number(a.liquidity?.usd)??0))
        .filter(pair=>{const id=pair.chainId+':'+pair.baseToken.address;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,12)
        .map(pair=>({network:pair.chainId,address:pair.baseToken.address,name:String(pair.baseToken.name??'').slice(0,100),symbol:String(pair.baseToken.symbol??'').slice(0,30),priceUsd:number(pair.priceUsd),poolLiquidityUsd:number(pair.liquidity?.usd)}));
      return {kind:'tokens',source:'DEX Screener',retrievedAt:new Date(found.at).toISOString(),tokens};
    }
    const net=NETWORKS[request.network],prefix='https://api.geckoterminal.com/api/v2/networks/'+net;
    const pools=await get(prefix+'/tokens/'+encodeURIComponent(request.address)+'/pools?page=1',signal);
    if(!Array.isArray(pools.data.data))throw error('No pools available for this token',404);
    const matches=pools.data.data.filter(pool=>{
      const base=pool.relationships?.base_token?.data?.id,quote=pool.relationships?.quote_token?.data?.id;
      return address(request.network,pool.attributes?.address)&&(base===net+'_'+request.address||quote===net+'_'+request.address);
    }).sort((a,b)=>(number(b.attributes?.reserve_in_usd)??0)-(number(a.attributes?.reserve_in_usd)??0));
    if(!matches.length)throw error('No matching pool found for this token',404);
    const pool=matches[0],a=pool.attributes,side=pool.relationships.base_token.data.id===net+'_'+request.address?'base':'quote';
    const [timeframe,aggregate,limit]=RANGES[request.range];
    const history=await get(prefix+'/pools/'+a.address+'/ohlcv/'+timeframe+'?'+new URLSearchParams({aggregate:String(aggregate),limit:String(limit),currency:'usd',token:side}),signal);
    const token=history.data.meta?.[side];
    if(token?.address!==request.address)throw error('Historical data does not match the selected token');
    const candles=normalizeCandles(history.data.data?.attributes?.ohlcv_list,now());
    if(!candles.length)throw error('No valid historical candles returned',404);
    return {kind:'market',source:'GeckoTerminal',sourceUrl:`https://www.geckoterminal.com/${net}/pools/${a.address}`,
      retrievedAt:new Date(pools.at).toISOString(),chartRetrievedAt:new Date(history.at).toISOString(),
      network:request.network,address:request.address,name:String(token.name??'').slice(0,100),symbol:String(token.symbol??'').slice(0,30),
      poolAddress:a.address,poolName:String(a.name??'').slice(0,100),dex:String(pool.relationships?.dex?.data?.id??''),
      priceUsd:number(a[side+'_token_price_usd']),poolLiquidityUsd:number(a.reserve_in_usd),poolVolume24hUsd:number(a.volume_usd?.h24),
      priceChange24hPercent:side==='base'?number(a.price_change_percentage?.h24):null,
      marketCapUsd:side==='base'?number(a.market_cap_usd):null,fdvUsd:side==='base'?number(a.fdv_usd):null,
      range:request.range,intervalSeconds:aggregate*(timeframe==='hour'?3600:86400),candles,
      notes:['On-chain pool data for the selected token; wrapped assets may differ from their native coin.','Liquidity and volume describe this pool. Missing candles are not filled. The latest candle may still be forming.']};
  };
}
