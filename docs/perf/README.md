# docs/perf: real-device performance reports

These are reports from the in-page harness (`?perf=1`). The reports in this folder use schemas `lumi-earth-perf/1`
(Earth) and `lumi-himalaya-perf/1` (the older gateway ones). Since LOT 32, new reports are `/2`. A `/2` report adds
`gpu.vsyncWaitSamples`, `gpu.meanExclVsyncMs` and `gpuVsyncNote` (see below). The validators accept `/1` and `/2`.
The JSON files are kept byte-for-byte: `.gitattributes` sets `docs/perf/*.json -text`, and the reports cited by
the registry have their SHA-256 there.

| File | Device / browser | Origin | SHA-256 |
| --- | --- | --- | --- |
| 2026-11-19-earth-desktop-gtx1650-edge157.json | GTX 1650, Edge 157 | production | (see capability-registry) |
| 2026-11-19-earth-mobile-adreno740-edge157.json | Adreno 740, Edge 157 | production | (see capability-registry) |
| 2026-11-23-earth-desktop-gtx1650-edge158-run1.json | GTX 1650, Edge 158 | production (deploy-himalaya-24) | `97e9d9900866f79ef6ccf0a389bf7dffce84ff3e7f460add653dce99c4a7b49c` |
| 2026-11-23-earth-desktop-gtx1650-edge158-run2.json | GTX 1650, Edge 158 | production (deploy-himalaya-24) | `645b3f02539245c958fd058c58f8d9b5d223a73e703808aec3da9bb497d6f96a` |
| 2026-11-23-earth-desktop-gtx1650-edge158-run3.json | GTX 1650, Edge 158 | production (deploy-himalaya-24) | `00d8b1c749ddee44be9c761bf212f8c9bec41b3bae38339889634cee2093e1e8` |

The three 2026-11-23 reports reached the repository as text pasted into the chat, not as the downloaded files.
They pass `validateEarthPerfReport` (0 errors, embedded `validation: []`), but they may not be byte-identical
to the original downloads. The SHA-256 values above are those of the files as committed.

## 2026-11-23 (LOT 32): a measurement artefact, not a regression

These runs are not in the registry. `OBSERVATORY_MEASURED` still cites the 2026-11-19 reports.

GPU mean (ms), GTX 1650, production:

| Run | A | B | C | D | D max frame |
| --- | --- | --- | --- | --- | --- |
| 2026-11-19 (Edge 157) | 3.45 | 3.78 | 3.60 | 3.80 | 17 ms |
| 2026-11-23 run 1 | 6.51 (p50 7.07) | 3.28 | 5.36 (p50 5.25) | 6.25 (p50 5.93) | 233 ms |
| 2026-11-23 run 2 | 3.71 (p50 3.65) | 3.47 | 5.99 (p50 5.99) | 6.24 (p50 5.99) | 250 ms |
| 2026-11-23 run 3 | 4.20 (p50 3.64) | 3.46 | 5.95 (p50 5.95) | 5.86 (p50 5.47) | 233 ms |

**Conclusion: a measurement artefact of the GPU timer, not a regression.**
- In the local bisect, the p50 is unchanged across 49eea0f (before Lot 30), 6a344f9 (after Lot 30) and eb653b1 (after Lot 31).
- The high values come from two kinds of `TIME_ELAPSED` samples. Both occur in every version, at an unchanged GPU clock.
- In the production runs above, even the C/D p50 is high (5.3 to 6.0 ms): a whole scenario was in the "about 7 ms
  at the same clock" state described below. Locally the same state covered a whole scenario in some runs of every
  version (A in a1, a3 and c2), so it is not tied to the code.
- The one real cost, the 233 to 250 ms frame in D, was the Moon's first render. 0b4172f fixed it.

All measurements below are local: GTX 1650, Chrome 158, windowed (`headless: false`), the same synthetic network for
every version. The scripts are in `tmp/lot32/`, which is not versioned.

### Bisect: alternating runs in one session, three each

GPU mean / p50 (ms), and the longest frame of D (ms):

| Run | Commit | A | C | D | D max |
| --- | --- | --- | --- | --- | --- |
| a1 | 49eea0f | 6.38 / **7.00** | 4.64 / 3.62 | 4.71 / 3.63 | 183.5 |
| b1 | 6a344f9 | 4.43 / 3.67 | 4.52 / 3.68 | 4.87 / 3.66 | 266.7 |
| c1 | eb653b1 | 5.09 / 3.59 | 4.55 / 3.64 | 5.33 / 3.67 | 350.3 |
| a2 | 49eea0f | 5.06 / 3.63 | 4.29 / 3.57 | 4.72 / 3.63 | 183.3 |
| b2 | 6a344f9 | 4.23 / 3.66 | 3.60 / 3.57 | 4.14 / 3.77 | 300.0 |
| c2 | eb653b1 | 4.11 / 3.71 | 4.05 / 3.65 | 4.15 / 3.74 | 316.7 |
| a3 | 49eea0f | 5.86 / **6.60** | 3.79 / 3.19 | 4.24 / 3.71 | 300.1 |
| b3 | 6a344f9 | 5.37 / 3.80 | 4.55 / 3.60 | 5.09 / 3.68 | 300.1 |
| c3 | eb653b1 | 5.03 / 3.67 | 5.04 / 3.60 | 5.50 / 3.50 | 383.4 |

- The p50 of C and D is 3.2 to 3.8 ms in all nine runs, whatever the version.
- The "high" A (p50 6.6 to 7.0) appeared in a1 and a3, the version from before Lot 30.

### GPU clocks against the timer samples

We sampled `nvidia-smi` (pstate, clocks.sm, clocks.mem, utilisation, power) every 100 ms and logged every GPU timer
sample, both against the same clock as the scenario phases. The table covers six runs, c1 to c3 and the fixed
version d1 to d3: 13,904 samples inside the measurement windows.

| Timer samples | Count | GPU median | SM clock median | Memory clock | pstate |
| --- | --- | --- | --- | --- | --- |
| < 5 ms | 12,510 | 3.57 ms | 1005 MHz | 4001 MHz | P0 |
| 5 to 12 ms | 565 | 7.13 ms | 915 MHz | 4001 MHz | P0 |
| > 12 ms | 829 | 16.33 ms | 975 MHz | 4001 MHz | P0 |

Two kinds of samples raise the mean:

- **About 16.3 ms: vsync waits.** These are one 60 Hz interval. They make up 5 to 18 % of the samples in A, C and D
  and never occur in B. At those moments the SM clock is the same as for the normal frames. The query spans the wait
  for the display, not GPU work. These samples lift the mean, not the p50.
- **About 7.1 ms: at the same clock.** Almost all of them come from one scenario per run, for example A in c2:
  305 samples at 7.14 ms and 263 at 3.75 ms, both at an SM clock of 915 MHz.
  - The time doubles with no change of SM clock, memory clock or pstate.
  - The cause is not identified. It is not a lower frequency, and it is not code: it appears in every version.

The GPU clock does vary (915 to 1905 MHz), but it does not explain the high state. When the clock rose (c1, about
1600 MHz in C), the p50 fell to 2.8 ms, the opposite direction.

### What changed after LOT 32

- **0b4172f**: the D stall is fixed. The Moon textures are decoded off the main thread, then uploaded and compiled
  at idle, before the Moon is in view. Longest frame of D, three runs each:
  - before: 383.3, 266.6 and 266.6 ms;
  - after: 16.9, 16.9 and 17.0 ms.
  
  The pixel diff is 0 on the 8 Lot 30/31 frames.
- **7986199**: the warm-up runs only with `deviceMemory` >= 4 GB. If `deviceMemory` is not reported, it runs only in
  the desktop layout.
- **3b19a58**: reports are `/2`.
  - `gpu.vsyncWaitSamples` counts the samples >= 0.9 × the detected refresh interval.
  - `gpu.meanExclVsyncMs` is the mean without them. `gpuVsyncNote` explains both fields.
  - The panel shows the GPU p50; the mean stays in the JSON.
  - Example, local `/2` run on eb653b1 + the LOT 32 fixes, scenario A: mean 4.36 ms, p50 3.68 ms,
    `vsyncWaitSamples` 24 of 600, `meanExclVsyncMs` 3.80 ms.
  - The 2026-11-23 reports above are `/1`: they hold no per-sample data, so these fields cannot be computed for them.

### Methodology

- Compare the GPU p50, not the mean.
- Run each build at least three times, alternating builds in one session.
- In `/2` reports, read `meanExclVsyncMs` next to the mean.
- Cross-check suspicious GPU-time jumps against `nvidia-smi` clocks (`clocks.sm`, `clocks.mem`, `pstate`).
- The C/D geometry (410522 triangles, 39 draw calls, against 363090 for A) is the same on 2026-11-19 and
  2026-11-23, so it is not new.
