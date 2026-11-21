import argparse
import numpy as np
import pandas as pd
import sessions
from model_3564 import get_model, predict_session

parser = argparse.ArgumentParser()
parser.add_argument("--sentiment-weight", type=float, default=0)
args = parser.parse_args()
w = args.sentiment_weight
if not 0 <= w <= 1:
    raise ValueError("sentiment-weight must be between 0 and 1")

news = None
if w:
    from algoarena_sentiment_v5 import run_pipeline
    report = run_pipeline(create_submission=True)
    news = pd.read_csv("predictions.csv").set_index("headline_id")["pred"]
    print("v5 validation:", round(report["selection"]["oof_sharpe"], 3))
    print("v5 audit:", round(report["audit"]["sharpe"], 3))

model = get_model()
data = sessions.get_oos_data().copy()
data["pred"] = [predict_session(model, row["open"], row["high"], row["low"], row["close"],
                               row["headlines"], row["headline_bars"])
                for _, row in data.iterrows()]

strong = data["pred"].to_numpy(dtype=float)
if w:
    sentiment = news.reindex(data.index).to_numpy(dtype=float)
    if not np.isfinite(sentiment).all():
        raise ValueError("Missing v5 prediction for one or more sessions")
    scale_a = max(np.quantile(np.abs(strong), 0.9), 1e-9)
    scale_b = max(np.quantile(np.abs(sentiment), 0.9), 1e-9)
    data["pred"] = (1 - w) * strong / scale_a + w * sentiment / scale_b
    print("Signal correlation:", round(float(np.corrcoef(strong, sentiment)[0, 1]), 3))
    name = "predictions_blend.csv"
else:
    name = "predictions.csv"

data["pred"] = np.nan_to_num(data["pred"].to_numpy(dtype=float))
sessions.write_submission(prediction_df=data, path=name)
print("Positions:", data["pred"].describe()[["min", "mean", "std", "max"]].round(4).to_dict())
print("Saved", name)
