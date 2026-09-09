import { spawnSync } from 'node:child_process';
// A specific server-to-server transfer. Never persist or print the operator key.
const current = spawnSync('fly', ['ssh','console','--app','solgpt-pumpfun-mcp','--command','printenv MCP_HTTP_AUTH_TOKEN'], {encoding:'utf8',stdio:['ignore','pipe','pipe']});
if(current.status!==0)throw new Error('Cannot read the existing Pump service credential');
const token=current.stdout.trim();
if(!token||token.length>4096||/[\r\n\x00]/.test(token))throw new Error('Invalid service credential');
const imported=spawnSync('fly',['secrets','import','--stage','--app','grok-provider-gateway-8bit'], {input:`PUMP_MCP_TOKEN=${token}\n`,encoding:'utf8',stdio:['pipe','pipe','pipe']});
if(imported.status!==0)throw new Error('Cannot stage Pump service access');
console.log('Pump service access staged on Fly; no credential printed or saved locally.');
