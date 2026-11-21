"""AlgoArena Sharpe-first experiment (v3).

Run with the competition-provided sessions.py and ins_*/oos_* parquet files:
    python algoarena_sharpe_v3.py --data-dir data

Saves all validation, audit, and feature diagnostics in runs/latest.
Never reads bars 50+ or out-of-sample labels. Creates predictions.csv locally;
submissions to the competition website remain manual.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import os
import sys
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

SEED = 42
PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = PROJECT_ROOT / "runs" / "latest"


def default_run_dir():
    """Make experiments independently auditable across model iterations."""
    return PROJECT_ROOT / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
ALPHAS = (0.1, 1.0, 10.0, 100.0)
THRESHOLDS = (0.0, 0.25, 0.50)
VOL_EXPONENTS = (0.0, 0.5)
NUMERIC_WEIGHT = 0.35
MAX_POSITION = 3.0
MIN_TRADE_RATE = 0.08

NUMERIC_NAMES = (
    [f"log_momentum_{w}" for w in (1, 2, 3, 5, 10, 20, 49)]
    + [f"log_return_{k}_{w}" for w in (5, 10, 20, 49)
       for k in ("mean", "std", "min", "max")]
    + [f"candle_{k}_{w}" for w in (5, 10, 20, 50)
       for k in ("range", "body", "close_position")]
    + ["headline_count", "headlines_last_15", "headlines_last_5"]
    + [f"headlines_last_{w}" for w in (5, 10, 20, 50)]
)

LOG = logging.getLogger("algoarena")


def configure_logging(output_dir):
    global OUTPUT_DIR
    OUTPUT_DIR = Path(output_dir).resolve()
    OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
    LOG.setLevel(logging.INFO)
    LOG.handlers.clear()
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", "%H:%M:%S")
    for handler in (logging.StreamHandler(), logging.FileHandler(OUTPUT_DIR / "run.log", mode="w")):
        handler.setFormatter(formatter)
        LOG.addHandler(handler)
    LOG.propagate = False


def find_competition_data(data_dir=None):
    """Find official data files, without assuming that they are committed to GitHub."""
    if data_dir is not None:
        candidates = [Path(data_dir).expanduser().resolve()]
    else:
        candidates = [PROJECT_ROOT / "data", PROJECT_ROOT, Path.cwd() / "data",
                      Path.cwd(), Path("/content"), Path("/content/HRT-Game/data")]
    for folder in candidates:
        if (folder / "sessions.py").is_file() and list(folder.glob("ins_*.parquet")) and list(folder.glob("oos_*.parquet")):
            return folder.resolve()
    raise FileNotFoundError(
        "Competition files not found. Place sessions.py, ins_*.parquet, and "
        "oos_*.parquet together in ./data/ or supply --data-dir PATH. "
        "See README.md for the download command. Search paths: "
        + ", ".join(str(p) for p in candidates))


def import_competition_sessions(data_dir):
    """Import the organiser's actual sessions.py, not our synthetic test module."""
    target = Path(data_dir) / "sessions.py"
    spec = importlib.util.spec_from_file_location("sessions", target)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load {target}")
    folder = str(Path(data_dir).resolve())
    if folder not in sys.path:
        sys.path.insert(0, folder)
    module = importlib.util.module_from_spec(spec)
    sys.modules["sessions"] = module
    spec.loader.exec_module(module)
    return module


def feature_row(row):
    """Returns numeric/text/vol features using ONLY bars 0 through 49."""
    close = np.asarray(row["close"], dtype=float)[:50]
    high = np.asarray(row["high"], dtype=float)[:50]
    low = np.asarray(row["low"], dtype=float)[:50]
    opened = np.asarray(row["open"], dtype=float)[:50]
    if any(len(x) != 50 for x in (close, high, low, opened)):
        raise ValueError("Each OHLC array must contain 50 observed bars")
    close = np.maximum(close, 1e-9)
    log_price = np.log(close)
    log_r = np.diff(log_price)
    features = []
    for horizon in (1, 2, 3, 5, 10, 20, 49):
        features.append(log_price[-1] - log_price[-1 - horizon])
    for window in (5, 10, 20, 49):
        values = log_r[-window:]
        features.extend((np.mean(values), np.std(values), np.min(values), np.max(values)))
    for window in (5, 10, 20, 50):
        h, l, o, c = high[-window:], low[-window:], opened[-window:], close[-window:]
        features.extend((
            np.mean((h - l) / np.maximum(c, 1e-9)),
            np.mean((c - o) / np.maximum(o, 1e-9)),
            (close[-1] - np.min(l)) / max(np.max(h) - np.min(l), 1e-9),
        ))
    headlines = [str(h) for h in row["headlines"]]
    bars = [int(b) for b in row["headline_bars"]]
    if len(headlines) != len(bars):
        raise ValueError("headlines and headline_bars must have equal lengths")
    if any(b < 0 or b > 49 for b in bars):
        raise ValueError("Found news timestamp outside the permitted bars 0..49")
    features.extend((len(headlines), sum(b >= 35 for b in bars), sum(b >= 45 for b in bars)))
    features.extend(sum(b >= 50 - w for b in bars) for w in (5, 10, 20, 50))
    all_news = " ".join(headlines) or "no_headline"
    recent_news = " ".join(h for h, b in zip(headlines, bars) if b >= 35) or "no_recent_headline"
    observed_vol = max(float(np.std(log_r[-20:])), 1e-5)
    numeric = np.clip(np.nan_to_num(np.asarray(features, dtype=float), nan=0, posinf=0, neginf=0), -100, 100)
    assert len(numeric) == len(NUMERIC_NAMES), (len(numeric), len(NUMERIC_NAMES))
    return numeric, all_news, recent_news, observed_vol


class Encoder:
    def __init__(self):
        self.scaler = StandardScaler()
        self.all_vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=16000,
                                       sublinear_tf=True, strip_accents="unicode")
        self.recent_vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=8000,
                                          sublinear_tf=True, strip_accents="unicode")

    @staticmethod
    def unpack(examples):
        numeric, all_news, recent_news, vols = zip(*examples)
        return np.stack(numeric), list(all_news), list(recent_news), np.asarray(vols)

    def fit_transform(self, examples):
        numeric, all_news, recent_news, vols = self.unpack(examples)
        x = hstack((csr_matrix(self.scaler.fit_transform(numeric) * NUMERIC_WEIGHT),
                    self.all_vec.fit_transform(all_news),
                    self.recent_vec.fit_transform(recent_news)), format="csr")
        return x, vols

    def transform(self, examples):
        numeric, all_news, recent_news, vols = self.unpack(examples)
        x = hstack((csr_matrix(self.scaler.transform(numeric) * NUMERIC_WEIGHT),
                    self.all_vec.transform(all_news),
                    self.recent_vec.transform(recent_news)), format="csr")
        return x, vols

    def feature_names(self):
        return list(NUMERIC_NAMES) + ["news:" + s for s in self.all_vec.get_feature_names_out()] + [
            "recent:" + s for s in self.recent_vec.get_feature_names_out()]


def predict_positions(raw, vols, scale, reference_vol, threshold, vol_exp):
    """Translate return forecasts into bounded positions, using training-only calibration."""
    raw = np.asarray(raw, dtype=float)
    vols = np.asarray(vols, dtype=float)
    magnitude = np.maximum(np.abs(raw) / max(float(scale), 1e-12) - threshold, 0.0)
    risk_weight = np.clip(reference_vol / np.maximum(vols, 1e-5), 0.5, 2.0) ** vol_exp
    return np.clip(np.sign(raw) * magnitude * risk_weight, -MAX_POSITION, MAX_POSITION)


def sharpe(pnl):
    pnl = np.asarray(pnl, dtype=float)
    if len(pnl) < 2 or np.std(pnl) < 1e-12:
        return 0.0
    return float(np.sqrt(252.0) * np.mean(pnl) / np.std(pnl))


def metrics(position, y, cost_bps=0.0):
    p = np.asarray(position, dtype=float)
    y = np.asarray(y, dtype=float)
    pnl = p * y
    # Hypothetical two-way execution fee, not part of the official scorer.
    if cost_bps:
        pnl = pnl - 2 * np.abs(p) * cost_bps / 10000.0
    active = np.abs(p) > 1e-12
    equity = np.r_[0, np.cumsum(pnl)]
    dd = equity - np.maximum.accumulate(equity)
    corr = (float(np.corrcoef(p, y)[0, 1])
            if np.std(p) > 1e-12 and np.std(y) > 1e-12 else 0.0)
    return dict(
        n=int(len(y)), sharpe=sharpe(pnl), total_pnl=float(np.sum(pnl)),
        mean_pnl=float(np.mean(pnl)), pnl_std=float(np.std(pnl)),
        max_drawdown_pnl_units=float(-np.min(dd)),
        worst_session_pnl=float(np.min(pnl)), best_session_pnl=float(np.max(pnl)),
        trade_rate=float(np.mean(active)), avg_abs_position=float(np.mean(np.abs(p))),
        position_return_correlation=corr,
        hit_rate_active=float(np.mean(pnl[active] > 0)) if active.any() else 0.0,
        mean_label_when_long=float(np.mean(y[p > 0])) if (p > 0).any() else None,
        mean_label_when_short=float(np.mean(y[p < 0])) if (p < 0).any() else None,
    )


def bootstrap_ci_sharpe(pnl, repetitions=1000):
    """I.I.D. session bootstrap. Indicative only; does not account for dependence."""
    pnl = np.asarray(pnl, dtype=float)
    if len(pnl) < 10:
        return [None, None]
    rng = np.random.default_rng(SEED)
    sample_ix = rng.integers(0, len(pnl), size=(repetitions, len(pnl)))
    samples = pnl[sample_ix]
    st = samples.std(axis=1)
    vals = np.sqrt(252) * samples.mean(axis=1) / np.maximum(st, 1e-12)
    return [float(v) for v in np.quantile(vals, [0.025, 0.975])]


def folds_for(n):
    """Three expanding-window validations and a sealed last-20% audit.
    We do not assert that session indexes represent chronology; block splits
    avoid random mixing even if the dataset happens to be ordered.
    """
    if n < 200:
        raise ValueError("Need at least 200 labelled sessions for this validation protocol")
    audit_start = int(n * 0.8)
    start_train = int(audit_start * 0.4)
    boundaries = [start_train + int((audit_start - start_train) * i / 3) for i in range(4)]
    fold_defs = [(np.arange(boundaries[i]), np.arange(boundaries[i], boundaries[i+1]))
                 for i in range(3)]
    return fold_defs, np.arange(audit_start), np.arange(audit_start, n)


def summarize_selection(rows):
    records = []
    for (alpha, threshold, vol_exp), group in rows.groupby(["alpha", "threshold", "vol_exp"], sort=True):
        # Combine out-of-fold predictions to avoid selecting from only one session block.
        joined = pd.concat(group["oof"].tolist(), ignore_index=True)
        scores = list(group["fold_sharpe"])
        m = metrics(joined["position"], joined["label"])
        # Small stability penalty; primary objective remains OOF Sharpe.
        criterion = m["sharpe"] - 0.2 * float(np.std(scores))
        if m["trade_rate"] < MIN_TRADE_RATE:
            criterion -= 5.0  # Avoid pathological sparse forecasts.
        records.append(dict(alpha=float(alpha), threshold=float(threshold), vol_exp=float(vol_exp),
                            oof_sharpe=m["sharpe"], selection_score=criterion,
                            mean_fold_sharpe=float(np.mean(scores)),
                            min_fold_sharpe=float(np.min(scores)),
                            std_fold_sharpe=float(np.std(scores)),
                            positive_folds=int(sum(s > 0 for s in scores)),
                            trade_rate=m["trade_rate"], avg_abs_position=m["avg_abs_position"],
                            fold_sharpes=[float(s) for s in scores]))
    results = pd.DataFrame(records).sort_values("selection_score", ascending=False).reset_index(drop=True)
    return results


def explain_coefficients(encoder, model):
    names = encoder.feature_names()
    coefficients = np.asarray(model.coef_).ravel()
    top_ix = np.argsort(np.abs(coefficients))[::-1][:35]
    frame = pd.DataFrame({"feature": [names[i] for i in top_ix],
                          "coefficient": [float(coefficients[i]) for i in top_ix]})
    frame.to_csv(OUTPUT_DIR / "top_model_features.csv", index=False)
    LOG.info("Top learned coefficients (predictive associations, not causal evidence):")
    for _, row in frame.head(12).iterrows():
        LOG.info("  %+.6f  %s", row["coefficient"], row["feature"])


def plot_audit(preds):
    try:
        import matplotlib.pyplot as plt
        pnl = preds["pnl"].to_numpy()
        equity = np.r_[0, pnl.cumsum()]
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.plot(equity)
        ax.set(title="Sealed audit: cumulative session PnL", xlabel="Audit session", ylabel="Cumulative PnL (unit positions × returns)")
        fig.tight_layout()
        fig.savefig(OUTPUT_DIR / "audit_equity_curve.png", dpi=140)
        plt.close(fig)
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.hist(pnl, bins=50)
        ax.set(title="Sealed audit: distribution of session PnL", xlabel="Session PnL", ylabel="Frequency")
        fig.tight_layout()
        fig.savefig(OUTPUT_DIR / "audit_pnl_distribution.png", dpi=140)
        plt.close(fig)
    except ImportError:
        LOG.warning("matplotlib is not installed; skipped the diagnostic plots")


def run_pipeline(create_submission=True, data_dir=None, output_dir=None, sessions_module=None):
    """Run an experiment, including an untouched audit and optional OOS export.

    sessions_module is injectable solely for local synthetic-data tests.
    In actual usage, load the organisers' official sessions.py.
    """
    configure_logging(output_dir or default_run_dir())
    if sessions_module is None:
        data_dir = find_competition_data(data_dir)
        LOG.info("DATA SOURCE | %s", data_dir)
        sessions = import_competition_sessions(data_dir)
        # The organiser's loader may resolve parquet paths against the working directory.
        os.chdir(data_dir)
    else:
        sessions = sessions_module
        LOG.info("DATA SOURCE | supplied test adapter (synthetic tests only)")
    df = sessions.get_ins_data()
    needed = {"open", "high", "low", "close", "headlines", "headline_bars", "returns"}
    if not needed.issubset(df.columns):
        raise ValueError("Missing columns in competition dataset: " + str(sorted(needed - set(df.columns))))
    y = df["returns"].to_numpy(dtype=float)
    if not np.isfinite(y).all():
        raise ValueError("Training labels contain non-finite returns")
    examples = [feature_row(row) for _, row in df.iterrows()]
    observed_vols = np.array([e[3] for e in examples])
    LOG.info("DATA | %s labelled sessions; %s news headlines; target mean=%+.6f std=%.6f",
             f"{len(y):,}", f"{sum(len(r['headlines']) for _, r in df.iterrows()):,}", np.mean(y), np.std(y))
    LOG.info("RULES | PnL=prediction * market-adjusted return; annualized Sharpe=sqrt(252)*mean(PnL)/std(PnL)")
    LOG.info("LIMITS | Only observed OHLC/news bars 0-49; target return 49->59; no hidden OOS targets")
    LOG.info("VALIDATION | Blocked expanding splits (index chronology NOT guaranteed), 3 folds + final untouched 20% audit")
    fold_defs, development_idx, audit_idx = folds_for(len(y))
    all_records = []
    for fold_id, (train_idx, val_idx) in enumerate(fold_defs, 1):
        LOG.info("FOLD %d/3 | train rows [0:%d), validate rows [%d:%d)",
                 fold_id, len(train_idx), val_idx[0], val_idx[-1] + 1)
        encoder = Encoder()
        x_train, v_train = encoder.fit_transform([examples[i] for i in train_idx])
        x_val, v_val = encoder.transform([examples[i] for i in val_idx])
        ref_vol = float(np.median(v_train))
        by_fold = []
        for alpha in ALPHAS:
            model = Ridge(alpha=alpha, solver="lsqr")
            model.fit(x_train, y[train_idx])
            raw_train = model.predict(x_train)
            scale = max(float(np.mean(np.abs(raw_train))), 1e-8)
            raw_val = model.predict(x_val)
            for threshold in THRESHOLDS:
                for vol_exp in VOL_EXPONENTS:
                    position = predict_positions(raw_val, v_val, scale, ref_vol, threshold, vol_exp)
                    score = metrics(position, y[val_idx])
                    oof = pd.DataFrame({"session_idx": val_idx, "label": y[val_idx],
                                        "position": position})
                    all_records.append(dict(fold=fold_id, alpha=alpha, threshold=threshold,
                                            vol_exp=vol_exp, fold_sharpe=score["sharpe"],
                                            oof=oof))
                    by_fold.append((score["sharpe"], alpha, threshold, vol_exp))
        by_fold.sort(reverse=True)
        LOG.info("FOLD %d | best Sharpe=%+.3f config=%s | always-long=%+.3f",
                 fold_id, by_fold[0][0], by_fold[0][1:], sharpe(y[val_idx]))

    group = pd.DataFrame(all_records)
    group.drop(columns=["oof"]).to_csv(OUTPUT_DIR / "fold_metrics.csv", index=False)
    selection_table = summarize_selection(group)
    flattened = selection_table.drop(columns=["fold_sharpes"])
    flattened.to_csv(OUTPUT_DIR / "candidate_scores.csv", index=False)
    LOG.info("SELECTION | top configurations by validation Sharpe minus fold-instability penalty")
    LOG.info("\n%s", flattened.head(10).to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    best = selection_table.iloc[0]
    alpha = float(best["alpha"])
    threshold = float(best["threshold"])
    vol_exp = float(best["vol_exp"])
    LOG.info("SELECTED | alpha=%s, threshold=%.2f, volatility exponent=%.1f", alpha, threshold, vol_exp)
    LOG.info("VALIDATION | OOF Sharpe=%+.3f | fold Sharpes=%s | trade rate=%.1f%%",
             best["oof_sharpe"], np.round(best["fold_sharpes"], 3).tolist(), best["trade_rate"] * 100)

    # Sealed audit: NO candidate or parameter changes based on these metrics.
    encoder = Encoder()
    x_dev, vol_dev = encoder.fit_transform([examples[i] for i in development_idx])
    x_audit, vol_audit = encoder.transform([examples[i] for i in audit_idx])
    model = Ridge(alpha=alpha, solver="lsqr").fit(x_dev, y[development_idx])
    explain_coefficients(encoder, model)
    scale = max(float(np.mean(np.abs(model.predict(x_dev)))), 1e-8)
    position = predict_positions(model.predict(x_audit), vol_audit, scale,
                                 float(np.median(vol_dev)), threshold, vol_exp)
    audit_metrics = metrics(position, y[audit_idx])
    audit_pnl = position * y[audit_idx]
    audit_metrics["sharpe_bootstrap_95pct_ci"] = bootstrap_ci_sharpe(audit_pnl)
    audit_metrics["sharpe_with_hypothetical_5bps_each_side"] = metrics(position, y[audit_idx], 5)["sharpe"]
    audit_metrics["sharpe_with_hypothetical_20bps_each_side"] = metrics(position, y[audit_idx], 20)["sharpe"]
    baseline = dict(always_long=metrics(np.ones_like(position), y[audit_idx]),
                    always_short=metrics(-np.ones_like(position), y[audit_idx]),
                    momentum_10=metrics(np.sign(np.array([e[0][4] for e in examples])[audit_idx]), y[audit_idx]))
    audit_frame = pd.DataFrame({"session_idx": audit_idx, "label": y[audit_idx],
                                "position": position, "pnl": audit_pnl, "observed_vol": observed_vols[audit_idx]})
    audit_frame.to_csv(OUTPUT_DIR / "audit_predictions.csv", index=False)
    # Diagnose which conditions the model handles well or badly without using
    # these diagnostics to reselect parameters on the sealed audit set.
    audit_frame["volatility_bucket"] = pd.qcut(audit_frame["observed_vol"].rank(method="first"), 4,
                                                  labels=["Q1_low", "Q2", "Q3", "Q4_high"])
    audit_frame["position_side"] = np.where(audit_frame["position"] > 1e-12, "LONG",
                                            np.where(audit_frame["position"] < -1e-12, "SHORT", "FLAT"))
    breakdown_rows = []
    for dimension in ("volatility_bucket", "position_side"):
        for name, sub in audit_frame.groupby(dimension, observed=True):
            breakdown_rows.append({"dimension": dimension, "bucket": str(name),
                                   **metrics(sub["position"], sub["label"])})
    pd.DataFrame(breakdown_rows).to_csv(OUTPUT_DIR / "audit_breakdowns.csv", index=False)
    LOG.info("AUDIT BREAKDOWN | Sharpe by observed-volatility quartile:")
    for row in breakdown_rows:
        if row["dimension"] == "volatility_bucket":
            LOG.info("  %-8s sharpe=%+7.3f avg |pos|=%.3f active win rate=%.1f%%",
                     row["bucket"], row["sharpe"], row["avg_abs_position"], row["hit_rate_active"] * 100)
    LOG.info("AUDIT WORST | five largest losses (session index / PnL): %s",
             [(int(i), round(float(v), 5)) for i, v in
              zip(audit_frame.nsmallest(5, "pnl")["session_idx"],
                  audit_frame.nsmallest(5, "pnl")["pnl"])])
    plot_audit(audit_frame)
    LOG.info("SEALED AUDIT | Sharpe=%+.3f | bootstrap CI [%+.3f, %+.3f] | long baseline=%+.3f | momentum baseline=%+.3f",
             audit_metrics["sharpe"], *audit_metrics["sharpe_bootstrap_95pct_ci"],
             baseline["always_long"]["sharpe"], baseline["momentum_10"]["sharpe"])
    LOG.info("AUDIT DETAIL | PnL total=%+.5f, std=%.6f, max cumulative PnL drawdown=%.5f, corr=%+.4f",
             audit_metrics["total_pnl"], audit_metrics["pnl_std"],
             audit_metrics["max_drawdown_pnl_units"], audit_metrics["position_return_correlation"])
    LOG.info("AUDIT DETAIL | trade rate=%.1f%%, avg absolute position=%.3f, active win rate=%.1f%%",
             100 * audit_metrics["trade_rate"], audit_metrics["avg_abs_position"],
             100 * audit_metrics["hit_rate_active"])
    LOG.info("COST STRESS | hypothetical 5bps/side Sharpe=%+.3f; 20bps/side Sharpe=%+.3f (NOT official scoring)",
             audit_metrics["sharpe_with_hypothetical_5bps_each_side"],
             audit_metrics["sharpe_with_hypothetical_20bps_each_side"])

    report = dict(
        label="AlgoArena baseline v2, Sharpe-first, blocked validation, sealed audit",
        rules={"target": "market-adjusted close49 to close59 return",
               "pnl": "position times return", "sharpe_annualization": 252,
               "notes": ["Session order is not documented as chronological; splits are ordered by row index.",
                         "5/20bps execution costs are hypothetical diagnostics, not official contest scoring.",
                         "Bootstrap confidence interval assumes independent sessions."]},
        n_samples=int(len(y)), data_dir=str(data_dir) if data_dir is not None else None, selection={k: (v.item() if hasattr(v, "item") else v)
                                           for k, v in best.drop(labels=["fold_sharpes"]).to_dict().items()},
        fold_sharpes=best["fold_sharpes"], audit=audit_metrics, baselines=baseline,
    )
    (OUTPUT_DIR / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False))

    # Important: audit is reported once. Do NOT tune on audit. Train final
    # contest model on all labelled sessions with the frozen winning config.
    if create_submission:
        LOG.info("FINAL FIT | Refit selected model on ALL %s labelled sessions", f"{len(y):,}")
        final_encoder = Encoder()
        x_full, v_full = final_encoder.fit_transform(examples)
        final_model = Ridge(alpha=alpha, solver="lsqr").fit(x_full, y)
        full_scale = max(float(np.mean(np.abs(final_model.predict(x_full)))), 1e-8)
        full_ref_vol = float(np.median(v_full))
        explain_coefficients(final_encoder, final_model)

        def my_prediction(row):
            x, vols = final_encoder.transform([feature_row(row)])
            raw = final_model.predict(x)
            return float(predict_positions(raw, vols, full_scale, full_ref_vol,
                                           threshold, vol_exp)[0])

        oos = sessions.get_oos_predictions(my_prediction)
        if "pred" not in oos.columns or not np.isfinite(oos["pred"].to_numpy(dtype=float)).all():
            raise ValueError("Out-of-sample predictions are missing or non-finite")
        submission_path = PROJECT_ROOT / "predictions.csv"
        sessions.write_submission(prediction_df=oos, path=str(submission_path))
        LOG.info("SUBMISSION PATH | %s", submission_path)
        LOG.info("SUBMISSION | predictions.csv (%d rows, min=%+.3f, max=%+.3f, nonzero=%.1f%%)",
                 len(oos), float(oos["pred"].min()), float(oos["pred"].max()),
                 100 * float(np.mean(np.abs(oos["pred"]) > 1e-12)))
        LOG.info("UPLOAD | Manual only. Hidden OOS Sharpe is UNKNOWN until official leaderboard scores it.")
    if audit_metrics["sharpe"] <= 0:
        LOG.warning("AUDIT SHARPE <= 0. Recommend revising the model BEFORE spending one of 10 leaderboard submissions.")
    elif audit_metrics["sharpe"] < baseline["momentum_10"]["sharpe"]:
        LOG.warning("Model trails the naive momentum audit baseline; investigate before uploading.")
    LOG.info("DEBUG FILES | %s", OUTPUT_DIR.resolve())
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sharpe-first AlgoArena research and submission")
    parser.add_argument("--data-dir", type=Path, default=None, help="Directory containing sessions.py and parquet data")
    parser.add_argument("--output-dir", type=Path, default=None, help="Run report directory; default is a new timestamped runs/ folder")
    parser.add_argument("--no-submission", action="store_true", help="Evaluate without generating predictions.csv")
    parser.add_argument("--check-data", action="store_true", help="Show the data directory found and exit")
    args = parser.parse_args()
    if args.check_data:
        data_path = find_competition_data(args.data_dir)
        print("Competition files found:", data_path)
        for file in sorted(data_path.iterdir()):
            if file.name == "sessions.py" or file.suffix == ".parquet":
                print(" ", file.name, "(%d bytes)" % file.stat().st_size)
    else:
        run_pipeline(create_submission=not args.no_submission, data_dir=args.data_dir, output_dir=args.output_dir)