import numpy as np
import pandas as pd
from experiment_v7 import features, positions, sharpe


def test_headline_timing_and_bounds():
    close = np.linspace(1, 1.4, 50)
    row = pd.Series(dict(close=close, high=close + 0.01, low=close - 0.01,
                         headlines=["Acme beats expectations", "Acme warns of disruption"],
                         headline_bars=[8, 49]))
    f = features(row)
    assert np.isfinite(f).all()
    assert len(f) == 76
    assert f.shape == (76,)


def test_sizing():
    train = np.linspace(-2, 2, 100)
    out = positions(np.array([-1., 0., 1.]), train, np.ones(3), np.ones(100), "rank", 0, 0)
    assert np.all(np.abs(out) <= 1)
    assert out[0] < out[1] < out[2]
    assert sharpe(np.array([0.1, 0.2, -0.1])) > 0
