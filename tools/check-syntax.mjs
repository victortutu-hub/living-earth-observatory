import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Include pending, non-ignored code as well as tracked code so the gate works
// before staging. Git's ignore rules exclude generated/cache directories.
const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'tests', 'tools', 'nasa-proxy-server.js', 'sw.js'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (listing.error || listing.status !== 0) {
  console.error(`Cannot enumerate repository code: ${listing.error?.message || listing.stderr.trim()}`);
  process.exit(1);
}

const files = [...new Set(listing.stdout.split('\0').filter(file =>
  /^(?:src|tests)\/.*\.js$/.test(file)
  || /^tools\/.*\.mjs$/.test(file)
  || file === 'nasa-proxy-server.js'
  || file === 'sw.js'
))].sort();

if (!files.length) {
  console.error('No repository code found to syntax-check.');
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  // --check parses only: checking this script does not execute it recursively.
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    failed += 1;
    console.error(`${file}: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`);
  }
}
console.log(`syntax checked=${files.length} failed=${failed}`);
process.exitCode = failed ? 1 : 0;
