# Scavenger: live decision panel

Waterloo Quant Club Fall 2026 Trading Competition. This is the first interactive game panel in Quant Comp 2026.

## Open and play

Use the deployed Scavenger URL when available. For local development, run a static server from the repository root:

\`\`\`bash
python -m http.server 8000
\`\`\`

Then visit \`http://localhost:8000/scavenger/\`. The panel uses native JavaScript only. It has no build step, external dependencies, API calls, model downloads, or cloud inference. Decisions compute in your browser. Inputs and round history save to your browser's localStorage.

1. Select Round 1 to 5. During the 60-second information phase, enter the given percentile. The sample-count recommendation is only a starting heuristic.
2. Set the number of samples you actually bought and enter sample values separated by spaces or commas. Percentile alone does **not** identify a pool size; if you bought no samples, you may enter a manually estimated pool as a rough anchor.
3. Go to Auction 1. Read the suggested integer bid, then submit it **in the actual competition app**. Use "Fill bid field" to store the recommendation locally. After the result, tap your bid rank (1 = lowest, 6/7 = highest), enter payout, and go to Auction 2. Do the same for Auctions 2 and 3.
4. In Final guess, use the suggested integer guess, submit it in the actual competition app and record the true pool if revealed.
5. Repeat for later rounds. Each round has isolated saved inputs and results; earlier results now inform later-round recommendations. A separate long-term learning panel shows what was learned. Use the on-screen timer for the 60-second information and bidding windows and the 90-second final guess window.

Shortcuts: Alt+1 to Alt+5 jump to a phase; Alt+Enter fills the current recommended action. The interface supports touch screens and mobile widths.

## Quick input reference

The panel now includes a collapsible **Input guide** for every field. Information-stage fields: percentile is the percentile shown by the organizer, sample count is the number purchased (presets or a custom integer), sample values are the numbers received, and manual pool estimate is optional when samples are missing. Auction fields: room size includes you, opponent tendency selects AUTO or a manual prior, downside sensitivity trades off expected payoff against payout volatility, your submitted bid stores your actual order, bid rank is the position the game displays (1 = lowest, 6 or 7 = highest), and payout is the actual points received, including negatives. Final fields: submitted guess is the number you submitted; actual pool is an optional post-round value for computing final scores. Round buttons, phase tabs and timer provide navigation and a reference countdown.

Under each auction recommendation, the **Opponent counterplay** panel shows probabilities of the three crowd models and corresponding alternative bids. After you enter your rank, the next auction automatically adapts. These counterbids are conditional hypotheses; do not interpret them as exact knowledge of opponent bids.

The live Vercel deployment is intentionally paused. Changes pushed to GitHub are not automatically published. Run the static server locally to test the latest changes, or explicitly request a deployment when ready.

## Cross-round adaptive learning

The Scavenger panel now learns across its five rounds. The **Cross-round learning** card shows how many earlier verified pool values and bid ranks the engine used, the past pool estimation error, the historically best-performing distribution candidate, a conservative prior rival-bidding adjustment, and any shift to this round's estimate. The **Prior rounds ON/OFF** button lets you compare the baseline and learned decisions without losing saved data. Its setting is saved in your browser.

**How to feed it:** In Round 1, enter the given percentile, all purchased sample values, your actual bids, displayed ranks, auction payouts, and the actual pool revealed at the end. Switch to Round 2. The panel immediately re-estimates from Round 1. Repeat for subsequent rounds. If a rank-1 auction payout is smaller than your submitted bid, that payout exactly reveals the pool according to the packet's payout rule and can serve as verified training data even if the true pool isn't separately displayed.

**Two levels of adaptation:**

- **Across rounds:** Previous verified pool values and corresponding sample observations score the normal, uniform, shifted-exponential, two-humped, two-point, and empirical estimators. Past relative estimation errors modestly reweight the estimator mixture and can widen uncertainty. Previous rank observations form a *weak* initial probability for low-, mixed-, and high-bid opponent patterns and a limited normalization of their bidding scale.
- **Within the current room:** This round's bid ranks immediately update that room's opponent strategy probabilities. The current room's observations have more influence than older rounds because the competitors change.
- **Sampling policy:** The default recommendation remains 3 samples or 4 at an extreme percentile. If at least two previous pool outcomes show large estimation errors with relatively few samples, it proposes one additional sample. With at least three accurate examples purchased at higher sample counts, it may propose one fewer. This is a conservative heuristic, not an optimized value-of-information policy.

**Anti-leakage rules:** Only rounds strictly *before* the selected round contribute to cross-round learning. A round never trains itself using its own final revealed pool, and later rounds cannot change what the model would have recommended in an earlier round. Editing a past result instantly recomputes only subsequent rounds' learned assumptions. The engine derives these weights directly from existing locally saved round data, so there is no separate model file to lose or corrupt. Round-specific room sizes are saved and used to interpret the rank data, including 6- and 7-player rooms.

The learning model is intentionally conservative. With only four previous rounds, statistical evidence is weak. A previous winner can be an imperfect guide to the next distribution family, room, or opponent mix. Logged bid ranks do not reveal exact rival bids, and observed outcomes from one number of purchased samples do not prove what would have happened if a different number had been purchased. There is no external model training, server sync, or competition data feed.

## What the engine actually optimizes

The information stage displays a *heuristic* 3-sample starting point, or 4 at extreme given percentiles. Buying n samples costs \`pool * sqrt(n) / 12\`. The engine does **not** call its sample-count recommendation mathematically optimal. That choice needs assumptions about the unknown pool distribution, competitor bidding, and the value of information.

For estimating the pool, the engine combines normal, uniform, shifted-exponential, possible two-humped, and two-point/empirical approximations to the supplied sample observations, conditioned on the given percentile. It deliberately reports a broad uncertainty interval for small sample sizes. This is a pragmatic small-data estimator, not a fully calibrated posterior over the unknown distribution families. For zero samples, a manually entered anchor is necessary before it recommends a numerical bid or guess.

Auction payouts follow the competition packet:

- The lowest, second-lowest, and third-lowest bids each receive their bid capped by the remaining pool.
- The highest bid receives \`remaining - abs(remaining - highest_bid)\`, possibly negative.
- Middle bids receive zero.
- Auction 3 receives twice the point weight in the total round score.

The bid engine simulates possible pools and three opponent patterns (mostly low bidders, mixed bidding, and mostly high bidders) using the competition payout function. It searches integer bids and maximizes risk-adjusted expected payout. AUTO uses a starting prior across these three patterns, then updates its weights as each auction rank arrives. Choose a manual pattern only if you have independent evidence. The manual selection changes the prior; observed ranks still update it. The opponent panel displays scenario-specific counterbids, estimated profile probabilities and a counterplay note. The packet guarantees only your payout and bid rank after auctions, not a complete rival order book. All opponent types and percentages are estimates, not observed facts. Different rooms each round have different competitors, so the inference restarts for the next round.

**Downside sensitivity** changes the risk-adjusted objective:

```text
bid score = expected payout - (0.35 × slider_fraction × simulated payout standard deviation)
```

At 0% the model maximizes expected auction payout; at 50% it subtracts 0.175 times the standard deviation, at 100% it subtracts 0.35 times the standard deviation. This is not a maximum-loss cap, drawdown constraint or certainty guarantee. The default is 35%. The third auction doubles the payout and risk term equally, so the weight alone does not necessarily change the optimal bid. Equal-price ties are modeled conservatively, because the packet does not specify tie resolution.

The final-guess engine selects the integer guess maximizing estimated \`E[max(pool/4 - abs(guess-pool), 0)]\` over the pool scenarios. This differs from blindly rounding the sample mean.

Round scoring: \`A1 + A2 + 2*A3 + final_guess_payout - pool*sqrt(samples_bought)/12\`. Game standings depend on round ranks and the five-round ranking scheme, not simply on maximizing raw points in one auction. No observed room results, true pool distribution parameters, or opponent strategies are available in advance, so the recommendations are model-based and cannot guarantee the highest competitive rank.

## Speed, privacy and testing

All computations run synchronously in the local browser with small deterministic scenario sets. The hosted version registers a small service worker to cache its static assets after the first successful load; refreshes can then work offline. User inputs stay in localStorage and are not cached by the service worker. A local HTTP server also works without external services. Never rely on the panel's timer as the official game clock.

Run the unit tests with Node.js 20+:

\`\`\`bash
cd scavenger
npm test
\`\`\`

The tests cover sample costs, the exact auction payoff function, including capped payouts and negative high bids, the double-weighted third auction, final-guess rewards, missing-information behavior, and fast recommendation generation.

## Scope

The panel is an adviser. It cannot read live competition data or submit actual trades or guesses. You must manually enter observations and execute the advised action through the competition interface. If the lowest bid was capped (the payout is lower than the bid), the panel can infer the pool size exactly and use that for later auctions. A highest-bid payout can establish a lower bound on the pool even if the initial sample fit was weak.

Baskets is also implemented in `baskets/`. Other game panels are separate projects.
