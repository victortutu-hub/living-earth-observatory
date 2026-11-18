import fs from 'node:fs';
import crypto from 'node:crypto';
import { platformRegistry } from '../src/core/platform-registry.js';

// Importing platformRegistry executes the repository's existing contract
// validation. Keep one implementation of those rules.
const report = platformRegistry.moduleContract;

// LOT 20: every measured run names a report in docs/perf/; its SHA-256 must match the file
// (the browser-side contract cannot read files, so the hash is checked here).
const measuredErrors = [];
const measured = [];
for (const observatory of platformRegistry.observatories) {
  for (const run of platformRegistry.getMeasured(observatory.id)) {
    const url = new URL(`../${run.file}`, import.meta.url);
    if (!fs.existsSync(url)) { measuredErrors.push({ level: 'error', code: 'measured-report-missing', message: `${observatory.id}: ${run.file} not found.` }); continue; }
    const sha = crypto.createHash('sha256').update(fs.readFileSync(url)).digest('hex');
    if (sha !== run.sha256) measuredErrors.push({ level: 'error', code: 'measured-report-hash', message: `${observatory.id}: ${run.file} SHA-256 ${sha} != registry ${run.sha256}.` });
    measured.push({ observatory: observatory.id, file: run.file, sha256: sha === run.sha256 ? 'ok' : 'MISMATCH' });
  }
}

const valid = report.valid && measuredErrors.length === 0;
console.log(JSON.stringify({
  valid,
  modules: platformRegistry.observatories.length,
  errors: [...report.errors, ...measuredErrors],
  warnings: report.warnings,
  measuredReports: measured,
}, null, 2));
process.exitCode = valid ? 0 : 1;
