"""Synthetic fixture tests. These do not measure competition performance."""
from __future__ import annotations

import types
import numpy as np
import pandas as pd
import algoarena_sharpe_v3 as model


def fake_dataset(n, seed=2026):
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(n):
        s = 1 if k % 2 == 0 else -1
        close = np.exp(np.cumsum(np.r_[0.0, rng.normal(0, .007, 49)]))
        opening = close * np.exp(rng.normal(0, .002, 50))
        high = np.maximum(close, opening) + .003
        low = np.minimum(close, opening) - .003
        rows.append({
            "open": opening, "high": high, "low": low, "close": close,
            "headlines": ["company secures new contract" if s > 0 else "company faces declining revenue"],
            "headline_bars": [int(rng.integers(0, 50))],
            "returns": .01 * s + float(rng.normal(0, .015)),
        })
    return pd.DataFrame(rows)


def test_features_ignore_future_bars():
    row = fake_dataset(1).iloc[0].copy()
    original = model.feature_row(row)
    for name in ("open", "high", "low", "close"):
        row[name] = np.r_[row[name], np.full(50, 10_000.0)]
    updated = model.feature_row(row)
    np.testing.assert_allclose(original[0], updated[0])
    assert original[1:3] == updated[1:3]


def test_data_discovery_requires_official_files(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    (data / "sessions.py").write_text("# synthetic fixture")
    for name in ("ins_bars.parquet", "ins_headlines.parquet", "ins_returns.parquet",
                 "oos_bars.parquet", "oos_headlines.parquet"):
        (data / name).write_bytes(b"fixture")
    assert model.find_competition_data(data) == data.resolve()
    (data / "ins_returns.parquet").unlink()
    import pytest
    with pytest.raises(FileNotFoundError):
        model.find_competition_data(data)


def test_pipeline_exports_sharpe_reports_and_submission(tmp_path, monkeypatch):
    ins = fake_dataset(260)
    oos = fake_dataset(18, 42).drop(columns=["returns"])
    competition = types.SimpleNamespace()
    competition.get_ins_data = lambda: ins

    def get_oos_predictions(predictor):
        out = oos.copy()
        out["pred"] = [predictor(row) for _, row in oos.iterrows()]
        return out

    competition.get_oos_predictions = get_oos_predictions
    competition.get_oos_data = lambda: oos

    def write_submission(prediction_df, path):
        pd.DataFrame({
            "headline_id": np.arange(len(prediction_df)),
            "pred": prediction_df["pred"],
        }).to_csv(path, index=False)

    competition.write_submission = write_submission
    monkeypatch.setattr(model, "PROJECT_ROOT", tmp_path)
    report_dir = tmp_path / "runs" / "synthetic"
    report = model.run_pipeline(sessions_module=competition, output_dir=report_dir)

    assert np.isfinite(report["audit"]["sharpe"])
    for name in (
        "run.log", "report.json", "candidate_scores.csv", "fold_metrics.csv",
        "audit_predictions.csv", "audit_breakdowns.csv", "top_model_features.csv",
        "audit_equity_curve.png", "audit_pnl_distribution.png",
    ):
        assert (report_dir / name).exists(), name
    candidates = pd.read_csv(report_dir / "candidate_scores.csv")
    assert len(candidates) == 24
    submission = pd.read_csv(tmp_path / "predictions.csv")
    assert list(submission.columns) == ["headline_id", "pred"]
    assert len(submission) == len(oos)
    assert np.isfinite(submission["pred"]).all()
