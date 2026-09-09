import { useRef, useState } from 'react';
import { Search, ChartCandlestick, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { useStore, type Bot } from '@/state/store';
import type { BirdeyeResearch, Candle, MarketResearch, ResearchData, TokenCandidate } from '../../shared/research';

const dollars=(n:number|null)=>n===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumSignificantDigits:7}).format(n);
const quantity=(n:number|null)=>n===null?'Unavailable':new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(n);
const birdeyeStatus={access_denied:'Birdeye access denied. Holder, supply and token-wide market fields require access on the configured API plan.',rate_limited:'Birdeye rate limit reached. Additional fields are temporarily unavailable.',unavailable:'Birdeye additional market data is temporarily unavailable.',unconfigured:'Birdeye market data is not configured.',not_indexed:'Birdeye has no indexed market data for this token.',unsupported_network:'Birdeye enrichment is currently enabled for Solana tokens.'};
const utc=(time:number|string)=>new Date(typeof time==='number'?time*1000:time).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC';
async function research(botId:string,body:unknown,signal:AbortSignal) {
  const response=await fetch(`/api/bots/${botId}/research`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error??'Research request failed');
  return value;
}

export function ResearchPanel({bot}:{bot:Bot}) {
  const [open,setOpen]=useState(false),[mode,setMode]=useState<'web'|'search'>('web'),[query,setQuery]=useState('');
  const [tokens,setTokens]=useState<TokenCandidate[]>([]),[range,setRange]=useState('24h'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const sequence=useRef(0);
  async function run(body:unknown) {
    const current=++sequence.current;
    setBusy(true);setError('');
    try {
      const value=await research(bot.id,body,AbortSignal.timeout(50000));
      if(current!==sequence.current)return;
      if(value.kind==='tokens') {setTokens(value.tokens);if(!value.tokens.length)setError('No matching on-chain tokens found. Try a mint or contract address.');}
      else {setTokens([]);setOpen(false);}
    } catch(e) {if(current===sequence.current)setError(e instanceof Error?e.message:'Research failed');}
    finally {if(current===sequence.current)setBusy(false);}
  }
  return <div className="mx-auto w-full max-w-3xl px-5 pb-1">
    <button onClick={()=>setOpen(!open)} aria-expanded={open} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink"><Search size={13}/> Search & markets <ChevronDown size={12}/></button>
    {open&&<section aria-label="Chat research" className="mb-2 rounded-xl border border-hairline bg-raised p-3">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <button onClick={()=>{setMode('web');setTokens([]);}} aria-pressed={mode==='web'} className={`rounded-lg px-3 py-1.5 ${mode==='web'?'bg-panel text-ink':'text-muted'}`}>Web search</button>
        <button onClick={()=>setMode('search')} aria-pressed={mode==='search'} className={`rounded-lg px-3 py-1.5 ${mode==='search'?'bg-panel text-ink':'text-muted'}`}>Crypto prices & charts</button>
        {mode==='search'&&<select aria-label="Chart range" value={range} onChange={e=>setRange(e.target.value)} className="ml-auto rounded bg-transparent px-1 py-1 text-ink"><option>24h</option><option>7d</option><option>30d</option></select>}
      </div>
      <form onSubmit={e=>{e.preventDefault();void run({action:mode,query});}} className="flex gap-2">
        <input aria-label="Research query" value={query} onChange={e=>setQuery(e.target.value)} maxLength={mode==='web'?1000:200} placeholder={mode==='web'?'Search finance, news, or the web…':'Token name, ticker, or contract address…'} className="min-w-0 flex-1 rounded-lg border border-hairline bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-emerald-500"/>
        <button disabled={busy||bot.busy||!query.trim()} className="rounded-lg bg-emerald-600 px-3 text-sm text-white disabled:opacity-40">{busy?<Loader2 size={16} className="animate-spin"/>:'Search'}</button>
      </form>
      <p className="mt-2 text-[11px] text-muted">{mode==='web'?'Sources are saved in this conversation for follow-up questions.':'Choose the exact on-chain token. Wrapped assets can differ from their native coin.'}</p>
      {tokens.some(t=>t.birdeye?.status==='access_denied')&&<p className="mt-2 text-[11px] text-amber-600">{birdeyeStatus.access_denied}</p>}
      {error&&<p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
      {tokens.length>0&&<div className="mt-3 max-h-60 space-y-1 overflow-y-auto">{tokens.map(token=><button key={token.network+token.address} disabled={busy||bot.busy} onClick={()=>void run({action:'snapshot',network:token.network,address:token.address,range})} className="block w-full rounded-lg border border-hairline px-3 py-2 text-left hover:bg-panel disabled:opacity-40">
        <div className="flex justify-between gap-3 text-sm"><span>{token.name} <span className="text-muted">{token.symbol} · {token.network}</span></span><span>{dollars(token.priceUsd)}</span></div>
        <div className="mt-1 truncate font-mono text-[10px] text-muted">{token.address}</div>
        {token.birdeye?.status==='ready'&&<div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted"><span>Birdeye cap {dollars(token.birdeye.marketCapUsd)}</span><span>Liquidity {dollars(token.birdeye.tokenLiquidityUsd)}</span><span>{quantity(token.birdeye.holders)} holders</span></div>}
      </button>)}</div>}
    </section>}
  </div>;
}

function BirdeyeDetails({data}:{data:BirdeyeResearch}) {
  return <section aria-label="Birdeye token fundamentals" className="mt-4 rounded-xl border border-hairline bg-panel p-3">
    <h4 className="text-xs font-medium">Birdeye token fundamentals</h4>
    {data.status==='ready'?<>
      <p className="mt-1 text-[10px] text-muted">Retrieved {utc(data.retrievedAt)} · token-wide coverage</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{[
        ['Token price',dollars(data.priceUsd)],['Token liquidity',dollars(data.tokenLiquidityUsd)],['Market cap',dollars(data.marketCapUsd)],['FDV',dollars(data.fdvUsd)],
        ['Holders',quantity(data.holders)],['Circulating supply',quantity(data.circulatingSupply)],['Total supply',quantity(data.totalSupply)],
        ['Circulating / total',data.circulatingSupply!==null&&data.totalSupply!==null&&data.totalSupply>0?(data.circulatingSupply/data.totalSupply*100).toFixed(2)+'%':'Unavailable'],
      ].map(([label,value])=><div key={label}><dt className="text-[10px] text-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
      <p className="mt-3 text-[10px] text-muted">Supply uses raw UI amounts. {data.scaledUiToken===true?`Token-2022 scaled UI token · multiplier ${quantity(data.scalingMultiplier)}. `:data.scaledUiToken===null?'Scaling metadata unavailable. ':''}Birdeye token-wide values and the chart pool can differ in coverage and retrieval time.</p>
      <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">View Birdeye token <ExternalLink size={11}/></a>
    </>:<p className="mt-2 text-[11px] text-muted">{birdeyeStatus[data.status]} Checked {utc(data.checkedAt)}. The chart and pool figures above are from {"GeckoTerminal"}.</p>}
  </section>;
}

export function CandleChart({data}:{data:MarketResearch}) {
  const [selected,setSelected]=useState<number|null>(null);
  const candles=data.candles;
  if(!candles.length)return <p>No historical candles available.</p>;
  const first=candles[0],last=candles.at(-1)!;
  const low=Math.min(...candles.map(c=>c.low)),high=Math.max(...candles.map(c=>c.high));
  const spread=Math.max(high-low,Math.abs(high)*0.002,0.00000001),floor=low-spread*0.1,ceiling=high+spread*0.1;
  const span=Math.max(last.time-first.time,data.intervalSeconds),x=(time:number)=>18+(time-first.time)/span*624,y=(price:number)=>12+(ceiling-price)/(ceiling-floor)*140;
  const width=Math.max(1,Math.min(12,data.intervalSeconds/span*624*0.65)),maxVolume=Math.max(...candles.map(c=>c.volume),1);
  const candle:Candle=candles[Math.min(selected??candles.length-1,candles.length-1)];
  return <div className="mt-3">
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted"><span>{utc(candle.time)}</span><span>O {dollars(candle.open)}</span><span>H {dollars(candle.high)}</span><span>L {dollars(candle.low)}</span><span>C {dollars(candle.close)}</span><span>Volume {dollars(candle.volume)}</span></div>
    <svg viewBox="0 0 720 208" className="mt-1 w-full touch-pan-y" role="img" aria-label={`${data.symbol} USD candlestick chart, ${data.range}`} onPointerMove={event=>{const r=event.currentTarget.getBoundingClientRect(),px=(event.clientX-r.left)/r.width*720;let best=0;for(let i=1;i<candles.length;i++)if(Math.abs(x(candles[i].time)-px)<Math.abs(x(candles[best].time)-px))best=i;setSelected(best);}} onPointerLeave={()=>setSelected(null)}>
      {[0,0.5,1].map(level=><g key={level}><line x1="12" x2="650" y1={12+level*140} y2={12+level*140} stroke="currentColor" opacity=".1"/><text x="658" y={16+level*140} fontSize="9" fill="currentColor" opacity=".6">{dollars(ceiling-(ceiling-floor)*level)}</text></g>)}
      {candles.map(c=><g key={c.time} fill={c.close>=c.open?'#10b981':'#f43f5e'} stroke={c.close>=c.open?'#10b981':'#f43f5e'}><line x1={x(c.time)} x2={x(c.time)} y1={y(c.high)} y2={y(c.low)} strokeWidth="1"/><rect x={x(c.time)-width/2} y={Math.min(y(c.open),y(c.close))} width={width} height={Math.max(1,Math.abs(y(c.close)-y(c.open)))} stroke="none"/><rect x={x(c.time)-width/2} y={198-c.volume/maxVolume*32} width={width} height={c.volume/maxVolume*32} stroke="none" opacity=".35"/></g>)}
      {selected!==null&&<line x1={x(candle.time)} x2={x(candle.time)} y1="8" y2="198" stroke="currentColor" strokeDasharray="3 3" opacity=".4"/>}
    </svg>
    <input type="range" min={0} max={candles.length-1} value={selected??candles.length-1} onChange={e=>setSelected(Number(e.target.value))} aria-label="Inspect chart candle" className="h-1 w-full accent-emerald-500"/>
    <div className="mt-2 flex justify-between text-[10px] text-muted"><span>{utc(first.time)}</span><span>{utc(last.time)}</span></div>
  </div>;
}

export function ResearchCard({data,bot}:{data:ResearchData;bot:Bot}) {
  const {dispatch}=useStore();
  return <article className="my-2 max-w-3xl rounded-2xl border border-hairline bg-raised p-4 text-ink" aria-label={data.kind==='market'?'Market research snapshot':'Web search results'}>
    <div className="mb-2 flex items-center gap-2 text-xs text-muted">{data.kind==='market'?<ChartCandlestick size={14}/>:<Search size={14}/>}<span>{data.source} · retrieved {utc(data.retrievedAt)}</span></div>
    {data.kind==='web'?<><h3 className="mb-3 text-sm font-medium">{data.query}</h3><div className="space-y-3">{data.results.map((result,index)=><div key={result.url+index}><a href={result.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-emerald-600 hover:underline">{result.title||result.url} <ExternalLink size={11} className="inline"/></a><p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted">{result.content}</p></div>)}</div>{!data.results.length&&<p className="text-xs text-muted">No sources returned.</p>}</>:<>
      <div className="flex flex-wrap justify-between gap-3"><div><h3 className="text-lg font-semibold">{data.name} <span className="text-sm text-muted">{data.symbol}</span></h3><p className="text-xs text-muted">{data.network} · {data.poolName} · {data.dex}</p></div><div className="text-right"><strong className="text-xl tabular-nums">{dollars(data.priceUsd)}</strong>{data.priceChange24hPercent!==null&&<p className={`text-xs ${data.priceChange24hPercent>=0?'text-emerald-600':'text-red-500'}`}>{data.priceChange24hPercent.toFixed(2)}% · 24h</p>}</div></div>
      <p className="mt-2 break-all font-mono text-[10px] text-muted">{data.address}</p>
      <CandleChart data={data}/>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-xs sm:grid-cols-4">{[['Pool liquidity',data.poolLiquidityUsd],['Pool volume · 24h',data.poolVolume24hUsd],['Token market cap',data.marketCapUsd],['Token FDV',data.fdvUsd]].map(([label,value])=><div key={String(label)}><dt className="text-[10px] text-muted">{label}</dt><dd className="mt-1 font-medium">{dollars(value as number|null)}</dd></div>)}</dl>
      {data.birdeye&&<BirdeyeDetails data={data.birdeye}/>}
      <p className="mt-3 text-[10px] leading-relaxed text-muted">{data.notes.join(' ')} Chart retrieved {utc(data.chartRetrievedAt)}.</p>
      <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">View source pool <ExternalLink size={11}/></a>
    </>}
    <button disabled={bot.busy} onClick={()=>dispatch({type:'send',botId:bot.id,text:`Analyze the ${data.kind==='market'?`${data.name} (${data.address}, ${data.network}) market`:`web search for "${data.query}"`} snapshot retrieved ${data.retrievedAt} above. Explain the evidence and uncertainties, cite its sources, and keep its timestamps clear.`})} className="mt-4 block rounded-lg border border-hairline px-3 py-1.5 text-xs hover:bg-panel disabled:opacity-40">Ask Clawd to analyze</button>
  </article>;
}
