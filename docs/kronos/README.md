# Kronos — documentation

Documentation for [**Kronos**](https://github.com/shiyu-coder/Kronos), an open-source
foundation model for financial candlesticks (K-lines).

> **Provenance.** These documents describe the upstream repository
> `shiyu-coder/Kronos` at commit `67b630e67f6a18c9e9be918d9b4337c960db1e9a`.
> Kronos is a third-party project licensed under the MIT License
> (Copyright © 2025 ShiYu). Nothing in this folder is Kronos source code — it is
> reference documentation written against that code. Paper:
> [arXiv:2508.02739](https://arxiv.org/abs/2508.02739) (AAAI 2026).

## Contents

| Doc | Contents |
| --- | --- |
| [OVERVIEW.md](./OVERVIEW.md) | What Kronos is, model zoo, repository layout, dependencies |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Two-stage design: BSQ tokenizer, hierarchical tokens, decoder-only transformer, sampling loop |
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Install, first forecast, batch forecasting, parameter tuning |
| [API_REFERENCE.md](./API_REFERENCE.md) | Every public class and function in `model/` with signatures, shapes and failure modes |
| [FINETUNING.md](./FINETUNING.md) | Both fine-tuning pipelines: Qlib (`finetune/`) and custom CSV (`finetune_csv/`) |
| [WEB_UI.md](./WEB_UI.md) | The Flask web UI: how to run it, HTTP endpoint reference |
| [EXAMPLES.md](./EXAMPLES.md) | Catalogue of the `examples/` scripts and what each one demonstrates |
| [TESTING.md](./TESTING.md) | Regression test suite, fixtures, and how to regenerate them |

## Where to start

* **"I want a forecast in ten minutes."** → [GETTING_STARTED.md](./GETTING_STARTED.md)
* **"How does the model actually work?"** → [ARCHITECTURE.md](./ARCHITECTURE.md)
* **"What does this argument do?"** → [API_REFERENCE.md](./API_REFERENCE.md)
* **"I have my own data."** → [FINETUNING.md](./FINETUNING.md)

## Scope and disclaimer

Kronos forecasts OHLCV series. It is a research model, not a trading system. The
backtesting code shipped upstream (`finetune/qlib_test.py`, the scripts under
`examples/`) is demonstration-grade: it does not model slippage, market impact,
or risk-factor neutralisation. Treat any reported return figure as an upper bound
produced under idealised assumptions.
