from pathlib import Path
import argparse
import json
import re
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix, hstack
from scipy.stats import rankdata
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

import sessions
from algoarena_sentiment_v5 import Encoder, feature_row

verbs = ["secures", "reports", "beats", "misses", "raises", "cuts", "faces", "warns",
         "recalls", "withdraws", "delays", "launches", "announces", "completes",
         "wins", "loses", "files", "expands", "sees", "confirms"]
words = [re.compile(r"\b" + x + r"\b", re.I) for x in verbs]
alphas = [0.5, 5, 50]
biases = [0, 0.2, 0.5]
sizers = ["rank", "raw"]
risks = [0, 0.5]


def features(row):
    c = np.asarray(row["close"], dtype=float)[:50]
    h = np.asarray(row["high"], dtype=float)[:50]
    l = np.asarray(row["low"], dtype=float)[:50]
    out = []
    for n in [5, 10, 20, 50]:
        x = c[-n:]
        lo, hi = float(x.min()), float(x.max())
        spread = max(hi - lo, 1e-9)
        out += [(c[-1] - lo) / spread, (c[-1] - np.median(x)) / max(x.std(), 1e-9)]
        out += [(n - 1 - np.argmax(x)) / n, (n - 1 - np.argmin(x)) / n]
        out += [(c[-1] - np.quantile(x, 0.1)) / spread,
                (c[-1] - np.quantile(x, 0.9)) / spread]
        out += [(h[-n:].max() - c[-1]) / max(c[-1], 1e-9),
                (c[-1] - l[-n:].min()) / max(c[-1], 1e-9)]
    r = np.diff(np.log(np.maximum(c, 1e-9)))
    out += [float(np.mean(r)), float(np.std(r)),
            float(np.mean(np.diff(r) ** 2)), float(np.mean((h - l) / np.maximum(c, 1e-9)))]
    texts = [str(t).lower() for t in row["headlines"]]
    bars = np.asarray(row["headline_bars"], dtype=int)
    if len(texts) != len(bars):
        raise ValueError("Headline timestamps do not match headlines")
    if np.any((bars < 0) | (bars > 49)):
        raise ValueError("Unexpected future headline")
    ages = np.exp(-(49 - bars) / 12.0)
    for pattern in words:
        hits = np.array([bool(pattern.search(t)) for t in texts], dtype=float)
        out += [float(hits.sum()), float(hits @ ages)]
    return np.nan_to_num(np.asarray(out, dtype=float), nan=0, posinf=0, neginf=0)


def sharpe(pnl):
    p = np.asarray(pnl, dtype=float)
    if len(p) < 2 or p.std(ddof=1) < 1e-12:
        return 0.0
    return float(np.sqrt(252) * p.mean() / p.std(ddof=1))


def positions(pred, train_pred, vol, train_vol, kind, bias, risk):
    if kind == "rank":
        order = np.sort(train_pred)
        signal = 2 * np.searchsorted(order, pred, side="right") / len(order) - 1
    else:
        center = np.median(train_pred)
        scale = max(float(np.std(train_pred)), 1e-8)
        signal = np.tanh((pred - center) / scale)
    result = (1 - bias) * signal + bias
    if risk:
        result = result * np.clip(np.median(train_vol) / np.maximum(vol, 1e-5), 0.5, 2.0) ** risk
    return np.clip(result, -1, 1)


def encode(train, other, base, extra, expanded):
    e = Encoder()
    x, vt = e.fit_transform([base[i] for i in train])
    z, vo = e.transform([base[i] for i in other])
    if expanded:
        s = StandardScaler()
        a = s.fit_transform(extra[train])
        b = s.transform(extra[other])
        x = hstack((x, csr_matrix(np.clip(a, -10, 10) * 0.25)), format="csr")
        z = hstack((z, csr_matrix(np.clip(b, -10, 10) * 0.25)), format="csr")
    return x, z, vt, vo, e, s if expanded else None


def main(submission=True):
    ins = sessions.get_ins_data()
    y = ins["returns"].to_numpy(dtype=float)
    if not np.isfinite(y).all():
        raise ValueError("Invalid training returns")
    base = [feature_row(row) for _, row in ins.iterrows()]
    extra = np.stack([features(row) for _, row in ins.iterrows()])
    n = len(y)
    stop = int(n * 0.8)
    edges = np.linspace(int(stop * 0.4), stop, 4).astype(int)
    folds = [(np.arange(edges[i]), np.arange(edges[i], edges[i + 1])) for i in range(3)]
    results = {}
    print("Training", n, "sessions", "news features", len(base[0][0]), "event features", extra.shape[1], flush=True)

    for k, (train, valid) in enumerate(folds, 1):
        print("Fold", k, "training", len(train), "validation", len(valid), "always-long", round(sharpe(y[valid]), 3), flush=True)
        for expanded in [False, True]:
            x, z, vt, vv, _, _ = encode(train, valid, base, extra, expanded)
            for alpha in alphas:
                m = Ridge(alpha=alpha, solver="lsqr")
                m.fit(x, y[train])
                a, b = m.predict(x), m.predict(z)
                for bias in biases:
                    for kind in sizers:
                        for risk in risks:
                            key = (expanded, alpha, bias, kind, risk)
                            p = positions(b, a, vv, vt, kind, bias, risk)
                            results.setdefault(key, []).append((valid, p, sharpe(p * y[valid])))
            print("  ", "events" if expanded else "v5 features", "done", flush=True)

    table = []
    for key, chunks in results.items():
        idx = np.concatenate([v for v, _, _ in chunks])
        p = np.concatenate([p for _, p, _ in chunks])
        scores = [s for _, _, s in chunks]
        cv = sharpe(p * y[idx])
        score = cv - 0.2 * np.std(scores)
        table.append(dict(expanded=key[0], alpha=key[1], bias=key[2],
                          sizing=key[3], risk=key[4], sharpe=cv,
                          score=score, fold_sharpes=json.dumps(scores)))
    table = pd.DataFrame(table).sort_values("score", ascending=False).reset_index(drop=True)
    out = Path("runs") / "v7_reference"
    out.mkdir(parents=True, exist_ok=True)
    table.to_csv(out / "candidate_scores.csv", index=False)
    print("Top validation candidates:\n", table.head(8).to_string(index=False), flush=True)

    winner = table.iloc[0]
    expanded = bool(winner["expanded"])
    train = np.arange(stop)
    valid = np.arange(stop, n)
    x, z, vt, vv, _, _ = encode(train, valid, base, extra, expanded)
    m = Ridge(alpha=float(winner["alpha"]), solver="lsqr").fit(x, y[train])
    p = positions(m.predict(z), m.predict(x), vv, vt,
                  str(winner["sizing"]), float(winner["bias"]), float(winner["risk"]))
    pnl = p * y[valid]
    audit = sharpe(pnl)
    baseline = sharpe(y[valid])
    curve = np.cumsum(pnl)
    dd = float(np.min(curve - np.maximum.accumulate(np.r_[0, curve])[1:]))
    pd.DataFrame(dict(session=ins.index[valid], position=p, returns=y[valid],
                      pnl=pnl)).to_csv(out / "audit_predictions.csv", index=False)
    report = dict(validation_sharpe=float(winner["sharpe"]), audit_sharpe=audit,
                  always_long_audit=baseline, audit_drawdown=dd,
                  audit_hit_rate=float(np.mean(pnl[p != 0] > 0)) if np.any(p != 0) else 0,
                  audit_correlation=float(np.corrcoef(p, y[valid])[0, 1]) if p.std() > 0 else 0,
                  target_sharpe=3.65, selected={k: winner[k].item() if hasattr(winner[k], "item") else winner[k]
                                               for k in ["expanded", "alpha", "bias", "sizing", "risk"]})
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print("Validation Sharpe:", round(report["validation_sharpe"], 4),
          "Audit Sharpe:", round(audit, 4), "Always-long audit:", round(baseline, 4),
          "Max PnL drawdown:", round(dd, 5), flush=True)

    if submission:
        full = np.arange(n)
        test = sessions.get_oos_data().copy()
        other = [feature_row(row) for _, row in test.iterrows()]
        extra_test = np.stack([features(row) for _, row in test.iterrows()])
        e = Encoder()
        full_x, full_vol = e.fit_transform(base)
        test_x, test_vol = e.transform(other)
        if expanded:
            s = StandardScaler()
            full_a = np.clip(s.fit_transform(extra), -10, 10)
            test_a = np.clip(s.transform(extra_test), -10, 10)
            full_x = hstack((full_x, csr_matrix(full_a * 0.25)), format="csr")
            test_x = hstack((test_x, csr_matrix(test_a * 0.25)), format="csr")
        m = Ridge(alpha=float(winner["alpha"]), solver="lsqr").fit(full_x, y)
        test["pred"] = positions(m.predict(test_x), m.predict(full_x), test_vol, full_vol,
                                 str(winner["sizing"]), float(winner["bias"]), float(winner["risk"]))
        sessions.write_submission(prediction_df=test, path="predictions_v7.csv")
        print("Saved predictions_v7.csv", flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-submission", action="store_true")
    args = parser.parse_args()
    main(not args.no_submission)
