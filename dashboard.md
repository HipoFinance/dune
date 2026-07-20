# Dashboard layout

The Hipo dashboard is assembled top-down from the queries in [`queries/`](queries/). Each
query is a standalone Dune query; a visualization is added to it and then embedded on the
dashboard. Titles are prefixed **"Hipo — "** and tagged `hipo`, `liquid-staking`, `ton`,
`hgram` so dune.com search surfaces them.

Order the dashboard as below. Chart types are suggestions; follow the contract repo's
`dataviz` guidance for palette and labeling, and put the accuracy caveat in each approximate
panel's description.

## 1. Headline (stat tiles, full width)

Counters showing the latest value of each series. Add each as a "Counter" visualization on
its source query (or a small dedicated `... LIMIT 1` counter query if you prefer).

| Tile | Query | Field (latest) |
|---|---|---|
| TVL (GRAM) | `tvl.sql` | `tvl_gram` |
| APY | `apy.sql` | `apy` (format %) |
| hGRAM supply | `hgram_supply.sql` | `hgram_supply` |
| Holders | `holders.sql` | `holders` |

## 2. Size & rate

| Panel | Query | Chart | Notes |
|---|---|---|---|
| TVL over time | `tvl.sql` | Area (`tvl_gram`) | Exact (`total_coins`, from the rate dataset) |
| hGRAM supply | `hgram_supply.sql` | Area (`hgram_supply`) | Exact; state-derived; trails realtime by up to a day (Dune balances refresh daily) |
| Exchange rate | `exchange_rate.sql` | Line (`rate`) | Exact (from the rate dataset; matches the app) |
| APY | `apy.sql` | Line (`apy`, %) | Exact (from the rate dataset) |

## 3. Flows

| Panel | Query | Chart | Notes |
|---|---|---|---|
| Deposit volume | `deposit_volume.sql` | Bars (`gram_in`) | Near-exact |
| Unstake volume | `unstake_volume.sql` | Bars (`hgram_burned`, or `gram_out_est`) | GRAM column approximate |
| Net flow | `net_flow.sql` | Bars (`net_flow`) + line (`cumulative_net_flow`) | Withdrawal leg approximate |

## 4. Users

| Panel | Query | Chart | Notes |
|---|---|---|---|
| New stakers | `stakers.sql` | Bars (`new_stakers`) | Exact; first-ever depositor |
| Cumulative stakers | `stakers.sql` | Line (`cumulative_stakers`) | Exact |
| Holders over time | `holders.sql` | Line (`holders`) | Exact at weekly samples |
| Holder distribution | `holder_distribution.sql` | Bars / donut (`holders` by `balance_bucket`) | Exact; concentration |

## 5. Operations

| Panel | Query | Chart | Notes |
|---|---|---|---|
| Round activity | `round_activity.sql` | Bars (`stakes_sent`, `recoveries`) + line (`active_borrowers`) | Best-effort; counts exact, amounts omitted |

## Text widget (top of dashboard)

Add a short markdown widget describing Hipo, linking to https://hipo.finance and the contract
repo, and stating the accuracy convention: **exact** vs **approximate** panels, and that the
authoritative figures live in the treasury getters (`total_coins`, `current_rate`). Keep this
in sync with `README.md`.
