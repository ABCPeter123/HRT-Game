# Game 5: Liar's Market live decision panel

A small, dependency-free browser app for the Waterloo Quant Club Fall 2026 competition. It models the *regular scored rounds* of the physical Liar's Market card game. It does not read hidden cards, read the real table, or make decisions for you automatically.

## Start

From the repository root:

    python -m http.server 8000

Open http://localhost:8000/liars-market/ and enter your current information. No backend, API key, model download, or Vercel deployment is needed. Run tests with:

    cd liars-market
    npm test

Source of competition rules: official WQC Fall 2026 Trading Competition packet, pages 17-19. The packet overview says *eight* sub-games per round while the detailed rules say *five*. The panel defaults to eight but supports both. Verify with your table's proctor.

## Fast turn workflow

1. Select Round 1–3 and the sub-game. The four seats correspond to clockwise teams; set **My seat** once. Enter current scores so the model knows how many private cards the proctor deals to each team.
2. Tap **My hand** and select each private card in the 4-by-13 card grid. Tap **Face-up center** and select the three visible center cards. Each physical card can be selected only once. Add newly revealed center cards after the marker team reaches its second and third turn. Enter Jokers exactly.
3. For an opponent's claim, type shorthand such as **2P Q 8** (two pair, Queens and Eights), **FH 9 4** (full house, 9s and 4s), or **SF K** (King-high straight flush), and press Enter. Alternatively use the tap-based claim builder. Select the claimant's seat.
4. The main card immediately says **BLUFF**, **NUTS**, or **PASS**, with conditional probabilities and the estimated value of the two challenge calls. If it is your turn to make a claim, tap the strongest recommended **legal next claim**, then speak it in the actual game. This overwrites the on-screen latest claim and selects you as its claimant.
5. After a sub-game ends, choose **Challenge / ending** and the other team, then **Record result + next**. The panel transfers points according to the exact hand-tier scoring and uses the new totals to calculate next sub-game card counts. Undo the latest result if entered incorrectly. Earlier revealed results in *this* round give conservative credibility updates for the corresponding claimant.
6. Use the 10s / 15s / 30s timer buttons for a local reference clock. Teams receive four +15s extensions per round, tracked via **Use 1** in each seat's scoreboard entry.

Inputs persist in this browser's localStorage. All Monte Carlo draws run locally. The decision engine samples 400 reproducible possible unseen deals, keeping entered physical cards fixed.

## All inputs

| Input | What it means |
| --- | --- |
| Round | The current 20-minute round, 1–3. Tables reshuffle each round; claim credibility does not carry across rounds. |
| Sub-game | Which dealt hand of the round is currently being played. |
| Hands / round | 8 according to packet structure; 5 according to the packet's later procedure. |
| Latest claim / shorthand | Highest hand just spoken: HC high card, P pair, ST straight, 2P two pair, TR three of a kind, FH full house, 4K four of a kind, SF straight flush, 5K five, 6K six. |
| Main / second rank | Rank for claim. Two pair: higher pair then lower pair. Full house: triple then pair. Straight or SF: top card (A-2-3-4-5 is 5-high). |
| Who claimed it? | Team that made the latest claim; used for round-specific opponent model. |
| My hand | Your team's known private cards. Enter *all* of them; the app flags missing cards. |
| Face-up center | Three face-up common cards, then the remaining two as they are revealed. The other center cards stay hidden. |
| My seat | Your team's fixed clockwise seat index for this round. |
| Scores | Points *before* the current sub-game; changes your number of cards and the hidden-card sampling model. |
| Downside sensitivity | Adds a penalty for risk of losing a challenge or being caught bluffing; 0 maximizes call/claim heuristic expected points. |
| Challenge / ending | Observed end-of-sub-game result: correct or incorrect BLUFF/NUTS, or a forced end. |
| Other team | The other team involved in the result; their score receives the opposite point change. |
| If NUTS wrong, claim exists? | Optional verified truth. A failed Nuts call does not imply the claim was false. |
| Extensions | Click Use 1 only after spending one of that team's four time extension cards. |
| Timer | 10s reaction, 15s claim, or 30s with one extension; not the organizer clock. |

## Exact rules implemented

The ranking order from strongest to weakest is six of a kind, five of a kind, straight flush, four of a kind, full house, three of a kind, two pair, straight, pair, high card. No ordinary flush exists in this game. Equal classes compare their relevant ranks as described in the packet. All 54 cards are in the original deck, including two wild Jokers. A straight may be 5-high with Ace low or A-high with Ace high.

A claim must beat the previous claim. Six-of-a-kind Aces is the highest legal claim, so no stronger claim is possible.

On a BLUFF challenge, an existing claim earns the claimant 1/2/3 points depending on class; a nonexistent claim costs the claimant 3/2/1 points. Lower classes earn 1 and cost 3; full house and four of a kind earn/cost 2; straight flush and above earn 3 and cost 1. For NUTS, the claim must exist *and* equal the best possible active hand. A correct Nuts challenge costs the claimant 4 points, and an incorrect one earns the claimant 1. The opponent gains the same amount the claimant loses and vice versa.

Catchup dealing is 7 cards if score ≤−6, 6 if ≤−4, 5 if ≤−2, 4 if the score is −1 through 1, 3 if ≥2, 2 if ≥4, and 1 if ≥6. Five center cards are always dealt, three face-up initially.

## What is modeled and what is not

The conditional hand *existence* and *Nuts* probabilities come from sampling unknown active cards without replacement from the 54-card deck. This treats unknown cards as a uniform random deal. It cannot see the other teams' cards. Hand evaluation enforces wild Jokers and each rank's exact tie-break ordering.

Prior revealed claim outcomes in the current round produce a Beta(2,2)-shrunk claim-credibility estimate for each seat. The engine modestly uses that estimate as likelihood evidence when evaluating an opponent's current claim. This is an imperfect strategic assumption, not a calibrated probability of another human player's next move.

BLUFF and NUTS EV show the expected point transfer *if called*, using those probabilities. PASS is assigned zero immediate points and does not model future turns. The suggested next claim maximizes a documented **heuristic** of likely challenge payoff, claim pressure, and downside sensitivity. It is not a solved poker equilibrium, not a guarantee of winning the sub-game, and cannot predict the exact next players' reactions.

Straight-flush claims use the five-card top rank as the tie-breaker. The packet does not explicitly say whether a suit must be spoken as part of a straight-flush claim. The engine treats any qualifying suit as satisfying a top-rank straight-flush claim; verify the phrasing with the proctor.

The top-four grand finals use two-life elimination instead of ordinary points and catch-up cards. Do **not** use this regular-round scoring model to score grand finals.

All code is in this directory. There is no automated scraping or game integration and no Vercel production deployment.
