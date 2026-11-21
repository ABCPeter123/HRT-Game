## Reference-inspired v7 experiment

The approach in [chr13b/synthetic-market-sharpe](https://github.com/chr13b/synthetic-market-sharpe) inspired additional price-range features, headline event counts weighted by recency, and rank-calibrated position sizing. Its original challenge predicts a different return horizon and uses a different target, so its reported Sharpes are not transferable. Our labels and official submission contract remain unchanged.

Run \`python experiment_v7.py --no-submission\` to compare the new approach using the existing in-sample parquet files. Diagnostics are in \`runs/v7_reference/\`. Run \`python experiment_v7.py\` to also generate \`predictions_v7.csv\`. Keep using the existing \`make_submission.py\` for the established v5 baseline unless v7 proves better on validation.

The reference repository is MIT-licensed. The implementation above is an independent adaptation of its documented techniques, not copied source.
