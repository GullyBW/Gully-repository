# Kronos — example scripts

Everything in `examples/`. The scripts assume they are run **from inside
`examples/`** — they reach the `model` package via `sys.path.append("../")`.

Several of the later additions are written and commented in Chinese and pull data
from Chinese market APIs; those are marked below. Some also set
`plt.rcParams['font.sans-serif'] = ['SimHei']`, which produces missing-glyph
warnings if SimHei is not installed. Substitute a font you have, or drop the line.

## Canonical starting points

### `prediction_example.py`

The reference single-series forecast, and the script the upstream README walks
through. Loads `Kronos-small` + `Kronos-Tokenizer-base`, reads
`./data/XSHG_5min_600977.csv`, forecasts 120 bars from a 400-bar lookback with
`T=1.0, top_p=0.9, sample_count=1`, then plots predicted vs actual close and
volume with matplotlib.

Read this one first — everything else is a variation on it.

### `prediction_wo_vol_example.py`

Same flow with the `volume`/`amount` columns omitted from the input, showing the
price-only path. `KronosPredictor` zero-fills the missing columns; the plot shows
close only.

### `prediction_batch_example.py`

Demonstrates `predict_batch`: several DataFrames forecast in one GPU batch. Use
it as the template when you need a universe of instruments on the same schedule.
Remember the constraint — identical lookback and `pred_len` across all series.

## Market-data download (Chinese A-shares)

### `get_date_new.py`

Downloads full available history for a stock code from the Eastmoney endpoint.
`get_stock_market()` maps a code prefix to an exchange (`0`/`2`/`3` → Shenzhen,
`6`/`9` → Shanghai). Comments in Chinese.

### `get_akshare_date_2024-2025_x.py`

The same downloader narrowed to a 2024–2025 window
(`get_stock_data_eastmoney(stock_code, start_year, end_year)`). Comments in
Chinese.

Both write CSVs in the column layout `KronosPredictor` expects. Network access to
Eastmoney is required.

## End-to-end prediction scripts

### `prediction_cn_markets_day.py`

The cleanest of the A-share scripts and the only one with a CLI:

```bash
python prediction_cn_markets_day.py --symbol 000001
```

Downloads the latest daily bars via akshare, cleans them, runs inference, and
writes `./outputs/pred_<symbol>_data.csv` and `./outputs/pred_<symbol>_chart.png`.
Requires `akshare`.

### `prediction_akshare_2024-2025.py`

Forecasting over the 2024–2025 range using akshare data, with directory setup and
chart export helpers. Chinese comments.

### `prediction_new.py`

A large (~1300-line) script combining data loading, prediction, technical
indicators and report generation. Chinese comments; wraps the Kronos import in a
`try/except` and degrades if unavailable.

### `prediction_new_GUI.py`

A **Tkinter desktop application** (~1600 lines) built on the same machinery as
`prediction_new.py`. Needs a display; it will not run headless. Chinese UI text.

## Backtesting

### `run_backtest_kronos.py`

`KronosBacktester(data_dir, model_dir, initial_capital=100000)` — a standalone
backtester over locally stored CSVs and a local model directory, independent of
Qlib. Chinese comments. Simple mechanics; see the disclaimer below.

### `yuce/historical_backtest.py`

`HistoricalBacktester(data_dir, initial_capital=100000)` — replays historical
windows to check forecast quality against what actually happened.

`yuce/` ("预测", *prediction*) also contains committed sample outputs for four
codes — `000021`, `002354`, `300207`, `600580`:

* `<code>_comprehensive_analysis_report.json` — keys `timestamp`, `stock_code`,
  `market_analysis`, `sector_analysis`, `macro_analysis`, `fundamental_analysis`,
  `adjustment_factor`;
* `<code>_optimized_prediction.png` — the corresponding chart;
* `market_analysis_report.json` — an aggregate report.

These are illustrative artefacts of a past run, not fixtures anything asserts
against.

## A note on the backtest scripts

`run_backtest_kronos.py` and `yuce/historical_backtest.py` are demonstrations.
They do not model slippage, market impact, borrow costs or partial fills, and
they contain no risk-factor neutralisation. Returns produced by them are an upper
bound under idealised execution. The same caveat upstream applies to
`finetune/qlib_test.py` — see [FINETUNING.md](./FINETUNING.md#from-demo-to-production).

## Extra dependencies by script

| Script | Needs |
| --- | --- |
| `prediction_example.py`, `prediction_wo_vol_example.py`, `prediction_batch_example.py` | core `requirements.txt` only |
| `prediction_cn_markets_day.py`, `prediction_akshare_2024-2025.py` | `akshare` |
| `get_date_new.py`, `get_akshare_date_2024-2025_x.py` | network access to Eastmoney |
| `prediction_new_GUI.py` | `tkinter` and a display |
| Any script setting SimHei | the SimHei font, or edit the rcParam |
