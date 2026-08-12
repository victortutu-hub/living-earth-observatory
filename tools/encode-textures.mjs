#!/usr/bin/env node

/**
 * Reproducible KTX2 encoder for the Living Earth relief textures.
 *
 * Requirements:
 *   - KTX-Software on PATH (`toktx --version`)
 *
 * Usage:
 *   node tools/encode-textures.mjs --check
 *   $env:TOKTX_PATH = (Get-Command toktx).Source
 *   node tools/encode-textures.mjs --check
 *   node tools/encode-textures.mjs --force
 *   node tools/encode-textures.mjs --only normal --force
 *
 * The source maps are linear data, not colour albedo. UASTC preserves the
 * precision needed by the displacement map and tangent-space normal map.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const assetsDir = resolve(projectRoot, 'assets');
const args = new Set(process.argv.slice(2));
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
// TOKTX_PATH is an explicit escape hatch for Windows shells whose PATH is not
// inherited by Node (for example immediately after an installer updates PATH).
const toktxCommand = process.env.TOKTX_PATH || (process.platform === 'win32' ? 'toktx.exe' : 'toktx');

const targets = [
    {
        key: 'relief',
        input: resolve(assetsDir, 'etopo2022-bedrock-relief-2160x1080.png'),
        output: resolve(assetsDir, 'etopo2022-bedrock-relief-2160x1080.ktx2'),
        options: ['--t2', '--encode', 'uastc', '--uastc_quality', '3', '--genmipmap', '--zcmp', '18'],
    },
    {
        key: 'normal',
        input: resolve(assetsDir, 'etopo2022-bedrock-normal-2160x1080.png'),
        output: resolve(assetsDir, 'etopo2022-bedrock-normal-2160x1080.ktx2'),
        options: ['--t2', '--encode', 'uastc', '--uastc_quality', '3', '--normal_mode', '--genmipmap', '--zcmp', '18'],
    },
];

function usage(exitCode = 0) {
    console.log(`Usage: node tools/encode-textures.mjs [--check] [--only relief|normal] [--force]

  --check  Verify that toktx and all PNG sources are available; write nothing.
  --only   Encode one target instead of both.
  --force  Permit replacing an existing .ktx2 asset.`);
    process.exit(exitCode);
}

if (args.has('--help') || args.has('-h')) usage();
if (only && !targets.some((target) => target.key === only)) {
    console.error(`Unknown target: ${only}. Use relief or normal.`);
    usage(1);
}

const version = spawnSync(toktxCommand, ['--version'], { encoding: 'utf8' });
if (version.error || version.status !== 0) {
    console.error(`Unable to run ${toktxCommand}: ${version.error?.message ?? `exit code ${version.status}`}.`);
    console.error('Set TOKTX_PATH to the executable path, e.g. `$env:TOKTX_PATH = (Get-Command toktx).Source`.');
    process.exit(1);
}
console.log(version.stdout.trim());

const selectedTargets = only ? targets.filter((target) => target.key === only) : targets;
for (const target of selectedTargets) {
    if (!existsSync(target.input)) {
        console.error(`Missing input PNG: ${target.input}`);
        process.exit(1);
    }
    if (!args.has('--force') && existsSync(target.output) && !args.has('--check')) {
        console.error(`Refusing to overwrite ${target.output}. Re-run with --force after reviewing the output.`);
        process.exit(1);
    }
}

if (args.has('--check')) {
    console.log(`Ready to encode: ${selectedTargets.map((target) => target.key).join(', ')}`);
    process.exit(0);
}

for (const target of selectedTargets) {
    console.log(`Encoding ${target.key}: ${target.input} -> ${target.output}`);
    const result = spawnSync(toktxCommand, [...target.options, target.output, target.input], { stdio: 'inherit' });
    if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}

console.log('KTX2 encoding completed. Validate the application and re-run the Spector comparison before publishing.');
