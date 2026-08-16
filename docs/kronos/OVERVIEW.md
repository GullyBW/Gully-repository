# Kronos — overview

## What it is

Kronos is a family of decoder-only foundation models pre-trained on K-line
(candlestick) sequences from more than 45 global exchanges. Where a
general-purpose time-series foundation model treats a price series as arbitrary
floating-point numbers, Kronos borrows the language-model recipe: a specialised
tokenizer turns each continuous OHLCV bar into a pair of **discrete tokens**, and
an autoregressive transformer is trained to predict the next token pair.

The consequence for a user is that forecasting is *sampling*, not regression.
Calling `predict()` twice with the same input gives two different answers unless
you pin the sampling temperature and seed. That is deliberate — it lets you draw
many paths and average them (`sample_count`) or study the spread.

## Model zoo

All checkpoints live on the Hugging Face Hub under the `NeoQuasar` org. A model
must be paired with the tokenizer it was trained against — the token vocabularies
are not interchangeable.

| Model | Tokenizer | Context length | Params | Public |
| --- | --- | --- | --- | --- |
| `NeoQuasar/Kronos-mini` | `NeoQuasar/Kronos-Tokenizer-2k` | 2048 | 4.1M | yes |
| `NeoQuasar/Kronos-small` | `NeoQuasar/Kronos-Tokenizer-base` | 512 | 24.7M | yes |
| `NeoQuasar/Kronos-base` | `NeoQuasar/Kronos-Tokenizer-base` | 512 | 102.3M | yes |
| `Kronos-large` | `NeoQuasar/Kronos-Tokenizer-base` | 512 | 499.2M | not released |

`max_context` is a hard limit on how many bars the transformer attends to.
`KronosPredictor` silently truncates longer inputs to the most recent
`max_context` bars rather than erroring, so passing a 2000-bar lookback to
Kronos-small does not fail — it just quietly ignores most of your history.

## Repository layout

```
model/                 the model itself — this is the part you import
  kronos.py            KronosTokenizer, Kronos, KronosPredictor, inference loop
  module.py            building blocks: BSQ quantizer, RoPE attention, embeddings
  __init__.py          public exports + get_model_class() registry

finetune/              fine-tuning pipeline driven by Qlib (Chinese A-share demo)
  config.py            one central Config object; edit paths here
  qlib_data_preprocess.py   Qlib -> train/val/test pickles
  dataset.py           QlibDataset: sliding windows + per-window normalisation
  train_tokenizer.py   stage 1, DDP via torchrun
  train_predictor.py   stage 2, DDP via torchrun
  qlib_test.py         inference over the test split + top-k dropout backtest
  utils/training_utils.py   DDP setup, seeding, model-size and time formatting

finetune_csv/          fine-tuning pipeline driven by a plain CSV file
  configs/*.yaml       YAML config (replaces finetune/config.py)
  config_loader.py     YAML loader with {exp_name} path templating
  finetune_tokenizer.py     stage 1
  finetune_base_model.py    stage 2 (+ CustomKlineDataset)
  train_sequential.py       runs both stages with skip flags

webui/                 Flask + Plotly front end for interactive forecasting
examples/              standalone scripts: single/batch forecast, data fetch, backtests
tests/                 pytest regression suite pinned to specific HF revisions
figures/               images used by the upstream README
```

## Dependencies

Core (`requirements.txt`), Python 3.10+:

```
numpy
pandas
torch>=2.0.0
einops==0.8.1
huggingface_hub==0.33.1
matplotlib==3.9.3
tqdm==4.67.1
safetensors==0.6.2
```

Optional, per component:

| Component | Extra requirement |
| --- | --- |
| `finetune/` (Qlib pipeline) | `pyqlib`, plus a local Qlib data directory |
| Experiment logging in `finetune/` | `comet_ml` (imported unconditionally by the training scripts — see [FINETUNING.md](./FINETUNING.md)) |
| `finetune_csv/` | `pyyaml` |
| `webui/` | `flask==2.3.3`, `flask-cors==4.0.0`, `plotly==5.17.0` |
| Some `examples/` scripts | `akshare` for market data download; several are commented in Chinese |

`torch` is not pinned to a CUDA build; install the wheel that matches your
accelerator before installing the rest, or pip will pull the default one.

## Hardware

Inference runs on CPU — the regression suite does exactly that — but a 120-step
forecast with `sample_count=5` is autoregressive, so it costs 120 sequential
forward passes and CPU latency is noticeable. `KronosPredictor` auto-detects
CUDA, then Apple MPS, then falls back to CPU.

Fine-tuning is written for multi-GPU: both `finetune/` training scripts *require*
`torchrun` and raise at startup if `WORLD_SIZE` is unset. The `finetune_csv/`
scripts run single-process as well as under `torchrun`.
