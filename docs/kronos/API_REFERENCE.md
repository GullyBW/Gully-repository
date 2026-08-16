# Kronos — API reference

Everything importable from the `model` package, plus the internal building blocks
in `model/module.py` that you need when subclassing or debugging.

```python
from model import Kronos, KronosTokenizer, KronosPredictor
from model import get_model_class          # name -> class registry
```

Shape notation: `B` batch, `T` sequence length, `D` = `d_model`, `d_in` input
feature count (6 for OHLCV+amount).

---

## `KronosPredictor`

`model/kronos.py`. The high-level entry point: pandas in, pandas out. Handles
normalisation, tokenisation, generation and inverse normalisation.

### `KronosPredictor(model, tokenizer, device=None, max_context=512, clip=5)`

| Arg | Default | Meaning |
| --- | --- | --- |
| `model` | — | A `Kronos` instance. |
| `tokenizer` | — | The `KronosTokenizer` the model was trained with. |
| `device` | `None` | Torch device string. `None` auto-detects: `cuda:0` → `mps` → `cpu`. |
| `max_context` | `512` | Attention window. Must not exceed the checkpoint's trained context. |
| `clip` | `5` | Normalised values are clipped to `±clip`. |

Both modules are moved to `device` in the constructor. Note that the constructor
does **not** call `.eval()` — do it yourself if the checkpoint was saved in train
mode, otherwise dropout stays active and results become noisier than intended.

Attributes worth knowing: `price_cols = ['open','high','low','close']`,
`vol_col = 'volume'`, `amt_vol = 'amount'`,
`time_cols = ['minute','hour','weekday','day','month']`.

### `predict(df, x_timestamp, y_timestamp, pred_len, T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=True) -> pd.DataFrame`

Forecast a single series.

| Arg | Type | Notes |
| --- | --- | --- |
| `df` | `pd.DataFrame` | Needs `open, high, low, close`; `volume`/`amount` optional. |
| `x_timestamp` | `pd.Series[datetime]` | One per row of `df`. Must be a Series (`.dt` is used). |
| `y_timestamp` | `pd.Series[datetime]` | Length `pred_len`; becomes the result index. |
| `pred_len` | `int` | Bars to generate. |
| `T` | `float` | Sampling temperature. |
| `top_k` | `int` | Top-k filter; `0` disables. **Non-zero suppresses `top_p`.** |
| `top_p` | `float` | Nucleus threshold; active only when `top_k == 0`. |
| `sample_count` | `int` | Paths generated in parallel, then **averaged**. |
| `verbose` | `bool` | tqdm progress bar over generation steps. |

**Returns** a DataFrame with columns `open, high, low, close, volume, amount`,
`pred_len` rows, indexed by `y_timestamp`.

**Raises** `ValueError` if `df` is not a DataFrame, if a price column is missing,
or if any price/volume/amount value is NaN.

Pipeline: fill missing volume/amount → NaN check → build calendar features →
z-score over the context → clip → generate → invert normalisation → assemble the
frame.

#### Missing volume and amount

Two fallbacks, applied in this order:

1. `volume` absent → both `volume` and `amount` set to `0.0`.
2. `volume` present, `amount` absent → `amount = volume * mean(open, high, low, close)`.

In case 1 the corresponding output columns carry no information.

### `predict_batch(df_list, x_timestamp_list, y_timestamp_list, pred_len, T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=True) -> list[pd.DataFrame]`

Same semantics, several series at once, returned in input order. Normalisation is
per series.

Extra validation, each raising `ValueError`:

* the three lists must be lists/tuples of equal length;
* each element of `df_list` must be a DataFrame with the price columns and no NaNs;
* `len(df) == len(x_timestamp)` for every series;
* `len(y_timestamp) == pred_len` for every series;
* **all** series must share one lookback length and one prediction length.

### `generate(x, x_stamp, y_stamp, pred_len, T, top_k, top_p, sample_count, verbose) -> np.ndarray`

Lower level: takes already-normalised numpy arrays, returns
`(B, pred_len, d_in)`. Called by both public methods; use it directly only if you
are managing normalisation yourself.

---

## `Kronos`

`model/kronos.py`. The decoder-only transformer. Subclasses `nn.Module` and
`PyTorchModelHubMixin`, so `from_pretrained` / `save_pretrained` work against the
Hub or a local directory.

### `Kronos(s1_bits, s2_bits, n_layers, d_model, n_heads, ff_dim, ffn_dropout_p, attn_dropout_p, resid_dropout_p, token_dropout_p, learn_te)`

| Arg | Meaning |
| --- | --- |
| `s1_bits` / `s2_bits` | Bit widths of the coarse and fine tokens. Vocabularies are `2^s1_bits` and `2^s2_bits`. Must match the tokenizer. |
| `n_layers` | Transformer blocks. |
| `d_model` | Hidden width. |
| `n_heads` | Attention heads (`d_model % n_heads == 0`). |
| `ff_dim` | SwiGLU inner width. |
| `ffn_dropout_p`, `attn_dropout_p`, `resid_dropout_p`, `token_dropout_p` | Dropout rates. |
| `learn_te` | `True` → trainable calendar embeddings; `False` → frozen sinusoidal. |

Weights are initialised with Xavier-normal for `Linear`, `N(0, d_model^-0.5)` for
`Embedding`, ones/zeros for the norms.

You normally never construct this by hand — load a checkpoint:

```python
model = Kronos.from_pretrained("NeoQuasar/Kronos-base")
model = Kronos.from_pretrained("./outputs/models/finetune_predictor_demo/checkpoints/best_model")
```

### `forward(s1_ids, s2_ids, stamp=None, padding_mask=None, use_teacher_forcing=False, s1_targets=None)`

Full training-time forward pass.

* `s1_ids`, `s2_ids`: `(B, T)` int token ids.
* `stamp`: `(B, T, 5)` calendar features; added to the token embedding when given.
* `padding_mask`: `(B, T)` — see the polarity caveat in
  [ARCHITECTURE.md](./ARCHITECTURE.md#5-behavioural-notes-and-gotchas).
* `use_teacher_forcing`: condition the s2 head on `s1_targets` instead of a
  sampled `s1`. Set this during training.

**Returns** `(s1_logits, s2_logits)` of shapes `(B, T, 2^s1_bits)` and
`(B, T, 2^s2_bits)`.

### `decode_s1(s1_ids, s2_ids, stamp=None, padding_mask=None)`

Runs embedding + transformer + norm + s1 head. **Returns** `(s1_logits, context)`
where `context` is `(B, T, D)`. Splitting the pass this way lets the inference
loop sample `s1` and then compute `s2` without recomputing the stack.

### `decode_s2(context, s1_ids, padding_mask=None)`

Takes the `context` from `decode_s1` plus chosen `s1` ids, runs the
dependency-aware cross-attention and the conditional head. **Returns** `s2_logits`.

---

## `KronosTokenizer`

`model/kronos.py`. Transformer autoencoder with a BSQ bottleneck. Also a
`PyTorchModelHubMixin`.

### `KronosTokenizer(d_in, d_model, n_heads, ff_dim, n_enc_layers, n_dec_layers, ffn_dropout_p, attn_dropout_p, resid_dropout_p, s1_bits, s2_bits, beta, gamma0, gamma, zeta, group_size)`

| Arg | Meaning |
| --- | --- |
| `d_in` | Input features per bar (6 for OHLCV+amount). |
| `d_model`, `n_heads`, `ff_dim` | Transformer geometry. |
| `n_enc_layers`, `n_dec_layers` | Encoder/decoder depth. The code builds `n - 1` blocks each. |
| `s1_bits`, `s2_bits` | Coarse/fine bit split; `codebook_dim = s1_bits + s2_bits`. |
| `beta` | Commitment-loss weight. |
| `gamma0`, `gamma` | Per-sample and codebook entropy weights. |
| `zeta` | Overall entropy-penalty weight. |
| `group_size` | Bits per group for the entropy approximation; must divide `codebook_dim`. |

### `encode(x, half=False)`

`x`: `(B, T, d_in)` normalised features.

* `half=False` → one composite id tensor `(B, T)`.
* `half=True` → `[s1_ids, s2_ids]`, each `(B, T)`. This is what the predictor and
  both training pipelines use.

Metrics collection is disabled inside `encode`, so it is cheap.

### `decode(x, half=False)`

Inverse of `encode`. Accepts the same shapes and returns `(B, T, d_in)`.

### `forward(x)`

Training pass. **Returns** `((z_pre, z), bsq_loss, quantized, z_indices)`:

* `z_pre` — reconstruction from the coarse bits only, `(B, T, d_in)`;
* `z` — reconstruction from the full code, `(B, T, d_in)`;
* `bsq_loss` — commitment + entropy penalty, already weighted;
* `quantized` — the scaled bit vectors;
* `z_indices` — integer ids.

The tokenizer training loss combines both reconstructions:
`loss = (mse(z_pre, x) + mse(z, x) + bsq_loss) / 2`.

### `indices_to_bits(x, half=False)`

Unpacks integer ids into scaled bipolar bits in `{-1/√d, +1/√d}`. With
`half=True`, `x` is the `[s1_ids, s2_ids]` pair and each half is expanded over
`codebook_dim // 2` bits before concatenation — meaning the half path assumes
`s1_bits == s2_bits`.

---

## Module-level functions

### `auto_regressive_inference(tokenizer, model, x, x_stamp, y_stamp, max_context, pred_len, clip=5, T=1.0, top_k=0, top_p=0.99, sample_count=5, verbose=False) -> np.ndarray`

The generation loop. `x` is `(B, T, d_in)` **normalised** and on-device;
`x_stamp` `(B, T, 5)`; `y_stamp` `(B, pred_len, 5)`. Returns a numpy array
`(B, T', d_in)` where `T'` is the decoded window — the caller slices
`[-pred_len:]`. Runs under `torch.no_grad()`. Uses a rolling token buffer of
width `max_context` and averages across `sample_count` paths. Step-by-step
description in [ARCHITECTURE.md](./ARCHITECTURE.md#4-inference-auto_regressive_inference).

Note the defaults differ from `KronosPredictor.predict`: `top_p=0.99` and
`sample_count=5` here versus `0.9` and `1` there.

### `sample_from_logits(logits, temperature=1.0, top_k=None, top_p=None, sample_logits=True) -> torch.Tensor`

Temperature scaling → optional filtering → `multinomial` (or argmax when
`sample_logits=False`). Returns `(B, 1)` ids. Passing `top_k=None` together with
a `top_p` raises `TypeError`; pass `0`.

### `top_k_top_p_filtering(logits, top_k=0, top_p=1.0, filter_value=-inf, min_tokens_to_keep=1) -> torch.Tensor`

Standard Holtzman-style filtering. **Returns early after top-k**, so top-p is
skipped whenever `top_k > 0`. Returns `None` if neither branch triggers — the
only caller guards against that case.

### `calc_time_stamps(x_timestamp) -> pd.DataFrame`

Turns a datetime Series into the five integer columns
`minute, hour, weekday, day, month`, in that order. The order matters:
`TemporalEmbedding` indexes them positionally.

### `get_model_class(model_name)`

Registry lookup over `{'kronos_tokenizer', 'kronos', 'kronos_predictor'}`. Raises
`NotImplementedError` on an unknown name.

---

## Building blocks (`model/module.py`)

Reference for subclassing or reading tracebacks.

| Class | Role |
| --- | --- |
| `BinarySphericalQuantizer` | The BSQ implementation: sign quantisation with straight-through gradients, commitment loss, grouped soft-entropy penalty, index/code conversion helpers. |
| `BSQuantizer` | Thin wrapper. L2-normalises, calls BSQ, and packs bits into ids — one composite id, or a `[coarse, fine]` pair when `half=True`. |
| `DifferentiableEntropyFunction` / `codebook_entropy` | Custom autograd function for the hard-entropy path (used when `soft_entropy=False`). |
| `RMSNorm` | Root-mean-square normalisation; computed in fp32 and cast back. |
| `FeedForward` | SwiGLU: `w2(silu(w1 x) * w3 x)`, bias-free. |
| `RotaryPositionalEmbedding` | RoPE with a cached cos/sin table, invalidated on sequence-length change. |
| `MultiHeadAttentionWithRoPE` | Causal self-attention (`is_causal=True`) via `F.scaled_dot_product_attention`. |
| `MultiHeadCrossAttentionWithRoPE` | Cross-attention for the dependency-aware layer; `is_causal` tracks `self.training`. |
| `HierarchicalEmbedding` | Two embedding tables (coarse/fine), `sqrt(d_model)` scaling, concat + `fusion_proj`. `split_token` recovers the pair from a composite id. |
| `DependencyAwareLayer` | Cross-attends hidden states against the chosen coarse-token embedding, residual + RMSNorm. |
| `TransformerBlock` | Pre-norm block: RMSNorm → attention → residual → RMSNorm → FFN → residual. |
| `DualHead` | `proj_s1` / `proj_s2` output heads plus `compute_loss`, which returns `((ce_s1 + ce_s2)/2, ce_s1, ce_s2)`. |
| `FixedEmbedding` | Frozen sinusoidal table. |
| `TemporalEmbedding` | Sums minute/hour/weekday/day/month embeddings; fixed or learnable via `learn_pe`. |
