import argparse
import numpy as np
import pandas as pd
import sessions
from model_3564 import get_model, predict_session

parser = argparse.ArgumentParser()
parser.add_argument("--sentiment-weight", type=float, default=0)
sentiment_weight = parser.parse_args().sentiment_weight

if not 0 <= sentiment_weight <= 1:
    raise ValueError("sentiment-weight must be between 0 and 1")

sentiment_positions = None
if sentiment_weight:
    from algoarena_sentiment_v5 import run_pipeline
    scores = run_pipeline(create_submission=True)
    sentiment_positions = pd.read_csv("predictions.csv").set_index("headline_id")["pred"]
    print("v5 validation:", round(scores["selection"]["oof_sharpe"], 3))
    print("v5 audit:", round(scores["audit"]["sharpe"], 3))

model = get_model()
stock_data = sessions.get_oos_data().copy()
stock_data["pred"] = [
    predict_session(model, row["open"], row["high"], row["low"], row["close"],
                    row["headlines"], row["headline_bars"])
    for _, row in stock_data.iterrows()
]

base_positions = stock_data["pred"].to_numpy(dtype=float)
filename = "predictions.csv"

if sentiment_weight:
    sentiment = sentiment_positions.reindex(stock_data.index).to_numpy(dtype=float)
    if not np.isfinite(sentiment).all():
        raise ValueError("Missing sentiment predictions")

    base_scale = max(np.quantile(np.abs(base_positions), 0.9), 1e-9)
    sentiment_scale = max(np.quantile(np.abs(sentiment), 0.9), 1e-9)
    stock_data["pred"] = (
        (1 - sentiment_weight) * base_positions / base_scale +
        sentiment_weight * sentiment / sentiment_scale
    )
    print("Signal correlation:", round(float(np.corrcoef(base_positions, sentiment)[0, 1]), 3))
    filename = "predictions_blend.csv"

stock_data["pred"] = np.nan_to_num(stock_data["pred"].to_numpy(dtype=float))
sessions.write_submission(prediction_df=stock_data, path=filename)
print("Positions:", stock_data["pred"].describe()[["min", "mean", "std", "max"]].round(4).to_dict())
print("Saved", filename)
