# Kronos — web UI

`webui/` is a Flask application that wraps `KronosPredictor` in a browser front
end: pick a data file, load a checkpoint, choose a window with a slider, and get
an interactive Plotly candlestick chart with the forecast overlaid on the actual
bars.

## Running it

```bash
cd webui
pip install -r webui/requirements.txt   # flask, flask-cors, plotly, pandas, torch, huggingface_hub

python run.py        # checks deps, opens a browser, then starts the server
# or
./start.sh           # same checks, shell version
# or
python app.py        # straight to Flask
```

Serves on `http://localhost:7070`, bound to `0.0.0.0` with `debug=True`. That
combination is a development configuration: the Werkzeug debugger executes
arbitrary code from the browser, so do not expose the port beyond localhost. Put
it behind a WSGI server and set `debug=False` if you need it reachable.

The port is hard-coded in `app.py` and `run.py`; change it in both.

`run.py` also probes whether the `model` package imports and prints a warning if
not — but the `/api/predict` endpoint returns an error rather than falling back
to simulated data, so a broken import means no forecasts.

## Workflow

1. **Load data** — pick a file from the repository's `data/` directory.
2. **Load model** — choose a checkpoint and a device. First load downloads from
   the Hub and can take a while.
3. **Set parameters** — temperature, nucleus threshold, sample count.
4. **Choose a window** — a slider over a fixed 400 + 120 = 520-bar span.
5. **Predict** — the chart and comparison tables populate.

Every prediction is also written as JSON to `webui/prediction_results/` with a
timestamped filename, capturing the inputs, outputs, actuals and parameters.

## Data files

The file picker scans the repository-root `data/` directory for `.csv` and
`.feather` files.

Required columns: `open`, `high`, `low`, `close`. Optional: `volume`, `amount`
(display only — it is not fed to the model by this UI, which passes only OHLC and
volume).

The timestamp column is resolved in order: `timestamps` → `timestamp` → `date`.
If none exists the loader **fabricates** one with
`pd.date_range(start='2024-01-01', periods=len(df), freq='1H')`. Forecasts on
such a file are conditioned on invented calendar features and are not meaningful
— always ship a real timestamp column.

Price columns are coerced with `pd.to_numeric(errors='coerce')` and rows with any
NaN are dropped.

## Models

`AVAILABLE_MODELS` in `app.py` hard-codes three entries. Each pairs a model id
with the tokenizer it requires and its context length, which becomes
`max_context` on the predictor.

| Key | Model | Tokenizer | Context | Params |
| --- | --- | --- | --- | --- |
| `kronos-mini` | `NeoQuasar/Kronos-mini` | `NeoQuasar/Kronos-Tokenizer-2k` | 2048 | 4.1M |
| `kronos-small` | `NeoQuasar/Kronos-small` | `NeoQuasar/Kronos-Tokenizer-base` | 512 | 24.7M |
| `kronos-base` | `NeoQuasar/Kronos-base` | `NeoQuasar/Kronos-Tokenizer-base` | 512 | 102.3M |

To serve a fine-tuned checkpoint, add an entry pointing `model_id` and
`tokenizer_id` at local directories.

Devices offered: `cpu`, `cuda`, `mps`.

The loaded tokenizer, model and predictor are module-level globals. There is one
shared model across all clients and no locking, so concurrent requests are not
isolated — treat this as a single-user tool.

## HTTP API

All bodies are JSON. Errors come back as `{"error": "..."}` with a 4xx/5xx status.

### `GET /`

Renders `templates/index.html`.

### `GET /api/data-files`

Lists the discovered data files.

```json
[{"name": "XSHG_5min_600977.csv", "path": "/abs/path/data/...", "size": "2.3 MB"}]
```

### `POST /api/load-data`

```json
{"file_path": "/abs/path/data/XSHG_5min_600977.csv"}
```

Response:

```json
{
  "success": true,
  "data_info": {
    "rows": 10000,
    "columns": ["open", "high", "low", "close", "volume", "timestamps"],
    "start_date": "2024-01-01T09:30:00",
    "end_date": "2024-06-30T15:00:00",
    "price_range": {"min": 8.21, "max": 14.07},
    "prediction_columns": ["open", "high", "low", "close", "volume"],
    "timeframe": "5 minutes"
  },
  "message": "Successfully loaded data, total 10000 rows"
}
```

`timeframe` is inferred from the mean gap across the first ten bars.

### `POST /api/load-model`

```json
{"model_key": "kronos-small", "device": "cpu"}
```

Returns `{"success": true, "message": "...", "model_info": {...}}`. Fails with
400 if `model_key` is unknown or the `model` package could not be imported, 500
if the download or construction fails.

### `POST /api/predict`

```json
{
  "file_path": "/abs/path/data/file.csv",
  "lookback": 400,
  "pred_len": 120,
  "temperature": 1.0,
  "top_p": 0.9,
  "sample_count": 1,
  "start_date": "2024-03-01T09:30:00"
}
```

`start_date` is optional. When given, the endpoint takes the first `lookback`
bars at or after that time as context and the next `pred_len` bars as ground
truth for comparison. When omitted it uses rows `[0 : lookback]` of the file —
note that this is the *beginning* of the file, despite the "latest data" label in
the response text.

Response:

```json
{
  "success": true,
  "prediction_type": "Kronos model prediction (latest data)",
  "chart": "<plotly figure JSON>",
  "prediction_results": [...],
  "actual_data": [...],
  "has_comparison": true,
  "message": "Prediction completed, generated 120 prediction points, ..."
}
```

Errors: 400 for an empty path, a bad file, too few rows for `lookback`, too few
rows after `start_date` for `lookback + pred_len`, or no model loaded; 500 if
inference itself raises.

### `GET /api/available-models`

`{"models": {...AVAILABLE_MODELS...}, "model_available": true}`

### `GET /api/model-status`

```json
{
  "available": true,
  "loaded": true,
  "message": "Kronos model loaded and available",
  "current_model": {"name": "Kronos", "device": "cpu"}
}
```

`available` reports whether the `model` package imported; `loaded` whether a
predictor has been constructed.

## Parameter guidance from the UI

The upstream `webui/README.md` suggests `T` 1.2–1.5, `top_p` 0.95–1.0 and 2–3
samples for "better quality". That is a looser, more exploratory setting than the
library defaults (`T=1.0`, `top_p=0.9`, `sample_count=1`) and than the backtest
config (`T=0.6`, `sample_count=5`). There is no single right answer — higher
temperature produces more varied, more realistically volatile paths; more samples
averages them back toward the mean. Judge on your own data.

## Limitations

* Single shared model instance; no request isolation or auth.
* `debug=True` and `0.0.0.0` binding by default.
* The 400 + 120 window is fixed in the UI.
* `amount` is loaded and displayed but not used for prediction.
* Every prediction writes a JSON file to `webui/prediction_results/` with no
  rotation or cleanup.
