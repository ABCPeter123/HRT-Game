# 3.564 reference model and optional sentiment blend

The supplied stock-identity and delayed-headline-impact model is preserved in `model_3564.py`. Its reported competition score is **3.564**, supplied by the user, not reproduced locally. The score is for the unchanged model. The final position entry point is `make_submission.py`.

```powershell
python make_submission.py
```

This creates `predictions.csv` from the original model with no blending. It deliberately does not apply our v5 changes to the user's successful signal.

Try an exploratory 10% sentiment blend separately:

```powershell
python make_submission.py --sentiment-weight 0.1
```

This creates **`predictions_blend.csv`**, leaving the original default submission path unchanged. For a blend, each signal is normalized by its 90th-percentile absolute size using only unlabelled out-of-sample predictions. That normalization does not use hidden returns. It does change the original strategy, so **3.564 is not a valid performance estimate for the blend**.

Run `python make_submission_v5.py` to recover our original v5 `predictions.csv` experiment. The earlier locally validated v5 result is 2.375 development Sharpe and 2.470 exploratory audit Sharpe. Its official leaderboard score previously reported was 2.564.

The external `chr13b/synthetic-market-sharpe` repository served as research inspiration, but its 49-to-99 target does not match the 49-to-59 target used here. No results have been attributed from that different task.
