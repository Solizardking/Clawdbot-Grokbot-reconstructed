import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const [rawOrigin, clientFile, mode = 'audio'] = process.argv.slice(2);
if (!['audio','image'].includes(mode)) throw new Error('Use audio or image smoke mode');
const origin = new URL(rawOrigin);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Use an HTTPS gateway origin');
const token = /^SAND_HOSTED_GATEWAY_TOKEN=([A-Za-z0-9_-]{32,128})$/m.exec(await readFile(clientFile,'utf8'))?.[1];
if (!token) throw new Error('Client file lacks gateway token');
const temporary = await mkdtemp(join(tmpdir(),'hosted-media-smoke-'));
process.env.SAND_HOSTED_GATEWAY_URL=origin.origin;
process.env.SAND_HOSTED_GATEWAY_TOKEN=token;
process.env.SAND_DATA_ROOT=temporary;
process.env.OPENROUTER_VOICE='deepgram/flux-tts:free';
process.env.OPENROUTER_GROK_IMAGINE='x-ai/grok-imagine-image-2.0';
process.env.OPENROUTER_GROK_STT='x-ai/grok-stt-1.0';
delete process.env.OPENROUTER_API_KEY;
let stage='loading';
try {
  const output=join(temporary,'media.cjs');
  await build({entryPoints:['source/node-agent-coordinator/grok-media-tools.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const bridge=createRequire(import.meta.url)(output);
  if (mode==='audio') {
    stage='speech synthesis';
    const speech=await bridge.executeGrokMediaRoutedTool('grok_speak',{text:'The gateway is ready.',format:'mp3'});
    const bytes=await readFile(speech.file.path);
    if (bytes.length<100 || !(bytes.subarray(0,3).toString()==='ID3' || (bytes[0]===255 && (bytes[1]&224)===224))) throw new Error('Invalid MP3');
    stage='transcription';
    const transcript=await bridge.executeGrokMediaRoutedTool('grok_transcribe',{path:speech.file.path,language:'en'});
    if (!/gateway.*ready/i.test(transcript.text)) throw new Error('Transcript did not match the generated phrase');
    console.log('PASS: actual desktop media tools synthesized a valid MP3 and transcribed the expected phrase through Fly using only the user token.');
  } else {
    stage='image generation';
    const image=await bridge.executeGrokMediaRoutedTool('grok_imagine',{prompt:'A single blue circle centered on a plain white background.',resolution:'1K',quality:'low',aspect_ratio:'1:1'});
    const bytes=await readFile(image.files[0].path);
    const valid=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a' || bytes.subarray(0,3).toString('hex')==='ffd8ff' || (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP');
    if (bytes.length<100 || !valid) throw new Error('Invalid image output');
    console.log('PASS: actual desktop image tool generated and saved a valid image through Fly using only the user token.');
  }
} catch(error) {
  console.error(`Hosted media smoke failed at ${stage}: ${String(error?.message ?? 'unknown error').slice(0,300)}`);
  process.exitCode=1;
} finally { await rm(temporary,{recursive:true,force:true}); }
