# Kronos — getting started

## Install

Python 3.10 or newer.

```bash
git clone https://github.com/shiyu-coder/Kronos.git
cd Kronos

python -m venv .venv && source .venv/bin/activate
# install the torch build that matches your accelerator first, e.g.
#   pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

Checkpoints are pulled from the Hugging Face Hub on first use and cached under
`~/.cache/huggingface`. No account or token is needed — the models are public.
Set `HF_HOME` to relocate the cache, or `HF_HUB_OFFLINE=1` to force use of an
existing one.

Nothing is installed as a package: scripts reach the `model` package via
`sys.path.append("../")`, so run them from inside the repository (from
`examples/`, from `webui/`, and so on) or set `PYTHONPATH` to the repo root.

## Your first forecast

```python
import pandas as pd
from model import Kronos, KronosTokenizer, KronosPredictor

# 1. Load a matched model + tokenizer pair.
tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
model     = Kronos.from_pretrained("NeoQuasar/Kronos-small")

# 2. Wrap them. device=None auto-detects cuda -> mps -> cpu.
predictor = KronosPredictor(model, tokenizer, max_context=512)

# 3. Prepare the context.
df = pd.read_csv("./data/XSHG_5min_600977.csv")
df["timestamps"] = pd.to_datetime(df["timestamps"])

lookback, pred_len = 400, 120
x_df        = df.loc[:lookback - 1, ["open", "high", "low", "close", "volume", "amount"]]
x_timestamp = df.loc[:lookback - 1, "timestamps"]
y_timestamp = df.loc[lookback:lookback + pred_len - 1, "timestamps"]

# 4. Forecast.
pred_df = predictor.predict(
    df=x_df,
    x_timestamp=x_timestamp,
    y_timestamp=y_timestamp,
    pred_len=pred_len,
    T=1.0,
    top_p=0.9,
    sample_count=1,
)

print(pred_df.head())
```

`pred_df` is a DataFrame of `open, high, low, close, volume, amount` indexed by
`y_timestamp`, with `pred_len` rows.

### The three inputs, precisely

| Input | Type | Requirement |
| --- | --- | --- |
| `df` | `pd.DataFrame` | Must contain `open, high, low, close`. `volume` and `amount` are optional. No NaNs in those columns. |
| `x_timestamp` | `pd.Series` of datetimes | One entry per row of `df`. Must be a Series, not a `DatetimeIndex` — the code calls `.dt` on it. |
| `y_timestamp` | `pd.Series` of datetimes | The future bar times you want. Length must be `pred_len`. |

You supply `y_timestamp` because the model conditions on the calendar features of
the periods it is predicting. Generate them to match your bar frequency and
trading calendar — a naive `pd.date_range` over a 5-minute series will invent
bars for overnight hours and the model will be asked to forecast a session that
does not exist.

If your timestamps come out of an index, convert first:

```python
x_timestamp = pd.Series(df.index, name="timestamps")
```

## Batch forecasting

`predict_batch` runs several series through the GPU as one batch. It is the right
call when you forecast a universe of instruments on the same schedule.

```python
pred_dfs = predictor.predict_batch(
    df_list=[df1, df2, df3],
    x_timestamp_list=[ts1, ts2, ts3],
    y_timestamp_list=[fut1, fut2, fut3],
    pred_len=120,
    T=1.0,
    top_p=0.9,
    sample_count=1,
    verbose=True,
)
```

Constraints, all enforced with explicit `ValueError`s:

* every series must have the **same lookback length**;
* every `y_timestamp_list[i]` must have exactly `pred_len` entries;
* each frame needs the four price columns and no NaNs.

Normalisation is computed independently per series, so mixing instruments with
wildly different price levels is fine.

## Choosing the parameters

| Parameter | Default | What it does |
| --- | --- | --- |
| `pred_len` | — | Number of future bars. Each one is a sequential forward pass; latency is linear in this. |
| `T` | `1.0` | Sampling temperature. Below 1 sharpens toward the mode (flatter, more conservative paths); above 1 flattens (wilder paths). |
| `top_k` | `0` | Keep only the k most likely tokens. **If `top_k > 0`, `top_p` is ignored entirely.** |
| `top_p` | `0.9` | Nucleus sampling: keep the smallest token set whose cumulative probability reaches `p`. Only active when `top_k == 0`. |
| `sample_count` | `1` | Generate this many paths in parallel and return their **mean**, not a distribution. |
| `verbose` | `True` | Show a tqdm bar over the generation steps. |

Starting points:

* **Point forecast for a chart** — `T=1.0, top_p=0.9, sample_count=1`. What the
  upstream examples use.
* **Smoother central estimate** — raise `sample_count` to 5–10. Remember this
  averages candlesticks, so realised range is understated
  ([why](./ARCHITECTURE.md#5-behavioural-notes-and-gotchas)).
* **Trading signal generation** — the upstream Qlib backtest uses `T=0.6`,
  `top_p=0.9`, `top_k=0`, `sample_count=5`: a low temperature and several
  averaged paths, which trades away tail realism for signal stability.
* **Deterministic / reproducible** — `T=1.0, top_k=1, top_p=1.0` makes sampling
  effectively greedy. This is what the regression tests do; combine it with a
  fixed seed (see [TESTING.md](./TESTING.md)).
* **Uncertainty bands** — do *not* use `sample_count`. Loop `predict` with
  `sample_count=1` and take quantiles across runs.

## Reproducibility

Generation calls `torch.multinomial`, so results vary run to run. To pin them:

```python
import random, numpy as np, torch

random.seed(123); np.random.seed(123); torch.manual_seed(123)
torch.backends.cudnn.deterministic = True
torch.backends.cudnn.benchmark = False

tokenizer.eval(); model.eval()
```

Results are still only bitwise-reproducible for a fixed device, torch version and
checkpoint revision. Pin the revision when it matters:

```python
model = Kronos.from_pretrained("NeoQuasar/Kronos-small", revision="901c26c1...")
```

## Forecasting without volume

Drop the columns and pass price only; `KronosPredictor` fills `volume` and
`amount` with zeros.

```python
x_df = df.loc[:lookback - 1, ["open", "high", "low", "close"]]
```

The `volume` and `amount` columns of the result are then meaningless — ignore
them. `examples/prediction_wo_vol_example.py` is a runnable version.

## Common errors

| Message | Cause |
| --- | --- |
| `Price columns [...] not found in DataFrame.` | Column names must be lowercase `open/high/low/close`. |
| `Input DataFrame contains NaN values ...` | Drop or fill NaNs before calling; the check covers price, volume and amount. |
| `AttributeError: 'DatetimeIndex' object has no attribute 'dt'` | Pass timestamps as a `pd.Series`, not an index. |
| `y_timestamp length at index i should equal pred_len` | Batch path: future stamps and `pred_len` disagree. |
| `Parallel prediction requires all series to have consistent historical lengths` | Batch path: pad or trim to a common lookback. |
| `TypeError: '>' not supported between 'NoneType' and 'int'` | `top_k=None` passed to the lower-level sampling helpers. Use `0`. |
| Forecast ignores most of your history | Lookback exceeded `max_context`; truncation is silent. |
