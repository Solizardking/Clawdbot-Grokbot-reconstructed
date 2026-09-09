import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

test('production conversation coordinator connects with saved hosted access without consulting Cursor', async t => {
  const dir=await mkdtemp(join(tmpdir(),'hosted-coordinator-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outfile=join(dir,'binding.cjs');
  await build({entryPoints:['source/electron-main/adapters/coordinator-gateway.ts'],bundle:true,platform:'node',format:'cjs',outfile,logLevel:'silent',external:['electron'],define:{'import.meta.url':'__moduleUrl'},banner:{js:'const __moduleUrl = require("node:url").pathToFileURL(__filename).href;'}});
  const {createProductionCoordinatorGatewayBinding}=createRequire(import.meta.url)(outfile);
  const token='h'.repeat(43);
  let authReads=0,status=200;
  const prior=globalThis.fetch;
  t.after(()=>{globalThis.fetch=prior;});
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://gateway.example/v1/runtime');
    assert.equal(init.headers.authorization,`Bearer ${token}`);
    return Response.json({transport:'gateway'},{status});
  };
  const context={
    requireAccount:()=>({getAuthService:async()=>{authReads++;throw new Error('Cursor must not be consulted');}}),
    requireUpdate:()=>({noteBackendUpdateRequirement:()=>{}}),
    accountLifecycle:{getAccountScope:()=> 'test-owner'},
    machineId:'test-machine',env:{},
    native:{app:{getPath:()=>dir},safeStorage:{isEncryptionAvailable:()=>false}},
    settings:{settingsStore:{}},
    connectorEgress:{wrap:value=>value},
    secretsStores:{userSecretsStore:{reveal:async key=>key==='SAND_HOSTED_GATEWAY_URL'?'https://gateway.example':key==='SAND_HOSTED_GATEWAY_TOKEN'?token:null}},
  };
  const connector=createProductionCoordinatorGatewayBinding().createGatewayConnector(context);
  assert.deepEqual(await connector.connect(),{baseUrl:'https://gateway.example',token,headers:{authorization:`Bearer ${token}`}});
  assert.equal(await connector.issueLocalExecDaemonCredential(),undefined);
  status=404;
  await assert.rejects(connector.connect(),/not been provisioned/);
  assert.equal(authReads,0);
});
