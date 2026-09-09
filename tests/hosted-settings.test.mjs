import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('host model synchronization persists a selection and can reset to the default without resetting unrelated fields', async t => {
  const dir=await mkdtemp(join(tmpdir(),'host-settings-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const outfile=join(dir,'settings.mjs');
  await build({stdin:{contents:'export {SettingsService} from "./source/host/extensions/settings/settings-service.ts"; export {SAND_DEFAULT_OPENROUTER_MODEL} from "./source/shared/inference-router.ts";',resolveDir:process.cwd()},outfile,bundle:true,platform:'node',format:'esm'});
  const {SettingsService,SAND_DEFAULT_OPENROUTER_MODEL}=await import(pathToFileURL(outfile));
  const file=join(dir,'settings.json'),service=new SettingsService(file);
  service.setHostSettings({inferenceProvider:'openrouter',inferenceRouterModel:'openrouter/free',pinnedAgentIds:['owner-bot']});
  const loaded=new SettingsService(file);
  assert.equal(loaded.store.getInferenceRouterModel(),'openrouter/free');
  let notificationWrites=0;
  loaded.store.setNotificationConfig=()=>{notificationWrites++};
  loaded.setHostSettings({inferenceRouterModel:SAND_DEFAULT_OPENROUTER_MODEL});
  assert.equal(notificationWrites,0);
  const reset=new SettingsService(file);
  assert.equal(reset.store.getInferenceRouterModel(),SAND_DEFAULT_OPENROUTER_MODEL);
  assert.equal(reset.store.load().inferenceRouterModel,undefined);
  assert.deepEqual(reset.store.getPinnedAgentIds(),['owner-bot']);
});
