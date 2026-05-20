# Ablation Report — Split Tools / TOON Output

Generated: 2026-05-10T11:32:58.357Z

Each cell: HDX-only, n=see below; metric is the HyperDX MCP arm.

## Top-line — Combined Score

| Scenario | Baseline | Split | TOON | Both | Δ split | Δ toon | Δ both |
|---|---:|---:|---:|---:|---:|---:|---:|
| error-root-cause | 97% (n=2) | 98% (n=2) | 100% (n=2) | 97% (n=2) | +1pp | +3pp | +0pp |
| latency-spike | 38% (n=2) | 58% (n=2) | 33% (n=2) | 62% (n=2) | +21pp | -5pp | +24pp |
| noisy-signals | 82% (n=2) | 90% (n=1) | 82% (n=2) | 78% (n=2) | +7pp | -1pp | -5pp |

## error-root-cause

| Metric | Baseline | Split | TOON | Both |
|---|---:|---:|---:|---:|
| Combined score | 97% | 98% | 100% | 97% |
| Programmatic score | 100% | 100% | 100% | 100% |
| Judge weighted | 95% | 96% | 100% | 95% |
| Tool calls (mean) | 18.0 | 18.5 | 26.0 | 25.0 |
| Output tokens (mean) | 8943 | 7748 | 6879 | 9177 |
| Wall clock s (mean) | 158.8 | 141.6 | 152.2 | 209.3 |
| N runs | 2 | 2 | 2 | 2 |

## latency-spike

| Metric | Baseline | Split | TOON | Both |
|---|---:|---:|---:|---:|
| Combined score | 38% | 58% | 33% | 62% |
| Programmatic score | 70% | 80% | 63% | 77% |
| Judge weighted | 16% | 44% | 13% | 53% |
| Tool calls (mean) | 14.0 | 17.0 | 16.0 | 14.5 |
| Output tokens (mean) | 8985 | 8704 | 7617 | 4861 |
| Wall clock s (mean) | 165.2 | 163.0 | 152.3 | 125.7 |
| N runs | 2 | 2 | 2 | 2 |

## noisy-signals

| Metric | Baseline | Split | TOON | Both |
|---|---:|---:|---:|---:|
| Combined score | 82% | 90% | 82% | 78% |
| Programmatic score | 97% | 100% | 92% | 89% |
| Judge weighted | 73% | 83% | 75% | 70% |
| Tool calls (mean) | 8.5 | 9.0 | 14.5 | 16.0 |
| Output tokens (mean) | 5338 | 4671 | 6177 | 3621 |
| Wall clock s (mean) | 105.6 | 89.6 | 147.6 | 149.0 |
| N runs | 2 | 1 | 2 | 2 |

## Attribution

Per-scenario combined-score deltas vs baseline (positive = better):

- **error-root-cause**: split=1pp, toon=3pp, both=0pp
- **latency-spike**: split=21pp, toon=-5pp, both=24pp
- **noisy-signals**: split=7pp, toon=-1pp, both=-5pp

*N≤2 per cell — single-digit deltas are not significant. Treat any signal of magnitude < 10pp as noise.*
