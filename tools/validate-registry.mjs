import { platformRegistry } from '../src/core/platform-registry.js';

// Importing platformRegistry executes the repository's existing contract
// validation. Keep one implementation of those rules.
const report = platformRegistry.moduleContract;
console.log(JSON.stringify({
  valid: report.valid,
  modules: platformRegistry.observatories.length,
  errors: report.errors,
  warnings: report.warnings,
}, null, 2));
process.exitCode = report.valid ? 0 : 1;
