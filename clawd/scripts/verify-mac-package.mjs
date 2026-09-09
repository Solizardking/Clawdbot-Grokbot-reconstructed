import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve,join,relative,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const asar=require('@electron/asar');
const app=resolve(process.argv[2]??'release/mac-arm64/Clawd Bot.app');
const architecture=process.argv[3]??'arm64';
assert.ok(['arm64','x86_64'].includes(architecture),'Expected arm64 or x86_64');
const contents=join(app,'Contents'),resources=join(contents,'Resources');
const readPlist=key=>execFileSync('/usr/libexec/PlistBuddy',['-c','Print :'+key,join(contents,'Info.plist')],{encoding:'utf8'}).trim();
assert.equal(readPlist('CFBundleIdentifier'),'com.clawdbot.app');
assert.equal(readPlist('CFBundleName'),'Clawd Bot');
const version=readPlist('CFBundleShortVersionString');
const required=[
  'app.asar','ui/index.html','server/index.js','server/proxy-paths.js',
  'companion/index.js','cua-driver','cloudflared/cloudflared',
  'Clawd Bot Speech.app/Contents/MacOS/speech-helper',
  'Clawd Bot Recorder.app/Contents/MacOS/recorder-helper',
  'licenses/Clawd Bot-LICENSE.txt','licenses/Clawd Bot-NOTICE.txt',
];
for(const file of required)assert.ok((await lstat(join(resources,file))).isFile(),`Missing resource: ${file}`);
const secretPatterns=[
  /sk-or-v1-[a-f0-9]{64}/g,
  /tvly-(?:dev|prod)-[A-Za-z0-9_-]{32,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const forbiddenName=/(?:^|\/)(?:\.env(?:\..+)?|config\.json|client\.env|credentials\.json|[^/]+\.pem)$/i;
const archive=join(resources,'app.asar');
const archiveFiles=asar.listPackage(archive).map(name=>name.replace(/^\//,'')).filter(name=>!asar.statFile(archive,name).files);
for(const file of archiveFiles){
  assert.ok(!forbiddenName.test(file),`Private configuration in app archive: ${file}`);
  const bytes=asar.extractFile(archive,file);
  for(const pattern of secretPatterns){pattern.lastIndex=0;assert.ok(!pattern.test(bytes.toString('utf8')),`Credential pattern in app archive: ${file}`);}
}
const isMachO=bytes=>bytes.length>=4&&[0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe,0xbebafeca,0xcafebabf,0xbfbafeca].includes(bytes.readUInt32BE(0));
let nativeFiles=0,scannedTextFiles=0;
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),name=relative(resources,path);
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){await walk(path);continue;}
    if(!entry.isFile())continue;
    const bytes=await readFile(path);
    if(isMachO(bytes)){
      const arches=execFileSync('/usr/bin/lipo',['-archs',path],{encoding:'utf8'}).trim().split(/\s+/);
      assert.ok(arches.includes(architecture),`Wrong native architecture: ${name} (${arches.join(', ')})`);nativeFiles++;
    }
    if(path.startsWith(resources)&&path!==archive){
      assert.ok(!forbiddenName.test(name),`Private configuration in resources: ${name}`);
      if(/\.(?:js|mjs|cjs|json|html|txt|yaml|yml|toml|env|md|css)$/.test(path)){
        for(const pattern of secretPatterns){pattern.lastIndex=0;assert.ok(!pattern.test(bytes.toString('utf8')),`Credential pattern in resources: ${name}`);}
        scannedTextFiles++;
      }
    }
  }
}
await walk(contents);
assert.ok(nativeFiles>=5,'Native runtime inspection was incomplete');
let signature='',integrity=false,notarized=false;
// codesign writes display information to stderr, so capture both separately.
const {spawnSync}=await import('node:child_process');
const info=spawnSync('/usr/bin/codesign',['-dvv',app],{encoding:'utf8'});
signature=info.stderr??'';
integrity=spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{encoding:'utf8'}).status===0;
const developerSigned=/Authority=Developer ID Application:/.test(signature)&&/TeamIdentifier=(?!not set)\S+/.test(signature);
if(developerSigned&&integrity)notarized=spawnSync('/usr/bin/xcrun',['stapler','validate',app],{encoding:'utf8'}).status===0&&spawnSync('/usr/sbin/spctl',['--assess','--type','execute',app],{encoding:'utf8'}).status===0;
const sha256=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const report={app:basename(app),version,architecture,nativeFiles,scannedTextFiles,archiveFiles:archiveFiles.length,payloadChecks:true,signatureIntegrity:integrity,developerSigned,notarized,publicReady:developerSigned&&integrity&&notarized,archiveSha256:await sha256(archive),serverSha256:await sha256(join(resources,'server/index.js'))};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--public')&&!report.publicReady)process.exitCode=1;
