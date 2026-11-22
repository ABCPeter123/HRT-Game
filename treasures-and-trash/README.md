# Treasures & Trash: live negotiation and auction adviser

Game 4 of the Waterloo Quant Club Fall 2026 Trading Competition. Based on the official game packet, pages 14–16. A physical team-of-three game with three rounds. Every round has a 2-minute discussion phase and a 15-minute trading phase with 40 teams, starting with 9 cards, $500, and 15 auction slips.

The independent `/treasures-and-trash/` panel prices your **actual hand** and recalculates after each card, trade, contract or Joker changes. It runs entirely in the browser. It does not read the physical cards or transact on your behalf, and does not require an AI model, external API, or network after page load. Inputs and observations are kept in browser localStorage, separated by round; Undo reverses the last confirmed action.

## Run it

From the repository root:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/treasures-and-trash/` on your laptop or phone, or open it through the repository's static site build. No Vercel deployment is needed. Build updates are intentionally **not** deployed automatically.

To test:

```bash
cd treasures-and-trash
npm test
```

## No-typing card trade builder

The **Trade calculator** has a tap-first card composer. Choose **RECEIVE from rival** or **GIVE to rival**, choose a suit and rank, and repeat for card bundles. Tap any card chip marked × to remove it. Cash shortcuts such as **Pay $25** and **Get $50** fill the signed cash field. The exact same trade evaluator uses these inputs as the original text fields; a proposal does not alter actual holdings until **Record this trade after agreement** is pressed after the physical trade.

## Fastest live workflow

1. Select **Round 1/2/3** and the announced **treasure suit**. Its same-color counterpart is trash; the two opposite-color suits are neutral.
2. In **Hand**, tap the correct suit, then tap each rank you hold, usually nine starting cards. You can paste the entire hand as `AH 10S 3D 4C 4H 2xKC`. Use **Remove cards** or tap a held-card chip to correct errors. Cash starts at $500; change it after spending or receiving cash.
3. The top recommendation highlights the most valuable one-card target, with a **break-even purchase price**. Every buy/sell row has a **Try** button to load that card into the trade editor. The suggestion's price is a starting point to negotiate, not the true price a rival will accept.
4. In **Trade calculator**, enter cards received and given, positive/negative cash change, and Joker changes. Optional controls allow giving an owned contract or receiving a newly described contract. The result shows the **exact projected current-hand point difference**, including the effects on existing rank matches and all-trash status. Click **Record this trade after agreement** only after the physical exchange happens.
5. In **Auctions**, choose Joker or bounty, number 1–5, and enter the bounty's printed payout and your estimated probability. The tool shows an **entry bid** and **maximum economically defensible bid** (subject to cash on hand). If you actually win, enter the price you paid and record it. If the third highest winning bid becomes public, record that separately to adapt the *next* entry bid.
6. In **Opponents**, log buy and sell offers with rival team names, asset, price, and outcome. Recorded *open* offers for single cards get revalued automatically against your changing hand. If an offer is attractive, the top banner can switch from a theoretical target to an **observed potential opportunity**. Confirm that such an offer remains available before treating it as executable.

Keyboard shortcuts: Alt+1 Hand, Alt+2 Trade, Alt+3 Auctions, Alt+4 Opponents. All updates are synchronous. No background polling or API usage.

## Exact official scoring implementation

A card's base value is **10** for ranks 2–10, **30** for J, Q and K, **50** for Ace. Each card starts at multiplier 1. Treasure suit contributes +1, trash suit contributes −1 (except **if the entire scored hand is trash**; then trash suit contributes +1), and rank grouping contributes +0.5 for **exactly two** cards of the same rank or +1 each for **three or more** cards of that rank. Cards are scored as `base × (1 + suit_adjustment + rank_adjustment)`.

One Joker, if owned, is automatically replaced with the single rank/suit combination maximizing the entire new hand's score. The optimizer evaluates every possible rank/suit and recalculates all rank and suit interactions. **Only one Joker scores**, even if you have several, and it is a separate public asset rather than a private card. A Joker's extra value can decrease to zero if you already have a Joker; buying extras may make sense only for resale, which this model does not estimate.

Points for **confirmed fulfilled bounty contracts** are added to the current exact score. An unknown contract contributes only to **estimated score** as `payout × your estimated success probability`; failed contracts contribute zero. Conditions can refer to the game state, so the application never asserts an unknown condition has been satisfied. Finally, cash adds exactly one point per dollar, even if your card score is zero. The trade editor compares this projected total before and after an exchange. It never silently assumes an offered trade occurred.

Card supply is implemented exactly: 10 copies per treasure rank (130 total), 7 copies of every neutral rank except neutral 2s and 3s (only 6 copies per suit), and 4 copies per trash rank (52 total). That is **360 cards**, split into nine initial cards for each of 40 teams. A full hand is not forced to remain nine cards after trading, but impossible duplicate counts above the supply are rejected.

Example: with Hearts treasure, `AH AS` scores 200 points (Ace of Hearts 125, Ace of Spades 75). Adding `AD` increases it to 300 points, a **100-point** marginal gain. Even though Diamond is trash, the third matching Ace improves all three Aces through the rank bonus. An all-diamond `AD KD` hand scores 160 points. Adding `2C` reduces the card score to 10 because the all-trash bonus disappears. The calculator captures this nonlinear effect.

## Auction strategy and risk limitations

There are **five sealed-bid auctions**, opening every three minutes at 0:00, 3:00, 6:00, 9:00 and 12:00, each closing 2:40 later. The top three bids, plus every tied team at the winning ranks, win **and pay their own bid**. Failure to pay by the next auction's end causes disqualification; auction five has an after-trading payment option. Do not commit money you cannot pay.

For a Joker, the modeled value ceiling is its exact marginal point value in your current hand. For a bounty, it is `probability × payout`, with a downside deduction of `sensitivity × payout × sqrt(p × (1-p))`. This penalty is a **user-chosen risk adjustment**, not an official game rule. The maximum recommended bid is the smaller of remaining cash and this risk-adjusted estimate, floored at zero. At 0% downside the limit is the risk-neutral expected value; at 100% it subtracts one standard deviation. For a certainty-equivalent known contract with probability 100%, the penalty is zero.

Without any observed rival winning bid, the proposed **entry bid** is an exploratory 70% of the ceiling. If you observe past third-place winning bids for the same type of item, it instead suggests $1 above their median, capped at your ceiling. These are negotiation/auction heuristics. There is **no guaranteed optimal bid** without the opponents' future sealed bids, and the packet does not promise third-place bids will be revealed.

The auction screen has distinct controls for **Save observed cutoff** (information only) and **Record won item and cash paid** (changes holdings). They cannot be conflated.

## Opponent strategy and limitations

The Opponents panel stores each identifiable rival's prior asks, bids, and accepted/rejected results. It reports their highest recorded bid, lowest recorded ask and observed acceptance counts, without claiming to infer unseen cards or calibrated willingness-to-pay distributions. A **currently recorded open** rival sale offer is scored as your marginal card gain minus the cash price; a rival purchase offer is scored as cash received minus your marginal loss from selling that card. Only positive, affordable opportunities are surfaced. Accepted or rejected historical offers remain evidence and are not assumed still executable.

This does **not** optimize an opponent's private hand, an entire 40-team equilibrium, the true chance a bounty condition will hold, or final placement. Negotiating teams can be strategic, change prices or withdraw quotes. The app avoids speculative automatic completion and makes you confirm actual trades. Ties in a round are broken by a higher **number of trash cards**; the tool displays holdings but does not assume a tie is likely enough to override a known point gain. Game placement is the lower average across three round ranks, with summed points as the next tiebreak.

## Privacy and operational notes

The competition prohibits showing private cards to other teams, so **do not expose the Hand screen to rivals**. The panel stores your data only in the browser's localStorage, which persists between refreshes on the same origin/device; it is not synchronized across your phone and computer. Do not use its clock or its prices as a substitute for the actual competition clock or instructions. The source is public, but your individual card entries are never written to the repository.
