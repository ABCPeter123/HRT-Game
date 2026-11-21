# HRT Game: AlgoArena Sharpe research

This repository is for iterative research on the HRT AlgoArena **synthetic stock/news prediction** challenge.

## Objective and data contract

At the close of bar 49, predict the **market-adjusted close-49 to close-59 return** from a synthetic stock session. The competition takes a position equal to the submitted prediction and scores daily/session PnL as `prediction * return`.

**Primary score: `Sharpe = sqrt(252) * mean(session_pnl) / std(session_pnl)`**. The value is estimated on labelled data. Hidden out-of-sample Sharpe is unknown until a leaderboard submission.

Permitted inputs are only bars 0-49 (`open`, `high`, `low`, `close`) and `headlines` with `headline_bars` in that range. No future bars, future headlines, or out-of-sample labels are used.

## 1. Competition files are already here

The organiser's files are committed at the root of this repository, alongside the model:

```text
HRT-Game/
├── algoarena_sharpe_v3.py
├── sessions.py
├── ins_bars.parquet
├── ins_headlines.parquet
├── ins_returns.parquet
├── oos_bars.parquet
├── oos_headlines.parquet
├── notebooks/AlgoArena_v3.ipynb
└── tests/test_smoke.py
```

Use `git pull --ff-only origin main` if already cloned, then run:

```bash
python -m pip install -r requirements.txt
python algoarena_sharpe_v3.py --check-data
python algoarena_sharpe_v3.py
```

No separate download or `data/` directory is required. To use another location, pass `--data-dir PATH`. Keep all five parquet files together with `sessions.py`.

## 2. Run the first experiment

```bash
python algoarena_sharpe_v3.py --check-data
python algoarena_sharpe_v3.py
```

Run a validation-only experiment without generating the out-of-sample CSV:

```bash
python algoarena_sharpe_v3.py --no-submission
```

To name your run:

```bash
python algoarena_sharpe_v3.py --output-dir runs/experiment_01
```

By default, every run uses a **new timestamped folder** under `runs/` so historical diagnostics are preserved. `predictions.csv` is generated at the repository root for manual competition upload. **Creating the CSV does not spend one of the 10 submissions.**

You can also run [`notebooks/AlgoArena_v3.ipynb`](notebooks/AlgoArena_v3.ipynb) in Colab. It installs requirements, clones this repository, and uses data already in this repository.

## 3. Understand the output

Every successful experiment logs fold-by-fold and aggregate validation Sharpe, then audits the selected candidate on a held-out final 20% block (never used for model selection). The model is finally refit on all labelled sessions to generate out-of-sample predictions.

| Artifact | Contents |
|---|---|
| `run.log` | Running training status, selected parameters, audit Sharpe, warnings |
| `candidate_scores.csv` | All 24 evaluated configurations, validation Sharpe and stability |
| `fold_metrics.csv` | Per-fold Sharpe for every configuration |
| `report.json` | Machine-readable model selection, audit Sharpe, baselines, uncertainty |
| `audit_predictions.csv` | Audited positions, labelled returns and realized session PnL |
| `audit_breakdowns.csv` | Sharpe by observed-volatility bucket and position side |
| `audit_equity_curve.png` | Cumulative audit PnL, not a compounded investment account |
| `audit_pnl_distribution.png` | Session PnL distribution |
| `top_model_features.csv` | Highest-magnitude TF-IDF and numeric regression coefficients |

Additional reported metrics include observed target mean/std, prediction-return correlation, trade rate, average absolute position, hit rate, max cumulative PnL drawdown (in PnL units), bootstrap Sharpe interval, always-long/short and momentum baselines, and hypothetical transaction-cost stress tests. **Cost tests are not part of the competition score.**

The strategy uses TF-IDF headline features, observed-bar OHLC statistics, Ridge regression, and capped volatility-adjusted sizing. It evaluates 4 Ridge strengths × 3 signal thresholds × 2 volatility exponents across 3 expanding, index-ordered validation folds. The packet does not guarantee that session index represents chronology; these are blocked validation folds, **not verified market-time walk-forward tests**.

## 4. Iterate without misleading results

1. Compare the selected candidate's pooled validation Sharpe and three fold Sharpes against baselines.
2. Check the sealed audit **once** for each hypothesis. Do not repeatedly tune to that audit, which would contaminate it.
3. Diagnose market regimes, tail losses, and positional sizing using `audit_breakdowns.csv` and `audit_predictions.csv`.
4. Only consider a competition upload after the held-out results are credible. The official hidden OOS results are not available locally.
5. For the next model version, keep reports from this version and define a new hypothesis and genuinely untouched test data where possible.

## Development and tests

```bash
python -m pip install -r requirements.txt
python -m pytest -q
```

Tests use **synthetic fixtures only**, verify the interface and output format, and cannot establish performance on the actual competition dataset.

Read [`docs/EXPERIMENT_PROTOCOL.md`](docs/EXPERIMENT_PROTOCOL.md) for the fuller evaluation protocol.
## Headline sentiment model (v4)

This version adds a transparent financial-news sentiment score, recency-weighted
headline features, learned word/phrase n-grams and character n-grams. Instead of
assuming news helps, the model compares **price-only**, **sentiment-only** and
**combined** signals on the same three validation folds, choosing by stability-
adjusted Sharpe. The final 20% labelled audit remains outside model selection.

```bash
python -m pip install -r requirements.txt
python algoarena_sentiment_v4.py
```

The new script prints fold Sharpe, model-family ablations, final audit Sharpe,
bootstrap confidence interval, drawdown and top learned words. It creates
`predictions.csv` with the competition's official `sessions.write_submission`
function and saves all reports under `runs/`. Creating the CSV does not use
a leaderboard upload. A GitHub Actions workflow runs the model on the committed
labelled data and saves diagnostics, without submitting predictions.

The target Sharpe is **3.65**. It is a research target, not an assumed result.
Strong validation alone does not establish hidden out-of-sample performance.

Colab users can open `notebooks/AlgoArena_Sentiment_v4.ipynb`.

The short, readable entry point for the final CSV is `python make_submission.py`.
It calls the validated v4 pipeline and writes `predictions.csv`; it does not upload it.

### Measured model comparison on 10,000 labelled sessions

| Experiment | Three-fold validation Sharpe | Exploratory audit Sharpe |
|---|---:|---:|
| v4 finance dictionary + TF-IDF | 2.053 | 2.042 |
| **v5 structured news + numeric financial surprises** | **2.375** | **2.470** |
| v6 repeated-company relevance | 2.243 | 2.279 |

The v5 experiment is the selected model, based on its higher validation Sharpe.
The audit values are exploratory diagnostics, not official hidden-out-of-sample
results. Subsequent experimentation against these same audit observations does
not constitute a fresh sealed test.

**Recommended commands:**

```bash
git pull --ff-only origin main
python -m pip install -r requirements.txt
python make_submission.py
```

Use [notebooks/AlgoArena_Sentiment_v5.ipynb](notebooks/AlgoArena_Sentiment_v5.ipynb)
for Google Colab. The short `make_submission.py` file calls the validated v5
pipeline, produces `predictions.csv`, and prints validation/audit Sharpe. It
does not upload to AlgoArena. Each run retains a timestamped diagnostics
folder. Do not use one of the limited official uploads solely because the CSV
exists.

**3.65 Sharpe remains a target.** The best exploratory audit reached 2.470.
The official hidden-test Sharpe is unknown.


## Python compatibility and optional charts

Use Python 3.11 and install from `requirements.txt`, which pins NumPy to the 1.x ABI to avoid older compiled extensions failing against NumPy 2. By default the model always produces Sharpe logs, CSV metrics and `predictions.csv`, but skips Matplotlib charts. To request PNG charts after installing a compatible Matplotlib build, set `ALGOARENA_PLOTS=1` before running.

If an existing Windows Python environment has the incompatible NumPy 2 / Matplotlib combination, create a fresh virtual environment:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe make_submission.py
```
