import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageInfrastructure,validateInfrastructure} from '../scripts/import-clawd-infrastructure.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'clawd-private-import-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return {directory,file:join(directory,'runtime.env')};
}
test('partial updates preserve existing private settings and send only changes to Fly',async t=>{
  const {directory,file}=await fixture(t);
  await writeFile(file,'NVIDIA_API_KEY=old-nvidia\nSOLANA_TRACKER_ACCESS_KEY=keep-tracker\n',{mode:0o644});
  let staged;
  await stageInfrastructure({NVIDIA_API_KEY:'new-nvidia'},{directory,stage:text=>{staged=text;}});
  assert.equal(staged,'NVIDIA_API_KEY=new-nvidia\n');
  assert.equal(await readFile(file,'utf8'),'NVIDIA_API_KEY=new-nvidia\nSOLANA_TRACKER_ACCESS_KEY=keep-tracker\n');
  assert.equal((await stat(file)).mode&0o777,0o600);
  assert.equal((await stat(directory)).mode&0o777,0o700);
  assert.deepEqual(await readdir(directory),['runtime.env']);
});
test('failed staging preserves the old copy and cleans its temporary file and lock',async t=>{
  const {directory,file}=await fixture(t);
  await writeFile(file,'NVIDIA_API_KEY=old\n');
  await assert.rejects(stageInfrastructure({NVIDIA_API_KEY:'new'},{directory,stage:()=>{throw new Error('offline');}}),/offline/);
  assert.equal(await readFile(file,'utf8'),'NVIDIA_API_KEY=old\n');
  assert.deepEqual(await readdir(directory),['runtime.env']);
});
test('rejects unexpected settings, injected lines, malformed files and concurrent imports',async t=>{
  const {directory,file}=await fixture(t);
  for(const values of [[],null,{},'secret-input',{FOREIGN_KEY:'secret-input'},{NVIDIA_API_KEY:'secret-input\nEXTRA=x'}]) {
    assert.throws(()=>validateInfrastructure(values),error=>!error.message.includes('secret-input'));
  }
  await writeFile(file,'NVIDIA_API_KEY=first\nNVIDIA_API_KEY=secret-input\n');
  await assert.rejects(stageInfrastructure({NVIDIA_API_KEY:'new'},{directory,stage:()=>assert.fail('must not stage')}),error=>!error.message.includes('secret-input'));
  await writeFile(join(directory,'.import.lock'),'');
  await assert.rejects(stageInfrastructure({NVIDIA_API_KEY:'new'},{directory,stage:()=>assert.fail('must not stage')}),/locked/);
});
test('does not follow a symlink in place of the credential file',async t=>{
  const {directory,file}=await fixture(t);
  const other=join(directory,'other');await writeFile(other,'NVIDIA_API_KEY=old\n');await symlink(other,file);
  await assert.rejects(stageInfrastructure({NVIDIA_API_KEY:'new'},{directory,stage:()=>assert.fail('must not stage')}),/regular file/);
  assert.equal(await readFile(other,'utf8'),'NVIDIA_API_KEY=old\n');
});
