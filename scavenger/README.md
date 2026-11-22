# Scavenger: live decision panel

Waterloo Quant Club Fall 2026 Trading Competition. This is the first interactive game panel in Quant Comp 2026.

## Open and play

Open [the Scavenger panel](index.html) in a browser, or run a static server from the repository root:

\`\`\`bash
python -m http.server 8000
\`\`\`

Then visit \`http://localhost:8000/scavenger/\`. The panel uses native JavaScript only. It has no build step, external dependencies, API calls, model downloads, or cloud inference. Decisions compute in your browser. Inputs and round history save to your browser's localStorage.

1. Select Round 1 to 5. During the 60-second information phase, enter the given percentile. The sample-count recommendation is only a starting heuristic.
2. Set the number of samples you actually bought and enter sample values separated by spaces or commas. Percentile alone does **not** identify a pool size; if you bought no samples, you may enter a manually estimated pool as a rough anchor.
3. Go to Auction 1. Read the suggested integer bid, then submit it **in the actual competition app**. Use "Fill bid field" to store the recommendation locally. After the result, tap your bid rank (1 = lowest, 6/7 = highest), enter payout, and go to Auction 2. Do the same for Auctions 2 and 3.
4. In Final guess, use the suggested integer guess, submit it in the actual competition app and record the true pool if revealed.
5. Repeat for later rounds. Each round has isolated saved inputs and results. Use the on-screen timer to keep track of the 60-second information and bidding windows and the 90-second final guess window.

Shortcuts: Alt+1 to Alt+5 jump to a phase; Alt+Enter fills the current recommended action. The interface supports touch screens and mobile widths.

## What the engine actually optimizes

The information stage displays a *heuristic* 3-sample starting point, or 4 at extreme given percentiles. Buying n samples costs \`pool * sqrt(n) / 12\`. The engine does **not** call its sample-count recommendation mathematically optimal. That choice needs assumptions about the unknown pool distribution, competitor bidding, and the value of information.

For estimating the pool, the engine combines normal, uniform, shifted-exponential, possible two-humped, and two-point/empirical approximations to the supplied sample observations, conditioned on the given percentile. It deliberately reports a broad uncertainty interval for small sample sizes. This is a pragmatic small-data estimator, not a fully calibrated posterior over the unknown distribution families. For zero samples, a manually entered anchor is necessary before it recommends a numerical bid or guess.

Auction payouts follow the competition packet:

- The lowest, second-lowest, and third-lowest bids each receive their bid capped by the remaining pool.
- The highest bid receives \`remaining - abs(remaining - highest_bid)\`, possibly negative.
- Middle bids receive zero.
- Auction 3 receives twice the point weight in the total round score.

The bid engine simulates possible pools, a mixture of low bids and high bids by opponents, and the exact payout rule. It searches integer bids and maximizes expected payout, optionally penalizing volatility. The "Opponent bid model" buttons and previously entered rank information alter assumptions about competitor bids. The default model is not learned from actual opponent bids, which the game does not promise to reveal. Equal-price ties use a conservative deterministic ordering, because the game packet does not specify tie resolution.

The final-guess engine selects the integer guess maximizing estimated \`E[max(pool/4 - abs(guess-pool), 0)]\` over the pool scenarios. This differs from blindly rounding the sample mean.

Round scoring: \`A1 + A2 + 2*A3 + final_guess_payout - pool*sqrt(samples_bought)/12\`. Game standings depend on round ranks and the five-round ranking scheme, not simply on maximizing raw points in one auction. No observed room results, true pool distribution parameters, or opponent strategies are available in advance, so the recommendations are model-based and cannot guarantee the highest competitive rank.

## Speed, privacy and testing

All computations run synchronously in the local browser with small deterministic scenario sets. No network access is needed after the page assets load. A fresh page load requires the static files to be available; no offline service-worker cache is installed by default. Never rely on the panel's timer as the official game clock.

Run the unit tests with Node.js 20+:

\`\`\`bash
cd scavenger
npm test
\`\`\`

The tests cover sample costs, the exact auction payoff function, including capped payouts and negative high bids, the double-weighted third auction, final-guess rewards, missing-information behavior, and fast recommendation generation.

## Scope

The panel is an adviser. It cannot read live competition data or submit actual trades or guesses. You must manually enter observations and execute the advised action through the competition interface. The other four WQC game folders are scaffolded for their own real-time panels.
