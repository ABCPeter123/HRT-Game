"""HRT synthetic-stock challenge: final model.

Model in one paragraph
----------------------
Each session's stock is one of the ~4 fictional companies named in the headlines. A headline
published in bar b moves the price as a linear ramp over the next ~10 bars (half a bar at
lag 0, full bars at lags 1-9, half a bar at lag 10), with a total move of
    role_coef * A_etype * sigma_session
where A_etype is a per-event-type amplitude (50 parsed templates, amounts/percentages do
not matter), role_coef is ~2.5 if the headline is about the stock itself, ~0.75 for a
same-sector peer and ~0.13 for an unrelated company. Which company is the stock is not
given, so we compute a posterior over the candidates from how bars 0-49 reacted to each
company's past headlines (Gaussian likelihood on normalised bar returns, tempered), and
take the posterior-weighted remaining drift over bars 50-59 of headlines published in
bars 40-49. A small mean-reversion term (price level vs. news-explained level) is added,
the forecast is turned into a position E[r]/Var[r] ~ forecast/sigma, and clipped.

All parameters (A_etype, role coefficients, priors, regression weights, clip bounds) are
fitted on in-sample data only; the stage-2 weights are fitted on out-of-fold base features.
Prediction inputs use only bars 0-49 and headlines with bar_ix <= 49.
"""
from __future__ import annotations

import os
import pickle
import re

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import lsqr

T0 = 49          # trade at close of bar 49
HOR = 10         # hold to close of bar 59
NBARS = 100
KERNEL = np.array([0.05] + [0.1] * 9 + [0.05])
NK = len(KERNEL)
LOG2 = np.log(2.0)

# Final hyperparameters (chosen by nested 5-fold CV, see REPORT.md)
CONFIG = dict(
    temp=2.0,          # likelihood tempering for the stock-identity posterior
    sig_power=1.0,     # position = forecast_in_vol_units / sigma**sig_power
    clip_q=0.02,       # clip positions at the 2% / 98% quantiles of training positions
    use_dev=True,      # include mean-reversion term
    naive=False,       # True: ignore stock identity (all companies weighted equally)
    em_iters=8,
    n_inner=5,
    seed=20261121,
)

# --------------------------------------------------------------------------------------
# Headline parsing
# --------------------------------------------------------------------------------------
_TITLES = {"Chief", "CTO", "CFO", "CEO", "COO"}
_SEGMENTS = ["automated logistics", "wireless connectivity", "digital payments", "renewable storage",
             "cloud infrastructure", "supply chain optimization", "data analytics", "enterprise software",
             "precision manufacturing", "process automation"]
_COUNTERPARTIES = ["a top-tier research institute", "a global retailer", "a leading cloud platform",
                   "an international consortium", "a major logistics provider", "a multinational manufacturer",
                   "a national infrastructure agency"]
_REGIONS = ["Southeast Asia", "Asia Pacific", "Latin America", "Central Europe", "Middle East",
            "North America", "Scandinavia", "Europe"]
_CONFS = ["Global Innovation Summit", "Annual Industry Forum", "Emerging Markets Forum",
          "Corporate Strategy Symposium", "Tech Leadership Conference", "Capital Markets Day"]
_EXECS = ["Chief Strategy Officer", "Chief Operating Officer", "CTO", "CFO", "CEO"]
_SECTOR_OF_SUFFIX = {
    **{k: "consumer" for k in ["Commerce", "Marketplace", "Retail", "Outlets", "Brands", "Stores", "Goods"]},
    **{k: "tech" for k in ["Systems", "Microchips", "Computing", "Software", "Networks", "Technologies",
                           "Devices", "Solutions"]},
    **{k: "health" for k in ["Sciences", "Genomics", "Labs", "Diagnostics", "Biotech", "Pharmaceuticals",
                             "Therapeutics", "Biopharma", "Biosciences"]},
    **{k: "finance" for k in ["Securities", "Capital", "Investments", "Holdings", "Asset", "Financial",
                              "Trading", "Partners", "Advisors"]},
    **{k: "energy" for k in ["Fuels", "Power", "Resources", "Grid", "Renewables", "Energy"]},
    "Industries": "industrial",
}


def split_company(s: str):
    toks = str(s).split()
    i = 0
    while i < len(toks) and toks[i][:1].isupper() and toks[i] not in _TITLES:
        i += 1
    return " ".join(toks[:i]), " ".join(toks[i:])


def parse_headline(s: str) -> dict:
    company, t = split_company(s)
    out = {"company": company, "amount": np.nan, "pct": np.nan}
    m = re.search(r"\$([\d\.]+)([MBK]?)", t)
    if m:
        out["amount"] = float(m.group(1)) * {"M": 1, "B": 1000, "K": 1e-3, "": 1e-6}[m.group(2)]
        t = t[: m.start()] + "$X" + t[m.end():]
    m = re.search(r"(\d+(?:\.\d+)?)%", t)
    if m:
        out["pct"] = float(m.group(1))
        t = t[: m.start()] + "N%" + t[m.end():]
    for key, lst, ph in [("seg", _SEGMENTS, "<SEG>"), ("cp", _COUNTERPARTIES, "<CP>"),
                         ("region", _REGIONS, "<REG>"), ("conf", _CONFS, "<CONF>"), ("exec", _EXECS, "<EXEC>")]:
        out[key] = None
        for x in lst:
            if x in t:
                out[key] = x
                t = t.replace(x, ph)
                break
    out["etype"] = t
    return out


_PCACHE: dict = {}


def parse_cached(s: str) -> dict:
    d = _PCACHE.get(s)
    if d is None:
        d = parse_headline(s)
        _PCACHE[s] = d
    return d


def sector(company: str) -> str:
    parts = str(company).split()
    return _SECTOR_OF_SUFFIX.get(parts[1], "other") if len(parts) > 1 else "other"


# --------------------------------------------------------------------------------------
# Price helpers
# --------------------------------------------------------------------------------------
def bar_log_returns(o, c):
    lc = np.log(np.asarray(c, float))
    return np.diff(np.concatenate([[np.log(float(o[0]))], lc]))


def gk_vol(o, h, l, c):
    """Garman-Klass per-bar volatility (better forecast of future vol than close-to-close)."""
    lo, lh, ll, lc = (np.log(np.asarray(x, float)) for x in (o, h, l, c))
    v = np.mean(0.5 * (lh - ll) ** 2 - (2 * LOG2 - 1) * (lc - lo) ** 2, axis=-1)
    return np.sqrt(np.maximum(v, 1e-14))


def window_weight(b, t0=T0, hor=HOR):
    lags = np.arange(t0 + 1, t0 + hor + 1) - b
    m = (lags >= 0) & (lags < NK)
    return float(KERNEL[lags[m]].sum())


# --------------------------------------------------------------------------------------
# Stock-identity model
# --------------------------------------------------------------------------------------
def company_design(bars, amps, comps, n):
    order = list(dict.fromkeys(comps))
    ci = {c: i for i, c in enumerate(order)}
    Xc = np.zeros((len(order), n))
    for b, a, c in zip(bars, amps, comps):
        b = int(b)
        if b >= n or a == 0.0:
            continue
        e = min(n, b + NK)
        Xc[ci[c], b:e] += a * KERNEL[: e - b]
    return order, Xc


def role_design(Xc, secs, c, main_sec=None):
    k = len(secs)
    if c is None:  # stock not yet mentioned
        same = [j for j in range(k) if secs[j] == main_sec]
        xs = np.zeros(Xc.shape[1])
    else:
        same = [j for j in range(k) if j != c and secs[j] == secs[c]]
        xs = Xc[c]
    xp = Xc[same].sum(0) if same else np.zeros(Xc.shape[1])
    xo = Xc.sum(0) - xs - xp
    return np.stack([xs, xp, xo], 1)


def _main_sector(secs, counts):
    best, key = None, None
    for s in sorted(set(secs)):
        kk = (sum(1 for x in secs if x == s), sum(cn for x, cn in zip(secs, counts) if x == s))
        if key is None or kk > key:
            best, key = s, kk
    return best


def stock_signal(y, bars, etypes, comps, A, coef, prior_w, temp=1.0, n_total=4, t0=T0):
    """Posterior-weighted remaining drift over bars t0+1..t0+HOR, in vol units.

    y: normalised demeaned bar returns for bars 0..t0.
    """
    n = len(y)
    amps = [A.get(e, 0.0) for e in etypes]
    order, Xc = company_design(bars, amps, comps, n)
    k = len(order)
    if k == 0:
        return dict(m=0.0, cum=0.0, m_var=0.0, pmax=0.0)
    secs = [sector(c) for c in order]
    counts = [sum(1 for x in comps if x == c) for c in order]
    msec = _main_sector(secs, counts)
    fw = np.zeros(k)
    ci = {c: i for i, c in enumerate(order)}
    for b, a, c in zip(bars, amps, comps):
        w = window_weight(int(b), t0)
        if w > 0:
            fw[ci[c]] += a * w
    p_unseen = max(n_total - k, 0) / n_total
    w_obs = np.array([prior_w[min(sum(1 for s in secs if s == secs[j]), 4)] for j in range(k)], float)
    w_obs = w_obs / w_obs.sum()
    cands = list(range(k)) + [None]
    priors = np.array([(1 - p_unseen) * w_obs[c] if c is not None else p_unseen for c in cands])
    ll = np.empty(len(cands)); ms = np.empty(len(cands)); cums = np.empty(len(cands))
    for i, c in enumerate(cands):
        Dm = role_design(Xc, secs, c, msec)
        fit = Dm @ coef
        cums[i] = fit.sum()
        ll[i] = -0.5 * ((y - fit) ** 2).sum() / temp
        fw_roles = role_design(fw[:, None], secs, c, msec)[0]  # (stock, peer, other) forward sums
        ms[i] = fw_roles @ coef
    lp = ll + np.log(priors + 1e-300)
    p = np.exp(lp - lp.max())
    p /= p.sum()
    m = float(p @ ms)
    return dict(m=m, cum=float(p @ cums), m_var=float(p @ (ms - m) ** 2), pmax=float(p.max()))


# --------------------------------------------------------------------------------------
# Fitting
# --------------------------------------------------------------------------------------
def _wide(df, col, sessions):
    return df.pivot(index="session", columns="bar_ix", values=col).reindex(sessions).to_numpy(float)


def prepare_full(bars_long: pd.DataFrame, hl_long: pd.DataFrame):
    """Arrays for research/fitting from long-format full-session data."""
    sessions = np.sort(bars_long.session.unique())
    D = {"sessions": sessions}
    for k in ("open", "high", "low", "close"):
        D[k] = _wide(bars_long, k, sessions)
    D["lr"] = np.diff(np.concatenate([np.log(D["open"][:, :1]), np.log(D["close"])], axis=1), axis=1)
    hl = hl_long[["session", "bar_ix", "headline"]].copy()
    parsed = [parse_cached(s) for s in hl.headline.values]
    hl["etype"] = [d["etype"] for d in parsed]
    hl["company"] = [d["company"] for d in parsed]
    sidx = {s: i for i, s in enumerate(sessions)}
    hl["si"] = hl.session.map(sidx).astype(int)
    hl = hl.sort_values(["si", "bar_ix"], kind="stable")
    D["hl_full"] = {si: (g.bar_ix.to_numpy(int), g.etype.to_numpy(), g.company.to_numpy())
                    for si, g in hl.groupby("si")}
    D["etypes"] = sorted(hl.etype.unique())
    return D


def _hl_upto(D, si, max_bar=T0):
    bars, et, co = D["hl_full"].get(si, (np.array([], int), np.array([]), np.array([])))
    m = bars <= max_bar
    return bars[m], et[m], co[m]


def fit_base(D, tr, iters=None, naive=False):
    """Fit amplitudes, bar means, vol scale, role coefs & priors on training sessions tr."""
    iters = iters or CONFIG["em_iters"]
    lr = D["lr"][tr]
    o, h, l, c = (D[k][tr] for k in ("open", "high", "low", "close"))
    gk = gk_vol(o, h, l, c)
    c_gk = float(np.median(lr.std(1) / gk))
    sig = gk * c_gk
    bm = lr.mean(0)
    Y = (lr - bm) / sig[:, None]
    etypes = D["etypes"]
    eidx = {e: i for i, e in enumerate(etypes)}
    rows, cols, vals = [], [], []
    for r_, si in enumerate(tr):
        bars, et, co = D["hl_full"].get(si, ([], [], []))
        for b, e in zip(bars, et):
            for j in range(NK):
                if b + j < NBARS:
                    rows.append(r_ * NBARS + b + j); cols.append(eidx[e]); vals.append(KERNEL[j])
    X = sp.csr_matrix((vals, (rows, cols)), shape=(len(tr) * NBARS, len(etypes)))
    Avec = lsqr(X, Y.reshape(-1), atol=1e-12, btol=1e-12)[0]
    A = {e: float(a) for e, a in zip(etypes, Avec)}
    if naive:
        return dict(A=A, bm=bm, c_gk=c_gk, coef=np.ones(3), pri=np.ones(5))
    # EM for stock identity
    prep = []
    for r_, si in enumerate(tr):
        bars, et, co = D["hl_full"].get(si, ([], [], []))
        if len(bars) == 0:
            continue
        order, Xc = company_design(bars, [A[e] for e in et], co, NBARS)
        secs = [sector(x) for x in order]
        nsec = np.array([min(sum(1 for s in secs if s == x), 4) for x in secs])
        prep.append((Y[r_], [role_design(Xc, secs, j) for j in range(len(order))], nsec))
    coef = np.array([2.5, 0.6, 0.3])
    pri = np.ones(5)
    for _ in range(iters):
        XtX = np.zeros((3, 3)); Xty = np.zeros(3); cnt = np.zeros(5); tot = np.zeros(5)
        for y, Ds, nsec in prep:
            sse = np.array([((y - Dm @ coef) ** 2).sum() for Dm in Ds])
            lp = -0.5 * sse + np.log(pri[nsec] / pri[nsec].sum())
            p = np.exp(lp - lp.max()); p /= p.sum()
            for pc, Dm in zip(p, Ds):
                XtX += pc * (Dm.T @ Dm); Xty += pc * (Dm.T @ y)
            np.add.at(cnt, nsec, p); np.add.at(tot, nsec, 1)
        coef = np.linalg.solve(XtX, Xty)
        pri = np.where(tot > 0, cnt / np.maximum(tot, 1), 1.0)
        pri = pri / pri[3]
    return dict(A=A, bm=bm, c_gk=c_gk, coef=coef, pri=pri)


def base_features(o, h, l, c, bars, etypes, comps, P, temp=None):
    """Features at close of bar 49 from bars 0..49 and headlines <=49 only."""
    temp = CONFIG["temp"] if temp is None else temp
    o, h, l, c = (np.asarray(x, float)[: T0 + 1] for x in (o, h, l, c))
    lr = bar_log_returns(o, c)
    sig = float(gk_vol(o, h, l, c)) * P["c_gk"]
    sig = max(sig, 1e-6)
    y = (lr - P["bm"][: T0 + 1]) / sig
    keep = [i for i, b in enumerate(bars) if b <= T0]
    bars = [int(bars[i]) for i in keep]; etypes = [etypes[i] for i in keep]; comps = [comps[i] for i in keep]
    s = stock_signal(y, bars, etypes, comps, P["A"], P["coef"], P["pri"], temp=temp)
    dev = (y.sum() - s["cum"]) / np.sqrt(len(y))
    return dict(m=s["m"], dev=dev, m_var=s["m_var"], pmax=s["pmax"], sig=sig)


def features_for(D, idx, P, temp=None):
    rows = []
    for si in idx:
        bars, et, co = _hl_upto(D, si)
        f = base_features(D["open"][si], D["high"][si], D["low"][si], D["close"][si],
                          list(bars), list(et), list(co), P, temp=temp)
        rows.append(f)
    return pd.DataFrame(rows, index=idx)


def fit_stage2(F, r, cfg=None):
    """OLS of r/sig on [m, dev]; position = (beta.x)/sig**sig_power, clipped at quantiles."""
    cfg = {**CONFIG, **(cfg or {})}
    cols = ["m", "dev"] if cfg["use_dev"] else ["m"]
    X = F[cols].to_numpy(); y = np.asarray(r) / F.sig.to_numpy()
    beta = np.linalg.lstsq(X, y - y.mean(), rcond=None)[0]
    pos = (X @ beta) / F.sig.to_numpy() ** cfg["sig_power"]
    q = cfg["clip_q"]
    lo, hi = (np.quantile(pos, [q, 1 - q]) if q > 0 else (-np.inf, np.inf))
    return dict(cols=cols, beta=beta, lo=float(lo), hi=float(hi), sig_power=cfg["sig_power"])


def stage2_predict(f, S):
    x = np.array([f[c] for c in S["cols"]], float)
    pos = float(x @ S["beta"]) / f["sig"] ** S["sig_power"]
    return float(np.clip(pos, S["lo"], S["hi"]))


def oof_base_features(D, tr, n_inner, seed, temp=None, naive=False):
    """Out-of-fold base features for training sessions tr (for fitting stage 2 without leakage)."""
    rng = np.random.RandomState(seed)
    perm = rng.permutation(tr)
    parts = np.array_split(perm, n_inner)
    out = []
    for part in parts:
        inner_tr = np.sort(np.setdiff1d(tr, part))
        P = fit_base(D, inner_tr, naive=naive)
        out.append(features_for(D, np.sort(part), P, temp=temp))
    return pd.concat(out).loc[tr]


def train(D, r, tr=None, cfg=None):
    cfg = {**CONFIG, **(cfg or {})}
    tr = np.arange(len(D["sessions"])) if tr is None else np.asarray(tr)
    F = oof_base_features(D, tr, cfg["n_inner"], cfg["seed"], temp=cfg["temp"], naive=cfg["naive"])
    S = fit_stage2(F, r[tr], cfg)
    P = fit_base(D, tr, naive=cfg["naive"])
    return dict(P=P, S=S, cfg=cfg)


def predict_session(M, o, h, l, c, headlines, headline_bars):
    bars, et, co = [], [], []
    for hdl, b in zip(headlines, headline_bars):
        if b is None or not np.isfinite(b) or b > T0:
            continue
        d = parse_cached(hdl)
        bars.append(int(b)); et.append(d["etype"]); co.append(d["company"])
    f = base_features(o, h, l, c, bars, et, co, M["P"], temp=M["cfg"]["temp"])
    return stage2_predict(f, M["S"])


# --------------------------------------------------------------------------------------
# Train on all in-sample data and expose my_prediction
# --------------------------------------------------------------------------------------
_MODEL = None
_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model_params.pkl")


def get_model(use_cache=True):
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    if use_cache and os.path.exists(_CACHE):
        with open(_CACHE, "rb") as fh:
            obj = pickle.load(fh)
        if obj.get("config") == CONFIG:
            _MODEL = obj["model"]
            return _MODEL
    import sessions
    D = prepare_full(sessions.get_ins_full_bars(), sessions.get_ins_full_headlines())
    rets = pd.read_parquet(os.path.join(os.path.dirname(os.path.abspath(sessions.__file__)),
                                        "ins_returns.parquet")).set_index("session").returns
    r = rets.reindex(D["sessions"]).to_numpy(float)
    _MODEL = train(D, r)
    try:
        with open(_CACHE, "wb") as fh:
            pickle.dump({"config": CONFIG, "model": _MODEL}, fh)
    except OSError:
        pass
    return _MODEL


def my_prediction(row: pd.Series) -> float:
    try:
        M = get_model()
        v = predict_session(M, row["open"], row["high"], row["low"], row["close"],
                            list(row["headlines"]), list(row["headline_bars"]))
        return v if np.isfinite(v) else 0.0
    except Exception:
        return 0.0


if __name__ == "__main__":
    import sessions
    M = get_model(use_cache=False)
    print("role coefs", M["P"]["coef"], "stage2", M["S"])
    print(sessions.run_ins_backtest(my_prediction))
    sessions.write_submission(prediction_df=sessions.get_oos_predictions(my_prediction), path="predictions.csv")
