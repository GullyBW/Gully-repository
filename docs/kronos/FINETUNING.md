# Kronos — fine-tuning

Kronos ships **two** fine-tuning pipelines. They do the same two-stage job and
share no code.

| | `finetune/` | `finetune_csv/` |
| --- | --- | --- |
| Data source | A [Qlib](https://github.com/microsoft/qlib) provider directory | One CSV file |
| Universe | Many instruments (e.g. CSI 300) | A single series |
| Configuration | `finetune/config.py`, a Python class you edit | YAML under `finetune_csv/configs/` |
| Launcher | `torchrun` **required** | Plain `python` or `torchrun` |
| Splits | Explicit date ranges | Chronological ratios (`train/val/test`) |
| Evaluation | Qlib top-k dropout backtest | Validation loss + plots |
| Extra deps | `pyqlib`, `comet_ml` | `pyyaml` |

Pick `finetune/` if you are working with a Qlib universe and want a
portfolio-level backtest. Pick `finetune_csv/` if you have one instrument in a
CSV and want the shortest path to an adapted checkpoint.

Both are demonstration pipelines. Upstream also notes that many comments under
`finetune/` were AI-generated and may be inaccurate — trust the code.

## The two stages, and why the order matters

1. **Fine-tune the tokenizer.** Re-fits the quantiser to your data's
   distribution. Reconstruction loss only; the predictor is not involved.
2. **Fine-tune the predictor.** Loads the *fine-tuned* tokenizer, freezes it,
   tokenises batches on the fly, and trains the transformer with next-token
   cross-entropy.

Stage 2 reads the stage-1 output path. Running stage 2 against the pre-trained
tokenizer while stage 1's checkpoint exists is a silent mismatch — the token ids
mean different things — so either run both or point the config at the tokenizer
you actually used.

Learning rates differ by an order of magnitude and that is intentional: the
tokenizer is trained at `2e-4`, the predictor at `4e-5` (Qlib pipeline) or `1e-6`
(the shipped CSV config). Both use AdamW with `OneCycleLR`, `pct_start=0.03`,
`div_factor=10`, and gradient clipping (max-norm 2.0 for the tokenizer, 3.0 for
the predictor).

---

# Pipeline A — Qlib (`finetune/`)

## Prerequisites

```bash
pip install -r requirements.txt
pip install pyqlib
```

Then set up a local Qlib data directory following the
[Qlib guide](https://github.com/microsoft/qlib). The example scripts assume
daily-frequency Chinese A-share data.

`comet_ml` is imported at module scope in both training scripts, so it must be
installed even when `use_comet = False`.

## Step 1 — configure

Everything lives in `finetune/config.py`. The paths marked `TODO` upstream must
be changed:

| Setting | Default | What to set it to |
| --- | --- | --- |
| `qlib_data_path` | `~/.qlib/qlib_data/cn_data` | Your Qlib provider directory. |
| `dataset_path` | `./data/processed_datasets` | Where the pickled splits go. |
| `save_path` | `./outputs/models` | Checkpoint root. |
| `backtest_result_path` | `./outputs/backtest_results` | Backtest output. |
| `pretrained_tokenizer_path` | `path/to/your/Kronos-Tokenizer-base` | Local dir or a Hub id. |
| `pretrained_predictor_path` | `path/to/your/Kronos-small` | Local dir or a Hub id. |
| `use_comet` | `True` | Set `False` unless you have a Comet workspace. |
| `comet_config` | placeholder strings | Load the API key from the environment, not the file. |

Other knobs you are likely to touch:

* `instrument` — `csi300` by default; the benchmark index is derived from it via
  `_set_benchmark`, which only knows `csi300`, `csi800` and `csi1000` and raises
  `ValueError` for anything else.
* `lookback_window` (90) / `predict_window` (10) / `max_context` (512).
* `train_time_range` / `val_time_range` / `test_time_range` / `backtest_time_range`.
  These deliberately overlap: each split starts before the previous one ends to
  leave room for the lookback window.
* `epochs` (30), `batch_size` (50, **per GPU**), `accumulation_steps` (1).
* `n_train_iter` / `n_val_iter` — samples drawn per "epoch". With a large
  universe a true epoch is impractical, so an epoch is defined as this many
  samples.
* Inference/backtest: `inference_T=0.6`, `inference_top_p=0.9`,
  `inference_top_k=0`, `inference_sample_count=5`, `backtest_n_symbol_hold=50`,
  `backtest_n_symbol_drop=5`, `backtest_hold_thresh=5`.

Derived paths (`finetuned_tokenizer_path`, `finetuned_predictor_path`) are built
from `save_path` and the folder names — you do not set them directly.

## Step 2 — build the dataset

```bash
python finetune/qlib_data_preprocess.py
```

`QlibDataPreprocessor` loads `open/close/high/low/volume/vwap` from Qlib, pads the
requested range by `lookback_window` on the left and `predict_window` on the
right so windows at the boundaries are complete, derives
`amt = mean(OHLC) × volume`, drops symbols with fewer rows than
`lookback + predict + 1`, and writes `train_data.pkl`, `val_data.pkl`,
`test_data.pkl` into `dataset_path`.

## Step 3 — train

Both scripts hard-fail without `torchrun` (`WORLD_SIZE` must be set).

```bash
# Stage 1
torchrun --standalone --nproc_per_node=2 finetune/train_tokenizer.py

# Stage 2
torchrun --standalone --nproc_per_node=2 finetune/train_predictor.py
```

Run them from the repository root. If you hit `ModuleNotFoundError: model`, put
the root on the path explicitly — the scripts rely on a relative
`sys.path.append("../")`:

```bash
PYTHONPATH=. torchrun --standalone --nproc_per_node=2 finetune/train_tokenizer.py
```

What each does:

* **`train_tokenizer.py`** — DDP-wraps `KronosTokenizer.from_pretrained(pretrained_tokenizer_path)`,
  trains on `mse(z_pre, x) + mse(z, x) + bsq_loss`, halved. Supports gradient
  accumulation. Validation uses full-code MSE only. Rank 0 writes the best
  checkpoint to `{save_path}/{tokenizer_save_folder_name}/checkpoints/best_model`
  and a `summary.json`.
* **`train_predictor.py`** — loads the **fine-tuned** tokenizer
  (`finetuned_tokenizer_path`), puts it in eval mode, and DDP-wraps
  `Kronos.from_pretrained(pretrained_predictor_path)`. Each batch is tokenised
  under `no_grad`, shifted by one to form inputs and targets, and scored with
  `DualHead.compute_loss`. Best checkpoint goes to
  `{save_path}/{predictor_save_folder_name}/checkpoints/best_model`.

Both call `dataset.set_epoch_seed(epoch * 10000 + rank)` each epoch so ranks draw
different windows while staying reproducible, and hold the validation seed fixed
at 0 so validation loss is comparable across epochs.

### How `QlibDataset` samples

`finetune/dataset.py` enumerates every valid `(symbol, start_index)` pair up
front, then `__getitem__` **ignores its index** and draws a random pair from a
seeded RNG. Length is `min(n_train_iter, total_pairs)`. So an "epoch" is a random
sample with replacement, not a pass over the data.

Normalisation is computed on the **lookback portion only** and then applied to
the whole window including the prediction horizon. That is the anti-leakage
detail worth preserving if you write your own dataset: statistics must never see
the future bars.

## Step 4 — backtest

```bash
python finetune/qlib_test.py --device cuda:0
```

`QlibTestDataset` walks the test split sequentially (no random sampling) and
carries `symbol` and `timestamp` through so predictions can be mapped back.
Inference calls `auto_regressive_inference` directly with the config's sampling
parameters, then derives four signals per bar from the predicted close relative
to the last observed close: `last`, `mean`, `max`, `min`.

Each signal is pivoted into a `(datetime × instrument)` score matrix, pickled to
`{backtest_result_path}/{backtest_save_folder_name}/predictions.pkl`, and fed to
Qlib's `TopkDropoutStrategy`. The backtest assumes a ¥100M account, open-price
execution, 0.1% open cost, 0.15% close cost, ¥5 minimum, and a 9.5% limit
threshold. Output is a console `risk_analysis` table plus a cumulative-return
plot against the benchmark index.

Note the default `--device cuda:1`; pass `--device` explicitly on a single-GPU
box.

---

# Pipeline B — custom CSV (`finetune_csv/`)

## Step 1 — prepare the CSV

Required columns, exactly these names:

`timestamps, open, high, low, close, volume, amount`

`volume` and `amount` may be `0` throughout if you do not have them. Rows are
sorted by timestamp on load and NaNs are forward-filled with a warning.
`data/HK_ali_09988_kline_5min_all.csv` is a complete worked example (Alibaba HK,
5-minute bars).

| timestamps | open | close | high | low | volume | amount |
| --- | --- | --- | --- | --- | --- | --- |
| 2019/11/26 9:35 | 182.45215 | 184.45215 | 184.95215 | 182.45215 | 15136000 | 0 |
| 2019/11/26 9:40 | 184.35215 | 183.85215 | 184.55215 | 183.45215 | 4433300 | 0 |

## Step 2 — write the config

Copy `configs/config_ali09988_candle-5min.yaml` and edit. Structure:

```yaml
data:
  data_path: "/abs/path/to/your.csv"
  lookback_window: 512      # historical points fed to the model
  predict_window: 48        # future points per training sample
  max_context: 512
  clip: 5.0
  train_ratio: 0.9          # chronological, not shuffled
  val_ratio: 0.1
  test_ratio: 0.0

training:
  tokenizer_epochs: 30
  basemodel_epochs: 20
  batch_size: 32
  log_interval: 50
  num_workers: 6
  seed: 42
  tokenizer_learning_rate: 0.0002
  predictor_learning_rate: 0.000001
  adam_beta1: 0.9
  adam_beta2: 0.95
  adam_weight_decay: 0.1
  accumulation_steps: 1

model_paths:
  pretrained_tokenizer: "/path/to/Kronos-Tokenizer-base"
  pretrained_predictor: "/path/to/Kronos-base"
  exp_name: "HK_ali_09988_kline_5min_all"
  base_path: "/path/to/Kronos/finetune_csv/finetuned/"
  base_save_path: ""        # left empty -> generated from base_path + exp_name
  finetuned_tokenizer: ""   # left empty -> {base_save_path}/tokenizer/best_model
  tokenizer_save_name: "tokenizer"
  basemodel_save_name: "basemodel"

experiment:
  name: "kronos_custom_finetune"
  description: "..."
  use_comet: false
  train_tokenizer: true
  train_basemodel: true
  skip_existing: false

device:
  use_cuda: true
  device_id: 0
```

`ConfigLoader._resolve_dynamic_paths` fills the empty path fields from
`base_path` and `exp_name`. You can also write a template containing
`{exp_name}` and it will be substituted. A non-empty literal path is left alone.

`lookback_window` must not exceed the pre-trained model's context (512 for
`Kronos-base`/`small`, 2048 for `mini`).

## Step 3 — train

Sequential (recommended — runs both stages in one process):

```bash
python train_sequential.py --config configs/your.yaml

python train_sequential.py --config configs/your.yaml --skip-existing   # reuse finished stages
python train_sequential.py --config configs/your.yaml --skip-basemodel  # tokenizer only
python train_sequential.py --config configs/your.yaml --skip-tokenizer  # predictor only
```

Or stage by stage:

```bash
python finetune_tokenizer.py  --config configs/your.yaml
python finetune_base_model.py --config configs/your.yaml   # needs the tokenizer from above
```

Multi-GPU:

```bash
DIST_BACKEND=nccl torchrun --standalone --nproc_per_node=8 \
    train_sequential.py --config configs/your.yaml
```

`DIST_BACKEND` defaults to `nccl`; use `gloo` for CPU or mixed setups. The
scripts read `LOCAL_RANK` and fall back to `device.device_id` when it is unset,
so the same file runs single-process.

### How `CustomKlineDataset` splits and samples

* **Chronological split** by ratio: the first `train_ratio` of rows is training,
  the next `val_ratio` is validation, the remainder is test. No shuffling — the
  validation set is strictly later than training.
* **Deterministic stride sampling**: training start indices are
  `(idx * 9973 + (epoch + 1) * 104729) % (max_start + 1)` — two coprime
  multipliers that scatter windows across the series while staying reproducible
  per epoch. Validation uses `idx % (max_start + 1)`, i.e. a straight sweep.
* Normalisation is per window over the **whole** window (lookback + horizon),
  unlike the Qlib dataset which uses lookback-only statistics. Keep this in mind
  when comparing validation numbers between the two pipelines.

## Step 4 — outputs

```
{base_save_path}/
  tokenizer/best_model/     fine-tuned tokenizer (load with KronosTokenizer.from_pretrained)
  basemodel/best_model/     fine-tuned predictor (load with Kronos.from_pretrained)
  logs/
    tokenizer_training_rank_0.log
    basemodel_training_rank_0.log
```

Checkpoints are written whenever validation loss improves. Load them the same way
as Hub models:

```python
tokenizer = KronosTokenizer.from_pretrained(f"{base_save_path}/tokenizer/best_model")
model     = Kronos.from_pretrained(f"{base_save_path}/basemodel/best_model")
predictor = KronosPredictor(model, tokenizer, max_context=512)
```

---

## From demo to production

Upstream is explicit that these pipelines are illustrative. Before treating any
result as a strategy:

* **Raw signal ≠ alpha.** The predicted close-price change is unneutralised
  exposure to market beta, size, value and everything else. Feed it through a
  portfolio optimiser with risk constraints.
* **Backtest fidelity.** The shipped backtest models fixed commission and a
  limit threshold, but not slippage, market impact, borrow, or partial fills.
* **Data handling.** `QlibDataset` and `CustomKlineDataset` are examples. Corporate
  actions, halts, and survivorship bias are your responsibility.
* **Strategy complexity.** Top-k dropout with a fixed hold threshold is a
  starting point, not position sizing or risk management.
