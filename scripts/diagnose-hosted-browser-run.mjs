import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const state = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!/^[A-Za-z0-9_-]{1,128}$/.test(state.id)) throw new Error('Invalid run id');
const code = `fetch("https://api.browser-use.com/api/v4/runs/${state.id}",{headers:{"x-browser-use-api-key":process.env.BROWSER_USE_API_KEY}}).then(async r=>{const p=await r.json();console.log(JSON.stringify({http:r.status,keys:Object.keys(p),idMatches:p.id===${JSON.stringify(state.id)},status:p.status,errorType:typeof p.error,errorPresent:Boolean(p.error),budgetError:/budget|cost|limit/i.test(p.error||""),creditError:/credit|balance|payment/i.test(p.error||""),modelError:/model|provider/i.test(p.error||""),timeoutError:/time.?out/i.test(p.error||""),errorLength:p.error?.length,errorClasses:(p.error||"").match(/[A-Za-z_]+(?:Error|Exception)/g),httpCodes:(p.error||"").match(/(?:400|401|402|403|404|409|422|429|500|502|503|504)/g),sandboxError:/sandbox|browser|connect|chrom|runner|internal|health/i.test(p.error||""),totalCostUsd:p.totalCostUsd,nestedRunKeys:p.run?Object.keys(p.run):[],sessionIdType:typeof p.sessionId,workspaceIdType:typeof p.workspaceId}))})`;
const result = spawnSync('fly', ['ssh', 'console', '-a', 'grok-provider-gateway-8bit', '-C', `node -e '${code}'`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
if (result.status !== 0) throw new Error('Structural diagnostic failed; raw output suppressed');
// Only emit a parsed structural diagnostic, never provider output or keys.
const parsed = JSON.parse(result.stdout.trim());
console.log(JSON.stringify(parsed));
