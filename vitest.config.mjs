import { configDefaults, defineConfig } from 'vitest/config';

// LOT 39: the heavy files run one at a time, AFTER the rest of the suite (two projects, sequence.groupOrder).
// Measured (tmp/lot39): himalaya-lot26 spawns tools/build-himalaya-glaciers.mjs --check for ~21 s of CPU outside the
// worker pool, while the GLO-30 / KTX2 / repository-scan files read or decode tens of MB. Run in parallel with the
// rest (7 workers on 8 cores) and with any other load, these tests (50-500 ms alone) hit the 5 s timeout. Serial and
// alone, they do the same work and check the same things; no timeout is raised.
const HEAVY = [
  'tests/himalaya-lot26.test.js', // child process: the glacier asset rebuilt and compared (~21 s)
  'tests/himalaya-lot2.test.js', // 14 GLO-30 patches: sha256 of every file, KTX2 metadata decoded
  'tests/himalaya-lot5.test.js', // patch walls measured on the 14 decoded patches
  'tests/himalaya-lot7.test.js', // patch keys, hashes and files
  'tests/relief-linear.test.js', // 2160x1080 R16F KTX2 decoded and compared to the .bin fallback
  'tests/lib-vendor.test.js', // lib/ hashed, the npm tarballs re-read, the earcut wrapper imported
  'tests/check-origins.test.js', // every page / src / styles file scanned
  'tests/usgs-single-path.test.js', // every src file scanned
];

export default defineConfig({
  test: {
    env: {
      // nasa-proxy-server.js starts listening on load (LiteSpeed/Passenger load
      // it via require()); tests import it as a library and must not open a port.
      NASA_PROXY_NO_LISTEN: '1',
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.js'], exclude: [...configDefaults.exclude, ...HEAVY], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'heavy', include: HEAVY, fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
});
