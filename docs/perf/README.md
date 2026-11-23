# docs/perf: real-device performance reports

These are reports from the in-page harness (`?perf=1`). Earth reports use schema `lumi-earth-perf/1`; the
older reports are the gateway ones. The JSON files are kept byte-for-byte: `.gitattributes` sets
`docs/perf/*.json -text`, and the reports cited by the registry have their SHA-256 there.

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

## 2026-11-23 (LOT 32): A variation in run 1, and the C/D "regression" under investigation

These runs are not yet in the registry. `OBSERVATORY_MEASURED` still cites the 2026-11-19 reports.

GPU mean (ms), GTX 1650:

| Run | A | B | C | D | D max frame |
| --- | --- | --- | --- | --- | --- |
| 2026-11-19 (Edge 157) | 3.45 | 3.78 | 3.60 | 3.80 | 17 ms |
| 2026-11-23 run 1 | 6.51 (p50 7.07) | 3.28 | 5.36 | 6.25 | 233 ms |
| 2026-11-23 run 2 | 3.71 (p50 3.65) | 3.47 | 5.99 | 6.24 | 250 ms |
| 2026-11-23 run 3 | 4.20 (p50 3.64) | 3.46 | 5.95 | 5.86 | 233 ms |

Findings so far (local measurements, windowed browser, real GPU; the scripts are in `tmp/lot32/`, which is not versioned):

- **A in run 1 is a timer state, not extra work.** The `TIME_ELAPSED` GPU timer is bimodal on this machine: about
  3.6 ms in one state and about 5.3 to 6.9 ms in the other, for the same scene. The state can change between
  page loads.
  - We cross-checked with `nvidia-smi` sampling: a "high" run (C 6.6 ms) and a "low" run (C 3.6 ms) had the same
    clock (900 to 1000 MHz), utilization (37 to 39 %) and board power (15 to 16 W).
  - So the C and D means of 5.4 to 6.0 ms are most likely the same state, not more rendering.
- **Local bisect.** Three commits were measured, three runs each, scenarios A, C and D, in Chrome 158 and Edge 158:
  - 49eea0f, before Lot 30;
  - 6a344f9, after Lot 30;
  - eb653b1, after Lot 31.
  - The p50 GPU times are equal across the three: C ≈ 3.60 ms, D ≈ 3.64 to 3.69 ms.
  - Per-component costs on top of that: Lot 30's local cloud texture adds about 0.05 to 0.06 ms; night lights
    cost 0.06 to 0.10 ms; specular costs ≤ 0.02 ms.
  - None of these explains a gap of 2 to 2.5 ms.
- **The D stall (233 to 250 ms) is the Moon's first render.** In D's orbit the Moon enters the frustum at about
  1.8 s. That first frame pays for:
  - decoding three JPEGs (about 70, 54 and 6.5 ms: Moon colour 4K, Moon normal 4K, LDEM 1K);
  - the Moon shader program (`GetProgramiv`, about 46 ms).
  
  This depends on the date. On 2026-11-19 (13:16 UTC) scenario B's orbit already showed the Moon, so the cost was
  paid before D. On 2026-11-23 B never shows the Moon, so D pays it.
- **The C/D geometry was already there before.** C and D render 410522 triangles and 39 draw calls, against
  363090 for A on 2026-11-23. The 2026-11-19 report has the same C/D numbers (410522 / 39), so this is not new.

Status: no code regression has been identified. A repair proposal for the D stall is pending approval:
decode the Moon textures off-thread with `createImageBitmap`, then upload them and compile the shader at idle,
before the Moon becomes visible. Methodology for future comparisons:

- compare p50, not the mean;
- use at least three runs per build;
- cross-check suspicious GPU-time jumps with `nvidia-smi`.
