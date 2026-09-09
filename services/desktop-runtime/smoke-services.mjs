import { readFile } from 'node:fs/promises';
import { parseHostedAccessFile } from '../../scripts/lib/hosted-access-file.mjs';

const [file] = process.argv.slice(2);
const access = parseHostedAccessFile(await readFile(file,'utf8'));
const headers = {authorization:`Bearer ${access.token}`,'content-type':'application/json'};
async function call(path, body) {
  const response = await fetch(access.url + path,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`Hosted service ${path} failed: HTTP ${response.status}`);
  return response.json();
}
const response = await fetch(access.url + '/v1/account',{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
if (!response.ok) throw new Error('Account discovery failed');
const account = await response.json();
const tools = await call('/api/listRoutedMcpTools',{});
if (!Array.isArray(tools)) throw new Error('Invalid native MCP listing');
const names = tools.filter(tool=>tool.providerIdentifier==='hosted-services').map(tool=>tool.toolName);
if (!names.includes('hosted_services_status')) throw new Error('Native hosted tools are missing');
for (const [service,name] of Object.entries({helius:'helius_read',birdeye:'birdeye_token_price',e2b:'e2b_computer_status',browseruse:'browseruse_run_task',media:'grok_speak'})) {
  if (names.includes(name) !== account.services.includes(service)) throw new Error(`Native ${service} discovery does not match the user grant`);
}
const result = await call('/api/executeRoutedMcpTool',{providerIdentifier:'hosted-services',name:'hosted_services_status',toolName:'hosted_services_status',args:{},toolCallId:'hosted-status-smoke'});
const success = result.result?.case === 'success' ? result.result.value : result.success;
const content = success?.content;
const text = content?.map(item=>item.content?.case==='text'?item.content.value.text:item.text?.text).find(value=>typeof value==='string');
if (!text) throw new Error('Native MCP status did not return text');
const status = JSON.parse(text);
if (JSON.stringify([...status.services].sort()) !== JSON.stringify([...account.services].sort())) throw new Error('Native MCP status returned the wrong grants');
if (JSON.stringify(result).includes(access.token)) throw new Error('Native MCP result exposed user access');
console.log(`PASS: ${names.length} native hosted tools match the user grants; status executes through the private runtime without provider requests.`);
