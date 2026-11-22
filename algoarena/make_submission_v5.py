from pathlib import Path
from algoarena_sentiment_v5 import run_pipeline

report = run_pipeline()
print("Validation Sharpe:", round(report["selection"]["oof_sharpe"], 3))
print("Audit Sharpe:", round(report["audit"]["sharpe"], 3))
print("CSV:", Path("predictions.csv").resolve())
