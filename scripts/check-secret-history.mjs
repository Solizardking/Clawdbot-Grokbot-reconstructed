import { execFileSync } from 'node:child_process';
import { isPrivatePath } from './lib/secret-audit.mjs';
// Check every reachable local commit. Deleting a credential in the tip commit
// does not remove it from the history a push would transfer.
const output = execFileSync('git', ['log', '--all', '--format=', '--name-only', '--diff-filter=AM'], {maxBuffer:64*1024*1024}).toString();
const paths = [...new Set(output.split('\n').filter(file => file && isPrivatePath(file)))];
if (paths.length) {
  console.error('Push blocked: private configuration remains in reachable Git history:');
  for (const file of paths) console.error(`  ${file}`);
  console.error('Rotate affected credentials and clean the history before publishing. No values were printed.');
  process.exitCode=1;
} else console.log('No private configuration filenames found in reachable Git history.');
