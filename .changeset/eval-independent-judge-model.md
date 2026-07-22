---
"@hyperdx/hdx-eval": minor
---

feat(evals): support an independent inference model/provider for LLM-as-judge
grading. The grader can now differ from the run model (e.g. run with Anthropic,
grade with OpenAI) to reduce same-model bias. `--judge-model` accepts a
`provider:model` spec (`anthropic`, `openai`; a bare model name defaults to
anthropic), configurable per repo via `eval.config.json` `grading.judgeModel`.
The judge now uses the Vercel AI SDK, so grader credentials come from
`AI_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY` (plus `AI_BASE_URL` /
`AI_REQUEST_HEADERS`), mirroring the API package. The provider-specific key
takes precedence over `AI_API_KEY` so a runner key and a differing grader key
don't collide.

The judge prompt now defines explicit 0-5 scoring anchors so scores stay
calibrated across judge models, and the judge is more robust to intermittent
structured-output malformations (recovers nested/stringified `scores` payloads
and retries once on schema failure). Reasoning judge models (OpenAI gpt-5.x /
o-series) get a larger output-token budget so hidden reasoning tokens don't
truncate the JSON.

fix(evals): re-grading a batch with a different judge model now actually
re-runs that judge instead of silently returning the previously cached judge's
scores. The `needsJudge` check and per-run reuse guard were keyed on the mere
presence of a cached judge, not its identity, so `grade <batch> --judge-model
openai:gpt-5.6-sol` over an Opus-graded batch would skip the LLM call and hand
back the stale Opus scores. Both now key on the judge spec: a cached grade from
a different judge model is treated as stale. `--rerun-judge` still forces a
refresh with the same judge. This is required for grader-bias comparisons
(grading one batch with two judges).
