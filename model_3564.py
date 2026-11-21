from __future__ import annotations

import os
import pickle
import re

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import lsqr

T0 = 49          
HOR = 10         
NBARS = 100
KERNEL = np.array([0.05] + [0.1] * 9 + [0.05])
NK = len(KERNEL)
LOG2 = np.log(2.0)

CONFIG = dict(
    temp=2.0,          
    sig_power=1.0,     
    clip_q=0.02,       
    use_dev=True,      
    naive=False,       
    em_iters=8,
    n_inner=5,
    seed=20261121,
)

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

def bar_log_returns(o, c):
    lc = np.log(np.asarray(c, float))
    return np.diff(np.concatenate([[np.log(float(o[0]))], lc]))

def gk_vol(o, h, l, c):

    lo, lh, ll, lc = (np.log(np.asarray(x, float)) for x in (o, h, l, c))
    v = np.mean(0.5 * (lh - ll) ** 2 - (2 * LOG2 - 1) * (lc - lo) ** 2, axis=-1)
    return np.sqrt(np.maximum(v, 1e-14))

def window_weight(b, t0=T0, hor=HOR):
    lags = np.arange(t0 + 1, t0 + hor + 1) - b
    m = (lags >= 0) & (lags < NK)
    return float(KERNEL[lags[m]].sum())

def company_design(bars, amps, comps, n):
    order = list(dict.fromkeys(comps))
    ci = {c: i for i, c in enumerate(order)}
    company_paths = np.zeros((len(order), n))
    for b, a, c in zip(bars, amps, comps):
        b = int(b)
        if b >= n or a == 0.0:
            continue
        e = min(n, b + NK)
        company_paths[ci[c], b:e] += a * KERNEL[: e - b]
    return order, company_paths

def role_design(company_paths, secs, c, main_sec=None):
    k = len(secs)
    if c is None:  
        same = [j for j in range(k) if secs[j] == main_sec]
        xs = np.zeros(company_paths.shape[1])
    else:
        same = [j for j in range(k) if j != c and secs[j] == secs[c]]
        xs = company_paths[c]
    xp = company_paths[same].sum(0) if same else np.zeros(company_paths.shape[1])
    xo = company_paths.sum(0) - xs - xp
    return np.stack([xs, xp, xo], 1)

def _main_sector(secs, counts):
    best, key = None, None
    for s in sorted(set(secs)):
        kk = (sum(1 for x in secs if x == s), sum(cn for x, cn in zip(secs, counts) if x == s))
        if key is None or kk > key:
            best, key = s, kk
    return best

def stock_signal(y, bars, etypes, comps, A, coef, prior_w, temp=1.0, n_total=4, t0=T0):

    n = len(y)
    amps = [A.get(e, 0.0) for e in etypes]
    order, company_paths = company_design(bars, amps, comps, n)
    k = len(order)
    if k == 0:
        return dict(m=0.0, cum=0.0, m_var=0.0, pmax=0.0)
    secs = [sector(c) for c in order]
    counts = [sum(1 for x in comps if x == c) for c in order]
    msec = _main_sector(secs, counts)
    future_events = np.zeros(k)
    ci = {c: i for i, c in enumerate(order)}
    for b, a, c in zip(bars, amps, comps):
        w = window_weight(int(b), t0)
        if w > 0:
            future_events[ci[c]] += a * w
    p_unseen = max(n_total - k, 0) / n_total
    w_obs = np.array([prior_w[min(sum(1 for s in secs if s == secs[j]), 4)] for j in range(k)], float)
    w_obs = w_obs / w_obs.sum()
    cands = list(range(k)) + [None]
    priors = np.array([(1 - p_unseen) * w_obs[c] if c is not None else p_unseen for c in cands])
    ll = np.empty(len(cands)); future_moves = np.empty(len(cands)); past_moves = np.empty(len(cands))
    for i, c in enumerate(cands):
        role_matrix = role_design(company_paths, secs, c, msec)
        fit = role_matrix @ coef
        past_moves[i] = fit.sum()
        ll[i] = -0.5 * ((y - fit) ** 2).sum() / temp
        fw_roles = role_design(future_events[:, None], secs, c, msec)[0]  
        future_moves[i] = fw_roles @ coef
    log_prob = ll + np.log(priors + 1e-300)
    p = np.exp(log_prob - log_prob.max())
    p /= p.sum()
    m = float(p @ future_moves)
    return dict(m=m, cum=float(p @ past_moves), m_var=float(p @ (future_moves - m) ** 2), pmax=float(p.max()))

def _wide(df, col, sessions):
    return df.pivot(index="session", columns="bar_ix", values=col).reindex(sessions).to_numpy(float)

def prepare_full(bars_long: pd.DataFrame, hl_long: pd.DataFrame):

    sessions = np.sort(bars_long.session.unique())
    sessions_data = {"sessions": sessions}
    for k in ("open", "high", "low", "close"):
        sessions_data[k] = _wide(bars_long, k, sessions)
    sessions_data["lr"] = np.diff(np.concatenate([np.log(sessions_data["open"][:, :1]), np.log(sessions_data["close"])], axis=1), axis=1)
    hl = hl_long[["session", "bar_ix", "headline"]].copy()
    parsed = [parse_cached(s) for s in hl.headline.values]
    hl["etype"] = [d["etype"] for d in parsed]
    hl["company"] = [d["company"] for d in parsed]
    sidx = {s: i for i, s in enumerate(sessions)}
    hl["si"] = hl.session.map(sidx).astype(int)
    hl = hl.sort_values(["si", "bar_ix"], kind="stable")
    sessions_data["hl_full"] = {session_id: (g.bar_ix.to_numpy(int), g.etype.to_numpy(), g.company.to_numpy())
                    for session_id, g in hl.groupby("si")}
    sessions_data["etypes"] = sorted(hl.etype.unique())
    return sessions_data

def _hl_upto(sessions_data, session_id, max_bar=T0):
    bars, event_types, companies = sessions_data["hl_full"].get(session_id, (np.array([], int), np.array([]), np.array([])))
    m = bars <= max_bar
    return bars[m], event_types[m], companies[m]

def fit_base(sessions_data, train_ids, iters=None, naive=False):

    iters = iters or CONFIG["em_iters"]
    returns_by_bar = sessions_data["lr"][train_ids]
    o, h, l, c = (sessions_data[k][train_ids] for k in ("open", "high", "low", "close"))
    range_vol = gk_vol(o, h, l, c)
    c_gk = float(np.median(returns_by_bar.std(1) / range_vol))
    sig = range_vol * c_gk
    bm = returns_by_bar.mean(0)
    Y = (returns_by_bar - bm) / sig[:, None]
    etypes = sessions_data["etypes"]
    eidx = {e: i for i, e in enumerate(etypes)}
    rows, cols, vals = [], [], []
    for r_, session_id in enumerate(train_ids):
        bars, event_types, companies = sessions_data["hl_full"].get(session_id, ([], [], []))
        for b, e in zip(bars, event_types):
            for j in range(NK):
                if b + j < NBARS:
                    rows.append(r_ * NBARS + b + j); cols.append(eidx[e]); vals.append(KERNEL[j])
    X = sp.csr_matrix((vals, (rows, cols)), shape=(len(train_ids) * NBARS, len(etypes)))
    Avec = lsqr(X, Y.reshape(-1), atol=1e-12, btol=1e-12)[0]
    A = {e: float(a) for e, a in zip(etypes, Avec)}
    if naive:
        return dict(A=A, bm=bm, c_gk=c_gk, coef=np.ones(3), pri=np.ones(5))
    
    prep = []
    for r_, session_id in enumerate(train_ids):
        bars, event_types, companies = sessions_data["hl_full"].get(session_id, ([], [], []))
        if len(bars) == 0:
            continue
        order, company_paths = company_design(bars, [A[e] for e in event_types], companies, NBARS)
        secs = [sector(x) for x in order]
        sector_counts = np.array([min(sum(1 for s in secs if s == x), 4) for x in secs])
        prep.append((Y[r_], [role_design(company_paths, secs, j) for j in range(len(order))], sector_counts))
    coef = np.array([2.5, 0.6, 0.3])
    pri = np.ones(5)
    for _ in range(iters):
        XtX = np.zeros((3, 3)); Xty = np.zeros(3); cnt = np.zeros(5); tot = np.zeros(5)
        for y, Ds, sector_counts in prep:
            sse = np.array([((y - role_matrix @ coef) ** 2).sum() for role_matrix in Ds])
            log_prob = -0.5 * sse + np.log(pri[sector_counts] / pri[sector_counts].sum())
            p = np.exp(log_prob - log_prob.max()); p /= p.sum()
            for pc, role_matrix in zip(p, Ds):
                XtX += pc * (role_matrix.T @ role_matrix); Xty += pc * (role_matrix.T @ y)
            np.add.at(cnt, sector_counts, p); np.add.at(tot, sector_counts, 1)
        coef = np.linalg.solve(XtX, Xty)
        pri = np.where(tot > 0, cnt / np.maximum(tot, 1), 1.0)
        pri = pri / pri[3]
    return dict(A=A, bm=bm, c_gk=c_gk, coef=coef, pri=pri)

def base_features(o, h, l, c, bars, etypes, comps, base_model, temp=None):

    temp = CONFIG["temp"] if temp is None else temp
    o, h, l, c = (np.asarray(x, float)[: T0 + 1] for x in (o, h, l, c))
    returns_by_bar = bar_log_returns(o, c)
    sig = float(gk_vol(o, h, l, c)) * base_model["c_gk"]
    sig = max(sig, 1e-6)
    y = (returns_by_bar - base_model["bm"][: T0 + 1]) / sig
    keep = [i for i, b in enumerate(bars) if b <= T0]
    bars = [int(bars[i]) for i in keep]; etypes = [etypes[i] for i in keep]; comps = [comps[i] for i in keep]
    s = stock_signal(y, bars, etypes, comps, base_model["A"], base_model["coef"], base_model["pri"], temp=temp)
    dev = (y.sum() - s["cum"]) / np.sqrt(len(y))
    return dict(m=s["m"], dev=dev, m_var=s["m_var"], pmax=s["pmax"], sig=sig)

def features_for(sessions_data, idx, base_model, temp=None):
    rows = []
    for session_id in idx:
        bars, event_types, companies = _hl_upto(sessions_data, session_id)
        f = base_features(sessions_data["open"][session_id], sessions_data["high"][session_id], sessions_data["low"][session_id], sessions_data["close"][session_id],
                          list(bars), list(event_types), list(companies), base_model, temp=temp)
        rows.append(f)
    return pd.DataFrame(rows, index=idx)

def fit_stage2(F, r, cfg=None):

    cfg = {**CONFIG, **(cfg or {})}
    cols = ["m", "dev"] if cfg["use_dev"] else ["m"]
    X = F[cols].to_numpy(); y = np.asarray(r) / F.sig.to_numpy()
    beta = np.linalg.lstsq(X, y - y.mean(), rcond=None)[0]
    pos = (X @ beta) / F.sig.to_numpy() ** cfg["sig_power"]
    q = cfg["clip_q"]
    lo, hi = (np.quantile(pos, [q, 1 - q]) if q > 0 else (-np.inf, np.inf))
    return dict(cols=cols, beta=beta, lo=float(lo), hi=float(hi), sig_power=cfg["sig_power"])

def stage2_predict(f, position_fit):
    x = np.array([f[c] for c in position_fit["cols"]], float)
    pos = float(x @ position_fit["beta"]) / f["sig"] ** position_fit["sig_power"]
    return float(np.clip(pos, position_fit["lo"], position_fit["hi"]))

def oof_base_features(sessions_data, train_ids, n_inner, seed, temp=None, naive=False):

    rng = np.random.RandomState(seed)
    perm = rng.permutation(train_ids)
    parts = np.array_split(perm, n_inner)
    out = []
    for part in parts:
        inner_tr = np.sort(np.setdiff1d(train_ids, part))
        base_model = fit_base(sessions_data, inner_tr, naive=naive)
        out.append(features_for(sessions_data, np.sort(part), base_model, temp=temp))
    return pd.concat(out).loc[train_ids]

def train(sessions_data, r, train_ids=None, cfg=None):
    cfg = {**CONFIG, **(cfg or {})}
    train_ids = np.arange(len(sessions_data["sessions"])) if train_ids is None else np.asarray(train_ids)
    F = oof_base_features(sessions_data, train_ids, cfg["n_inner"], cfg["seed"], temp=cfg["temp"], naive=cfg["naive"])
    position_fit = fit_stage2(F, r[train_ids], cfg)
    base_model = fit_base(sessions_data, train_ids, naive=cfg["naive"])
    return dict(base_model=base_model, position_fit=position_fit, cfg=cfg)

def predict_session(trained_model, o, h, l, c, headlines, headline_bars):
    bars, event_types, companies = [], [], []
    for hdl, b in zip(headlines, headline_bars):
        if b is None or not np.isfinite(b) or b > T0:
            continue
        d = parse_cached(hdl)
        bars.append(int(b)); event_types.append(d["etype"]); companies.append(d["company"])
    f = base_features(o, h, l, c, bars, event_types, companies, trained_model["P"], temp=trained_model["cfg"]["temp"])
    return stage2_predict(f, trained_model["S"])

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
    sessions_data = prepare_full(sessions.get_ins_full_bars(), sessions.get_ins_full_headlines())
    rets = pd.read_parquet(os.path.join(os.path.dirname(os.path.abspath(sessions.__file__)),
                                        "ins_returns.parquet")).set_index("session").returns
    r = rets.reindex(sessions_data["sessions"]).to_numpy(float)
    _MODEL = train(sessions_data, r)
    try:
        with open(_CACHE, "wb") as fh:
            pickle.dump({"config": CONFIG, "model": _MODEL}, fh)
    except OSError:
        pass
    return _MODEL

def my_prediction(row: pd.Series) -> float:
    try:
        trained_model = get_model()
        v = predict_session(trained_model, row["open"], row["high"], row["low"], row["close"],
                            list(row["headlines"]), list(row["headline_bars"]))
        return v if np.isfinite(v) else 0.0
    except Exception:
        return 0.0

if __name__ == "__main__":
    import sessions
    trained_model = get_model(use_cache=False)
    print("role coefs", trained_model["P"]["coef"], "stage2", trained_model["S"])
    print(sessions.run_ins_backtest(my_prediction))
    sessions.write_submission(prediction_df=sessions.get_oos_predictions(my_prediction), path="predictions.csv")
