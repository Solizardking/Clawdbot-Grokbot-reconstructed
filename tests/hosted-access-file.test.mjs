import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHostedAccessFile } from '../scripts/lib/hosted-access-file.mjs';

test('access-file import reads only hosted settings and never evaluates shell expressions',()=>{
  const token='a'.repeat(43);
  const input=`# client access\nSAND_HOSTED_GATEWAY_URL=https://gateway.example/\nSAND_HOSTED_GATEWAY_TOKEN=${token}\nOPENROUTER_MODEL=openrouter/free\nOPENROUTER_API_KEY=operator-key-not-imported\n`;
  assert.deepEqual(parseHostedAccessFile(input),{url:'https://gateway.example',token,model:'openrouter/free'});
  assert.throws(()=>parseHostedAccessFile(input+'SAND_HOSTED_GATEWAY_TOKEN=duplicate'));
  for(const url of ['http://gateway.example','https://user:secret@gateway.example','https://gateway.example/path','https://gateway.example/?token=secret']) assert.throws(()=>parseHostedAccessFile(input.replace('https://gateway.example/',url)));
  assert.throws(()=>parseHostedAccessFile(input.replace(token,'$(cat private-key)')));
  assert.throws(()=>parseHostedAccessFile('x'.repeat(16385)));
  assert.throws(()=>parseHostedAccessFile(input.replace('openrouter/free','`command`')));
});
