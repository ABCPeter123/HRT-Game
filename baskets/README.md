# Baskets: live trading decision panel

Game 2 of the Waterloo Quant Club Fall 2026 Trading Competition. Source: the official competition packet, pages 8–9. A team of two trades three baskets for three 10-minute rounds; each round has six teams in a room. Rooms shuffle between rounds.

The panel works on mobile and desktop and makes local, synchronous recommendations. It has no official exchange API, reliable event-bot identifier, or order-submission connection. You can enter quotes manually or enable optional read-only browser capture after mapping the actual game interface. Event-bot classification and trades remain manual. It does not submit orders.

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

## Execution Desk: two-person trading workflow

The Baskets page now opens on the **Execution desk** tab by default. The three main tabs are **Execution desk**, **Price alerts**, and **Market analysis / setup**. The analysis tab retains the full existing market input, event-flow, orderbook, fill journal, settings and portfolio views.

The execution desk separates four actions that must not be confused:

1. **Recommend:** The large live action shows the current candidate side, basket, limit price, and shares. It can say HOLD, which means no qualified trade. Modeled opportunities can change as quotes or event observations change.
2. **Call:** Click **Copy instruction + queue call**. This creates a local reference such as \`R1-001\` and copies the exact limit-order instruction with a reply format. Send that copied text to your teammate through the communications channel you already use or read it aloud. A queued call is **not an order** and is **not proof that your teammate received it**. Identical unresolved calls cannot be queued again accidentally.
3. **Teammate executes and reports:** The teammate submits the actual order in the game, then replies using the reference ID, e.g. \`R1-001 WORKING\`, \`R1-001 PARTIAL 8 @ 399.50\`, or \`R1-001 FILLED 20 @ 399.50\`. \`ACK\`, \`CANCELLED\`, and \`REJECTED\` are also supported, and \`PLACED\` is an alias for WORKING.
4. **Record without typing (recommended):** In **QUICK REPORT · NO COMMAND TYPING**, choose the outstanding order ID, tap **Acknowledged**, **Order working**, **Partially filled**, **Fully filled**, **Cancelled**, or **Rejected**, then press **Record selected status**. For a fill, use the 25% / 50% / 75% quantity buttons or the exact share input; a full fill selects the original order size. Confirm the **actual cumulative average fill price** with the executing teammate. You may tap **Use order limit as actual fill price** only if that is truly the reported average. The exact command appears in the preview and can be copied with **Copy command**. The old typed-command box stays available under **Advanced** for pasted replies. Repeated fill reports apply only the new quantity, preventing double counting.

All recorded calls, statuses and alerts are saved by competition round in browser localStorage. The active-call counter helps you track orders awaiting a reply. The teammate does not automatically receive a message, and there is no real-time shared multi-device database. Exchange order placement and teammate communications take place outside the app.

If you enter the wrong status, **Correct last local status** safely rolls back the most recent teammate report, including its locally recorded fill and position change. It refuses to roll back if another fill or inventory change happened afterward. This correction affects only your local model; it **does not cancel or reverse an exchange order or fill**. After correcting, enter the accurate cumulative status from the teammate.

**Inventory accounting:** When a WORKING order is manually confirmed, its unfilled shares enter the appropriate open-buy/open-sell total. Partial fills reduce the outstanding shares and adjust filled position and cash. Cancellation or rejection releases the remaining reservation. The app enforces the exchange's worst-case ±1,000 per-basket capacity when accepting a status. If the browser extension is already reading live position and open-order totals, those mapped values take priority, and manual execution reports do not add the same fill or order a second time. An imported position without a complete transaction ledger cannot produce trustworthy historical PnL. Do not also enter these same orders independently in the manual working-order fields, or you can count them twice.

**Important:** A pasted \`FILLED\` report is a teammate's statement, not an independent exchange confirmation. Check the reported shares and price against the actual game before using it. The full-fill report must equal the requested quantity. Use PARTIAL when only part of the order executed. The legacy manual fill journal remains available in Market analysis / setup.

### Price-alert review and event confirmation

The **Price alerts** tab monitors changes in *valid quoted basket midpoints*. It supports both manual quote changes and the optional Chrome read-only capture feed. A new valid book establishes a starting reference. When the midpoint moves at least the configured threshold (default **$1.50**, three price ticks) within **20 seconds**, an in-app pop-up asks for review. There is an **8-second cooldown per basket** to avoid excessive notifications. You can choose $1.00, $1.50, $2.00 or $3.00 thresholds. The alert list retains previously reviewed and dismissed observations.

- **Review and classify:** Opens a focused panel showing basket, move direction, previous midpoint, current midpoint and elapsed time.
- **Suspected event:** Only after you explicitly enter the signed executed volume you actually observed. The existing suspected-event confidence setting discounts it when estimating theoretical settlement.
- **Confirmed event:** Only when you can reliably identify the event bot and know the executed volume. Adds the exact signed event volume to the official settlement formula.
- **Ordinary public tape:** Adds user-observed trade volume as public tape. It never affects theoretical settlement.
- **Reviewed, no volume evidence / Dismiss:** Records the alert without modifying event volume.

**Optional desktop notifications:** From the Price alerts tab, click **Enable desktop notifications** to request browser permission. When permission is granted, the page can also show a Chrome desktop notification for a newly detected move while you are using the game tab. The in-page popup and queued review history work without desktop permission. If browser background throttling suspends the page, a notification may be delayed or never appear.

**Live quote freshness:** Once the local capture bridge is connected, the execution model only treats baskets with a complete bid and ask received in the last **4.5 seconds** as eligible for a new teammate call. Books omitted from the feed are kept in storage for reference but excluded from live trade suggestions until fresh data arrives. The desk shows a fresh-book count and lists stale instruments. Manual-only mode still relies on your judgment about how recently quotes were entered.

**Price movement by itself is not event-bot flow.** The app never converts a $1.50 repricing into an invented number of event-bot shares, nor automatically adjusts settlement from the price delta. Buy- and sell-initiated volume must be confirmed by the user independently of the price direction. Your classification can also disagree with the price direction. Multiple alerts may be queued for review; the in-app pop-up offers **Review and classify** or **Later**.

Alerting only runs while the local panel/browser capture is operating. Background-tab scheduling can be throttled by the browser, so it is an in-app assistance tool, not a guaranteed always-on push notification service or a verified event-bot detector. If live capture omits a basket, the model retains its last entered quote, which might be stale. A new game round resets the intraround price-watch baseline to avoid treating prices from a previous round as a sudden new event.

## Faster entry and optional automatic reading

The Baskets panel now has **three complementary input modes**. All three update the same local fair-value engine and keep data saved in your browser.

### 1. One-screen quote grid (fastest fallback)

The top-left **All three baskets** grid displays GRID, CURE and SAFE together. Each row shows **Bid**, **Ask**, and your signed **Position**. Move from field to field with Tab. Inputs immediately update the recommendation. All other fields, such as displayed sizes or working orders, remain in the detailed basket tab.

### 2. Paste three quote rows

Open **Paste quotes from a table or clipboard** and paste:

\`\`\`text
GRID 399.5 400.5 100 80 0
CURE 398.5 400.0 55 70 -25
SAFE 401.0 402.0 90 85 40
\`\`\`

Columns are \`SYMBOL BID ASK [BID_SIZE ASK_SIZE POSITION]\`, with brackets meaning the final three fields are optional. A minimal quote row such as \`GRID 399.5 400.5\` is valid. Additional optional columns \`OPEN_BUYS OPEN_SELLS\` are supported after position, for seven numbers total. You can also paste labeled lines such as \`GRID bid 399.5 ask 400.5 position -25\`. A simple copied CSV with a \`symbol,bid,ask,...\` header is recognized.

Press **Apply checked rows**, **Read clipboard & apply**, or Ctrl+Enter while the paste box is focused. The parser validates all rows, price ticks and positions. It rejects malformed or crossed markets rather than silently inventing data. Imported lines never modify event-bot volumes.

### 3. Chrome read-only DOM adapter (requires matching the actual game)

The event rules packet gives the settlement mathematics and orderbook rules, **but does not specify the game URL, API, WebSocket, HTML fields or a supported automated data feed**. Therefore the adapter can be prepared in advance, but its selectors must be mapped and tested once the competition website is available. It does **not** read a canvas-only interface or undocumented internal exchange traffic.

This adapter uses a zero-dependency loopback bridge and a locally loaded Chrome extension. It reads only user-selected, visible numeric fields from the game tab and sends them to your local Baskets panel. It does **not** access account credentials, submit trades, place orders, click the exchange, or send captured data to Vercel or any external host.

**Step A: Start the local panel and bridge.** From the repository root, open two terminals:

\`\`\`bash
# terminal 1: local Baskets website
python -m http.server 8000
\`\`\`

\`\`\`bash
# terminal 2: one-time local capture session
node baskets/bridge/server.mjs
\`\`\`

The bridge listens on \`127.0.0.1:8765\` and prints a **fresh 36-character session key**. Keep that terminal open. The key is required for both sending and reading snapshots, so random web pages cannot use your local feed.

**Step B: Load the extension locally.** In Chrome visit \`chrome://extensions\`, turn on Developer mode, choose **Load unpacked**, then select \`baskets/bridge/extension/\` from your local repository folder. This is a source-only Chrome extension, not a store install. Its site permission is the game tab you explicitly activate plus the local bridge.

**Step C: Map the game's visible numeric fields.** Open the actual Baskets trading page, then click the **Baskets Local Market Reader** extension button. Paste the bridge session key and save. For each GRID, CURE and SAFE, click **Pick** next to **Bid**, then click the visible best-bid number in the actual game. Repeat for **Ask**, for six selections in total. If useful, map quote sizes, your positions and working-order sizes. The extension stores field extraction rules locally for that website. You may type/edit a CSS selector instead of picking it.

**Symbol-locked tracking (recommended for moving orderbooks):** Use the extension's **Follow GRID / CURE / SAFE dynamically** checkbox on each mapped field. This binds each value to its *symbol name*, not an absolute row index. On every capture tick, the extension searches the current visible DOM for a unique matching instrument row, then reads that row's field. It works even if rows are reordered or replaced, as long as the symbol is readable and the row structure remains supported.

The **Pick** action tries to configure this automatically. After updating the extension, **reload the extension at \`chrome://extensions\` and refresh the game tab** before picking again. Existing mappings remain intact, but legacy Element # or Number # rules are not automatically converted because that could silently misassociate a quote. Enable the checkbox and verify each one, or Pick again.

The dynamic mapping offers a **Row CSS selector** and four field-detection methods:

- **Label or table heading (recommended):** Reads a value paired with the Bid / Ask text or an HTML table column heading, even when the fields themselves change order. If both methods are available but disagree, the field is rejected rather than guessed.
- **Labeled value:** Reads a specific field near its visible label, e.g. \`GRID Ask 400.5 Bid 399.5\`. Reversing label order does not reverse which number is bid.
- **Table column heading:** Finds the column currently headed \`Bid\` or \`Ask\`, then reads that column in the identified symbol row, even after columns are reordered.
- **CSS selector within row:** Finds a field such as \`[data-field="bid"]\` only within the row currently identified as \`GRID\`. This supports nonstandard labels or an explicit \`data-price\` attribute. A selector matching multiple values inside that row is rejected.

For ordinary HTML tables, set Row CSS selector to \`tr\`. For custom layouts, try a common instrument-row class such as \`.quote-row\` or a stable attribute selector such as \`[data-symbol]\`. **Do not** use an absolute \`:nth-child(...)\` selector in symbol-locked mode. The actual site markup is not available, so you must confirm which row selector is correct on the game page. Click **Check** next to each field and confirm the returned symbol, field and current value before starting the reader.

If the symbol disappears, the row selector matches several rows bearing the same symbol, both label and header methods disagree, or the field becomes ambiguous, that field **stops updating**. The extension does not reuse the first row or silently fall back to an index. A missing quote may leave the last saved value visible, but the Execution Desk's stale-quote safeguard excludes it from new calls during connected capture.

**Verify every mapped value before capture.** Reopen the extension and click **Check** beside a field, or **Check all six bid/ask fields**. The preview shows exactly which numeric value would be read. A selector that matches several rows, or an element with several numbers, is intentionally *ambiguous* and will not be captured until you specify its index.

For example, suppose a single container displays `GRID Bid $399.50 Ask $400.50 Size 100`. Select that container as the Bid field, set **Number # = 1**, and click Check. For the Ask field, use the same selector but choose **Number # = 2**. If `.price` matches a list of prices, choose **Element #** as well (1 = first matching element, 2 = second). If numbers are stored in an HTML attribute instead of text, enter the attribute name, for example `aria-label` or `data-price`. Blank number and element indices mean automatic selection only when there is exactly one possible match.

If a selected element or numbered value disappears as the page updates, capture of that particular field stops rather than falling back silently to another number. Recheck mappings if the competition UI changes. If the game shows just one basket at a time, the extension can start with one verified visible bid/ask pair and pick up other mapped books when you switch tabs. The strategy panel shows which symbols the latest snapshot updated. **A basket not present in the latest snapshot retains its previous value and may be stale.** Check timestamps and avoid treating missing live quotes as current. Chrome's picker handles ordinary DOM elements only. It does not currently traverse canvas graphics, closed shadow roots or inaccessible iframe content. Those interfaces require another, separately tested adapter.

Click **Start / refresh capture** in the extension. Keep the game tab open.

**Step D: Connect the strategy panel.** Open \`http://localhost:8000/baskets/\`, paste the same bridge key in **Game tab capture**, and click **Connect**. The panel will poll the relay roughly every 700 ms, merge only fields supplied by the extension, and show **CAPTURING**, **AWAITING GAME**, or **BRIDGE OFFLINE**. Chrome may throttle background tabs, so a data-age indicator distinguishes a fresh feed from stale data. There is an explicit **Stop** button.

**What is and is not automatic:** Visible best bids, best asks, displayed sizes, positions and open-order totals can auto-update *if and only if you successfully map their DOM elements and the site exposes them as text or input values*. The competition packet does not promise that event-bot orders carry identifying labels. Event flow therefore remains a manual, explicitly classified input. Public trade volume must never be silently treated as confirmed event-bot volume.

**Inventory caution:** If the extension reads your live position, the tool will not let you also log a manual fill for that basket while the connection is active, because that would double-count a position already updated by the exchange. The historical PnL estimate stays unavailable if inventory was imported without its complete transaction history.

**Security and limits:** The bridge binds to loopback only. It accepts only mapped numeric values for known basket fields, rejects other data, enforces a per-session secret, does not retain captures on disk, and forgets them when the server stops. The extension's only external host permission is \`127.0.0.1:8765\`. The actual game domain does not require blanket host permissions. Some games prohibit browser extensions or automation in their competition rules; confirm that read-only capture is permitted before using it during scored play. The adapter has not been integration-tested against the competition's actual trading UI because its URL and markup were not provided.

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
