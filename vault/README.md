# Vault: live chip-value and market-decision panel

Game 3, Waterloo Quant Club Fall 2026 Trading Competition. Source: official packet, pp. 10–13. Four rounds, 10 minutes 30 seconds each, trading VAULT, G5 and PUB.

## Run locally

From the repository root, start a static server with python -m http.server 8000. Open http://localhost:8000/vault/.

Run tests: cd vault, then npm test. No paid APIs, backend, or Vercel deployment are required. All recorded rounds stay in this browser.

## Fast workflow

1. **Read chips:** select the assigned maker cohort. Each round's role is inferred. Enter public chip partial and true reveals as the game discloses them. Takers may enter private chips 21–30 as they are revealed; makers must not. For combination chips, enter two other chip IDs and their displayed rounded mean. Bulk numeric entry supports the format 1:8/8 2:6/- 3:-/7, where a hyphen means not yet known.
2. **Trade / quote:** enter observed best bids, asks, displayed sizes, current positions and working order quantities. Makers can post two-sided quotes and submit marketable limit orders. Takers may only send immediate-or-cancel orders. The panel gives a modeled fair value and a specific suggested action, but does not send the order to the exchange. Record your *own resting* quotes separately from the public best bid/ask.
3. **Monitor:** record confirmed fills, actual execution price, and whether the fill was on your own maker quote. The tool tracks cash, inventory, rebate and a timer-based maker-penalty estimate. Next round opens a fresh set of chip records.

The Reset entire game button erases all four rounds, chip observations, filled trades, penalty estimates and preferences after confirmation. The competition homepage can reset all implemented panels.

## Exact instruments and constraints

| Instrument | Settlement | Legal price | Price tick |
| --- | --- | --- | --- |
| VAULT | Sum of all 30 true chip values | 30–300 | 0.25 |
| G5 | Count of 30 chips whose true value is strictly greater than 5 | 0–30 | 0.10 |
| PUB | Sum of public 20 chip true values | 20–200 | 0.25 |

Every chip's true value is independently uniform on 1–10. The baseline expected settlements are VAULT 165, PUB 110 and G5 15.

Makers have ±500 inventory per asset and may post resting limit orders and take liquidity. Takers have ±300 per asset and may only submit IOC orders. Working orders consume worst-case position capacity.

Maker penalties are $0.01 per second for each $1 of qualifying quote width above Wmax. Only own bids/offers with outstanding size at least 10 count. If a qualifying side is missing, the price band endpoint replaces it. Wmax is the contract standard deviation using only *exact public chip true values available to makers*, not unconfirmed partial values. The first 10 seconds are exempt. A qualifying quote with an original size strictly more than 10 that gets partly or fully filled creates a five-second waiver. Own resting quote fills earn a $0.05-per-contract rebate.

Public reveals: at 0:00 takers see public chip 1 partial; every 30 seconds they get the next public partial and previous true value, through 10:00. Makers see each such public information package 30 seconds later, ending with chip 20 partial and chip 19 true at 10:00. Takers see private chip 21 through 30 exact values, one per minute starting at 1:00.

Customer bots fill quotes, maker bots post liquidity and event bots send directional bursts. Event-bot trades **do not affect settlement** in Vault.

## Probability assumptions

True chips have a 50% prior, numeric error chips 25%, numeric false chips 15%, and combination chips 10%. The model uses the first three likelihoods for unidentified numeric clues, conditional on the clue not being a recognizable combination. Error values are uniformly sampled within ±2 of the true value and truncated to 1–10. Because the packet does not specify the false-chip displayed distribution, we assume uniform over the nine incorrect values.

A combination clue reports the rounded mean of two *other* chip IDs. The model passes discrete sum-product messages across these two-chip constraints. It estimates chip marginals, expected settlements, and contract uncertainties. Correlations created by combination clues mean the reported standard deviations are approximations. This is not a calibrated posterior over all connected observations, and suggestions are not equilibrium-optimal.

The market strategy compares fair value to the real observed bid/ask, charges a configurable uncertainty buffer, and respects inventory and tick limits. Unknown displayed depth receives a provisional 10-share cap rather than an invented liquidity amount. Maker quotes are a heuristic for balancing spread, information risk, position inventory and the penalty threshold. Actual market queue position and bot fill probabilities are unknown.

Marked-to-model PnL assumes all own fills are recorded from zero inventory; if a live bridge captures an external inventory, the ledger is marked incomplete. Maker penalty is estimated only while the panel's local countdown runs; it is not a verified value from the organizer. The organizer's final marked-to-settlement PnL and maker/taker cohort ranking take precedence.

## Optional local read-only capture from Game 2

The Baskets field mapper was adapted to a separate Vault extension. Vault's symbols, tick sizes and price bands differ. The Vault reader runs at 127.0.0.1:8766 with its own 36-character session key. It never submits orders or captures chip clues.

1. Run node vault/bridge/server.mjs from the repository root and copy its displayed key.
2. Open chrome://extensions, enable Developer mode, select Load unpacked and choose vault/bridge/extension.
3. Open the actual Vault trading tab. In the Vault reader popup, paste the same key, use Pick to map the visible bid and ask for VAULT, G5 and PUB, and use Check to confirm the extracted values and numeric indices.
4. Start capture. In the local Vault panel, paste the key into the bridge connection area and connect. Verify that quote values match the actual exchange.
5. Optionally map displayed sizes, current positions and working order quantities. Mapping works only for visible DOM numeric values, not canvas-only interfaces, inaccessible iframes or closed shadow roots.

The reader sends only explicitly mapped numeric fields to a loopback-only authenticated relay. It does not read arbitrary page content or secrets. No live connection can be tested until the actual competition website is available.

No production deployment was triggered. Automatic Vercel deployments remain disabled.
