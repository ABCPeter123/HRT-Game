import numpy as np

from model_3564 import parse_headline, predict_session


def test_news_model_stays_the_same():
    headline = "Acme Technologies secures $23M contract with a global retailer"
    event = parse_headline(headline)
    assert event["etype"] == "secures $X contract with <CP>"
    assert event["company"] == "Acme Technologies"

    random = np.random.default_rng(7)
    close = np.exp(np.cumsum(random.normal(0, 0.003, 50)))
    opened = close * np.exp(random.normal(0, 0.001, 50))
    high = np.maximum(opened, close) * 1.001
    low = np.minimum(opened, close) * 0.999

    model = {
        "P": {
            "A": {event["etype"]: 0.75},
            "bm": np.zeros(100),
            "c_gk": 1.0,
            "coef": np.array([2.5, 0.7, 0.15]),
            "pri": np.ones(5)
        },
        "S": {
            "cols": ["m", "dev"],
            "beta": np.array([0.6, -0.1]),
            "lo": -1e8,
            "hi": 1e8,
            "sig_power": 1.0
        },
        "cfg": {"temp": 2.0}
    }

    result = predict_session(model, opened, high, low, close, [headline], [45])
    assert np.isclose(result, 347.2995782918922, rtol=1e-10)

def test_fitted_model_keys(monkeypatch):
    import model_3564 as source

    monkeypatch.setattr(source, "oof_base_features", lambda *a, **k: "features")
    monkeypatch.setattr(source, "fit_stage2", lambda *a, **k: {"beta": [1]})
    monkeypatch.setattr(source, "fit_base", lambda *a, **k: {"A": {}})

    result = source.train({"sessions": np.arange(10)}, np.ones(10))
    assert set(result) == {"P", "S", "cfg"}
    assert result["P"] == {"A": {}}
    assert result["S"] == {"beta": [1]}
