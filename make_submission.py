"""Train the best validated AlgoArena model and write predictions.csv.

Run:
    python make_submission.py

This uses the same label-free submission writer as the competition notebook.
No leaderboard upload happens automatically.
"""
from pathlib import Path

from algoarena_sentiment_v5 import run_pipeline


def main():
    report = run_pipeline(create_submission=True)
    csv = Path(__file__).resolve().parent / "predictions.csv"
    print("Submission ready:", csv)
    print("Validation Sharpe:", round(report["selection"]["oof_sharpe"], 3))
    print("Held-out audit Sharpe:", round(report["audit"]["sharpe"], 3))
    print("Target Sharpe: 3.65")


if __name__ == "__main__":
    main()
