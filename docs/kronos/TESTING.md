# Kronos — testing

`tests/test_kronos_regression.py` is the whole suite: two parametrised pytest
tests that pin Kronos's numerical behaviour. There are no unit tests for the
individual modules.

## Running

```bash
pip install pytest
PYTHONPATH=. pytest tests/test_kronos_regression.py -v
```

Runs on **CPU** (`DEVICE = "cpu"`) and downloads `Kronos-small` +
`Kronos-Tokenizer-base` from the Hub on first execution, so the first run needs
network access. The MSE test performs four separate 30-step forecasts; expect
minutes, not seconds.

## What is pinned

Determinism here rests on four things at once. Change any one and the
assertions will fail:

| Pin | Value |
| --- | --- |
| Model revision | `901c26c1332695a2a8f243eb2f37243a37bea320` |
| Tokenizer revision | `0e0117387f39004a9016484a186a908917e22426` |
| Seed | `123`, applied to `random`, `numpy` and `torch`, with cuDNN set deterministic |
| Sampling | `T=1.0, top_k=1, top_p=1.0` — top-k of 1 makes generation effectively greedy |

Both models are put in `.eval()` and inference runs inside `torch.no_grad()`.

The revisions are pinned deliberately: `from_pretrained` without `revision`
follows the branch head, so an upstream checkpoint update would silently change
every number the suite asserts.

## Test 1 — exact output regression

`test_kronos_predictor_regression[512]` and `[256]`.

Reads `tests/data/regression_input.csv`, takes the first `context_len` rows as
context, forecasts 8 bars, and compares all six features against the committed
fixture `tests/data/regression_output_{context_len}.csv` with
`np.testing.assert_allclose(rtol=1e-5)`.

This catches any change to the model code path — tokenisation, attention,
sampling, normalisation — that shifts the output at all.

## Test 2 — forecast-accuracy regression

`test_kronos_predictor_mse[512-0.008979]` and `[256-0.003741]`.

Draws 4 random rows (`random_state=123`) from the region of the input file where
a full context and a 30-bar horizon both fit, forecasts each, and computes MSE
against the true OHLC. The mean across the four samples must sit within
`1e-6` of the expected value.

Only `open, high, low, close` are scored here; the exact-output test covers all
six columns.

The tolerance is tight enough that this is a regression guard, not a quality
metric. Do not read the numbers as a statement about how accurate Kronos is —
they are four windows of one instrument at greedy sampling.

## Fixtures

```
tests/data/
  regression_input.csv         shared input series
  regression_output_512.csv    8-bar fixture, 512-bar context
  regression_output_256.csv    8-bar fixture, 256-bar context
  generate_regression_output.py
```

`generate_regression_output.py` regenerates the two output fixtures using exactly
the same seed, revisions and sampling parameters as the test:

```bash
PYTHONPATH=. python tests/data/generate_regression_output.py
```

It validates that the input has at least `512 + 8` rows and that each prediction
comes back with the expected shape before writing.

**Regenerate only when a change to the model output is intended.** Refreshing the
fixtures to make a red test pass discards the guarantee the test exists to
provide. If you do regenerate, the MSE expectations in
`test_kronos_regression.py` (`MSE_EXPECTED`) are separate constants and must be
updated by hand from the new run.

## Adding coverage

Gaps worth filling if you build on this repository:

* `predict_batch` — none of its validation paths or its batch-vs-single
  equivalence are tested.
* Tokenizer round-trip — `encode`/`decode` reconstruction error is unasserted.
* The `volume`/`amount` fallbacks in `KronosPredictor.predict`.
* Context truncation when the lookback exceeds `max_context`.
* CUDA/MPS parity — the suite is CPU-only.
