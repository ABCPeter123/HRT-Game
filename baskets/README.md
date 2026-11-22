# Baskets: live trading decision panel

Game 2 of the Waterloo Quant Club Fall 2026 Trading Competition. Source: the official competition packet, pages 8–9. A team of two trades three baskets for three 10-minute rounds; each round has six teams in a room. Rooms shuffle between rounds.

The panel works on mobile and desktop and makes local, synchronous recommendations. It has no server, financial data feed, event-bot identifier, or exchange connection. **You must enter quotes, signed flow, actual fills and open-order sizes yourself.** It does not submit actual orders.

## Run locally

From the repository root:

\`\`\`bash
python -m http.server 8000
\`\`\`

Open \`http://localhost:8000/baskets/\`. For tests:

\`\`\`bash
cd baskets
npm test
\`\`\`

The site build includes these files as a separate panel, but **automatic Vercel deployments are paused** by the project settings and root \`vercel.json\`. No deployment is needed to use this updated code locally.

## Fast game workflow

1. Choose **Round 1**, **2** or **3** and start the optional 10-minute local countdown. Switch between the **GRID**, **CURE**, and **SAFE** tabs with a tap or Alt+1, Alt+2, Alt+3.
2. Enter the **best bid** and **best ask** shown for each basket. Both must be half-dollar ticks and within $0–$800. If the top-of-book displayed quantities are shown, enter them. Otherwise leave sizes blank. The engine then uses only a small provisional executable-depth allowance.
3. Record directional flow with the buttons. Use **Confirmed event** only if you can reliably identify a trade as belonging to an event bot. Use **Suspected event** for uncertain directional bursts. Use **Public tape** for ordinary observed prints. The public tape **never** affects modeled settlement.
4. Read the **BEST ACTION RIGHT NOW** panel. It displays BUY or SELL, basket, a limit price, share quantity, and whether to take available liquidity or post a passive quote. If the inputs are insufficient or no opportunity clears the risk filter, it says **HOLD**. Click **Copy order** for the order text.
5. After submitting the order **in the actual exchange**, use **Copy into fill draft** to populate the journal with the suggested order. **Record filled trade** only after seeing an actual fill. Positions and cash are then updated locally. Manually update outstanding working buy/sell shares for still-open orders.
6. Use **Record market snapshot** after a significant repricing. Updated quotes, public tape, exposure, and event-flow entries refresh the strategy and opponent-counter panel. The app also records changing bid/ask input on focus change.
7. Monitor your TEK/NRG/MED exposure and the illustrative ±200-share event stress. The game ranks teams by marked-to-settlement PnL, then average round placement.

Inputs automatically save in this device's browser storage for each round. **Undo** reverses the most recent flow entry or the most recent fill, respectively. Game data in round 1 does not overwrite round 2.

## All input fields explained

| Input | What to type | Effect |
| --- | --- | --- |
| Round | 1, 2 or 3 | Keeps three separate orderbooks, event totals, fill histories and countdowns |
| Timer | Start / Pause / Reset | Reference 10-minute timer; not the official clock |
| Basket tab | GRID, CURE, SAFE | Selects the instrument whose book and signals you are editing |
| Best bid / best ask | Highest buy / lowest sell **limit price** from the exchange, e.g. 399.50 and 400.50 | Determines executable orders, passive quotes, spread and market-implied underlying indices |
| Displayed bid size / ask size | Share quantities at the best quote; optional | Caps a marketable sell/buy respectively; missing depth uses a cautious 20-share fallback |
| Position | Signed filled shares, +long, −short | Controls exposure and capacity; a manual override disables historical PnL calculation |
| Working buy / sell shares | Total unfilled outstanding shares on that side, including all orders | Reduces available worst-case inventory capacity |
| Flow mode | Confirmed, Suspected or Public tape | Separates actual settlement-relevant events from uncertain flow and unrelated orderflow |
| Flow buttons / custom volume | Signed **share** volume, + for event buys and − for sells, e.g. +50 | Adds to the current basket's volume counter. Undo reverses the last entry |
| Suspected-event confidence | 0–100%, defaults to 35% | Only that fraction of suspected net event flow contributes to the model's expected settlement |
| Downside sensitivity | 0–100%, defaults to 35% | Increases penalty for uncertain fair value and adding to crowded inventory; not a maximum-loss cap |
| Order size cap | 1–1,000 shares, defaults to 100 | User-chosen upper limit for any single suggestion |
| Fill side | BUY or SELL | Side of the actually executed trade |
| Filled shares / fill price | Number and execution price of filled shares | Updates position and cash after confirmation |
| Record snapshot | Tap after observing changes in the selected book | Captures an explicit midpoint/spread observation for market-behavior inference |

The application contains inline help alongside book inputs and a fold-out guide under each panel.

## Exact settlement equations

Each underlying index starts at $200. Signed event-bot net volume is \`QGRID\`, \`QCURE\` and \`QSAFE\`, positive for buys and negative for sells.

\`\`\`text
TEK = 200 + (2*QGRID + QCURE)/200
NRG = 200 + (2*QGRID + QSAFE)/200
MED = 200 + (QCURE + QSAFE)/200

GRID settlement = TEK + NRG
CURE settlement = TEK + MED
SAFE settlement = NRG + MED
\`\`\`

Basket settlement values are rounded to the nearest $0.01 in the competition, but **order prices** must be on $0.50 ticks. The engine keeps unrounded fair-value calculations and displays cents for readability.

Example: if the event bot buys 100 GRID shares and makes no other trades, predicted indices become TEK $201, NRG $201, MED $200. Thus GRID settles $402, CURE settles $401, SAFE settles $401 **if no future event-bot trades change those totals**.

A live trading round includes additional events with randomly selected directions. There is no justified estimate for the directions of future random events from the packet. This engine forecasts only known/assumed event volume, not unknown future events.

## Risk, orderbook and opponent logic

**Price-time priority:** The orderbook fills the best price first; among equal prices, earliest submitted orders fill first. Limit-only execution means even an aggressive buy should be submitted as a BUY limit at the displayed ask, and vice versa. Passive recommendations improve a best bid or ask by one half-dollar tick if that still leaves the order resting.

**Inventory cap:** Each basket must remain within ±1,000 filled shares, including possible fills from any existing resting orders. The tool calculates \`buyCapacity = max(0,1000 − position − workingBuys)\` and \`sellCapacity = max(0,1000 + position − workingSells)\`. It recommends a smaller amount when the relevant quote shows less displayed liquidity.

**Opponent counters:** The game has customer bots that fill quotes, maker bots posting passive orders and event bots sending bursts. The panel compares three market-condition patterns: tight market making, aggressive directional chasing, and fading flow. It assigns *heuristic scenario weights* based on spreads, displayed depth, user-entered public prints and saved midpoint changes. These are not observed identities or calibrated probabilities of human competitors. The counter explanations update with changing inputs. The recommendations choose between crossing the spread, posting passive orders, and no trade as the book and modeled settlement change.

**Downside sensitivity:** Increasing the slider penalizes model uncertainty in fair value and continued accumulation in an existing position. It does not impose a loss cap, estimate future event directions, or guarantee a favorable competition placement. Score ranking uses illustrative fill weights; customer-bot fill rates are not specified numerically in the packet.

**Stress test:** The portfolio view computes how much the current inventory would lose if a *single* event bot added +200 or −200 net shares in one basket. This is an illustrative scenario. Other future events and losses can exceed it.

**PnL:** If every execution has been recorded from a zero starting position, estimated marked-to-model PnL is \`sum(fill_cash_flows + filled_position * modeled_basket_settlement)\`. This is only an estimate, not actual marked-to-final-settlement PnL. Manually changing position disables that result because historical cash flows are unknown.

## Source and constraints

The competition packet, pages 8–9, specifies three 10-minute rounds, six-team rooms, limit orders on 50-cent ticks between $0 and $800, ±1,000-share position bounds, customer bots, event bots and maker bots. It specifies relative customer and event fill sizes as a function of market width but **does not publish numeric bot fill-rate distributions**. It also does not guarantee individual event-bot trade labels in the public feed. Treat all observed-flow classifications, counter probabilities, and expected fill rates as subjective heuristics, not packet-defined values.
