# AlgoArena iterative research protocol

## Scoring contract

- Predict market-adjusted stock return from close of bar 49 to close of bar 59.
- Allowed at decision time: OHLC bars 0-49 and headlines with timestamps 0-49.
- Competition position equals the submitted prediction, including short positions for negative predictions.
- Profit for a session = position × target return.
- Competition score = sqrt(252) × mean(session profit) / standard deviation(session profit).
- OOS target returns are hidden. The only actual hidden-OOS Sharpe is the official competition leaderboard result.
- Submission: run `sessions.get_oos_predictions(my_prediction)` and `sessions.write_submission(prediction_df, path="predictions.csv")`.

## Minimum diagnostics required for every attempt

1. In-sample row count, label distribution, feature input checks, train/validation/audit index spans.
2. Fold-by-fold validation Sharpe and pooled out-of-fold Sharpe.
3. Sealed audit Sharpe, uncertainty range, return correlation, realized PnL, PnL volatility, cumulative PnL drawdown in *PnL units*, activity rate, average position size and hit rate.
4. Always-long, always-short and momentum baselines.
5. Model and position-sizing hyperparameters selected, full candidate leaderboard and main learned feature weights.
6. Volatility-regime and position-direction diagnostics; worst audit sessions.
7. Optional execution-cost stress results clearly labelled as **hypothetical and not part of the official competition score**.
8. Persist console log plus JSON, CSV, and PNG reports and clearly distinguish observed scores from guesses.

## Experimental discipline

- Tune on validation folds only. After selecting a model, inspect the sealed audit exactly once and do not choose parameters to improve that same audit. Use a fresh untouched sample for a trustworthy later audit.
- Train preprocessing and calibration, including vectorizers, scaling, and position normalization, using *training rows only* within every validation fold.
- The competition notebook doesn't establish that session rows have real chronology. Blocked index folds are safeguards, not definitive proof of time-series generalization.
- Strong historical Sharpe with weak audit Sharpe is a sign that the strategy may not generalize. Do not spend one of the 10 leaderboard submissions based on a good training score alone.
- Optimize the score that matters: per-session PnL Sharpe. Drawdown, returns and trading costs are secondary diagnostics, not substitutes for Sharpe in this competition.
- Absolute scalar multiplication of every position leaves Sharpe unchanged, except when caps, thresholds, or execution costs alter outcomes. Tune how you allocate position size *across* sessions, rather than merely multiplying all predictions.
- Avoid importing irrelevant features from a multi-asset trading simulator, such as portfolio hedging or multi-asset rebalancing. This competition has only one position per synthetic session. Volatility-based sizing, walk-forward-inspired validation, debugging and regime assessment *do* transfer.

## Version log

- **v1:** TF-IDF headline features and observed OHLC features; Ridge baseline; single random 20% validation split.
- **v2:** Three blocked expanding validation folds, final untouched 20% audit; Sharpe-based candidate selection across Ridge regularization, minimum signal strength and volatility-based position sizing; detailed logging, JSON/CSV diagnostics, charts, and official submission export.

## What to bring back after each run

Share the files `algoarena_debug_v2/report.json` and `algoarena_debug_v2/candidate_scores.csv` (or their equivalents for the new version). Also share the official hidden-OOS leaderboard Sharpe only if you actually submitted a file. From this evidence, decide whether the next experiment should improve headlines, nonlinear modeling, position sizing, or robustness.