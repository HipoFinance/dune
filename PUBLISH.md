# Publishing the Hipo dashboard on Dune

This repo is the source of truth for the SQL. Publishing is manual (no API automation in v1).
The goal: **anyone searching "Hipo" on dune.com finds the dashboard.** That requires
publishing under a Hipo-named team with consistent titles and tags.

## 1. Create the Hipo team

1. Sign in to <https://dune.com>.
2. Create a team: **Settings → Teams → Create team**. Handle **`hipofinance`** (the queries and
   the exporter already reference `dune.hipofinance.dataset_treasury_rate`). Set the display
   name to **Hipo**, add the logo, and a one-line bio linking to <https://hipo.finance>. A
   public team page is itself a search landing spot.
3. Work inside the team (switch the active context to the `hipofinance` team) so every query and
   the dashboard are owned by the team, not your personal account.

> A free plan can create public queries and one dashboard, which is enough for v1. Query
> creation via the **Dune API** (a possible future automation) needs a paid plan — out of
> scope here.

## 2. Set up the rate dataset (needed for `exchange_rate` / `apy` / `tvl`)

The exchange rate, APY and exact TVL are treasury-getter values that can't be queried from
Dune's raw tables, so they come from an uploaded dataset fed by [`exporter/`](exporter/).

1. Create a **Dune API key** (Settings → API) and note it.
2. Seed the dataset once: `cd exporter && npm install && DUNE_API_KEY=… node export-rates.mjs`.
   This appends today's row to [`data/treasury_rate.csv`](data/treasury_rate.csv) and uploads it
   as the public dataset **`dune.hipofinance.dataset_treasury_rate`**.
3. Automate it: add the repo secret `DUNE_API_KEY` (and optionally `TONCENTER_API_KEY`,
   `TON_ENDPOINT`) so [`.github/workflows/update-rates.yml`](.github/workflows/update-rates.yml)
   refreshes it daily. See [`exporter/README.md`](exporter/README.md).

## 3. Create the queries

For each file in [`queries/`](queries/), in this order
(`hgram_supply`, `deposit_volume`, `exchange_rate`, `apy`, `unstake_volume`, `net_flow`,
`tvl`, `stakers`, `holders`, `holder_distribution`, `round_activity`):

1. **New query** in the `hipofinance` team. Paste the file contents.
2. The dataset-backed queries (`exchange_rate`, `apy`, `tvl`, `net_flow`, `unstake_volume`)
   already reference `dune.hipofinance.dataset_treasury_rate` — no edit needed, but that dataset
   must exist first (step 2 above).
3. **Verify the schema-dependent bits** flagged in each file's header comment. The column names
   below are already correct in the queries as of last validation — re-confirm only if a query
   errors:
   - **Addresses are raw with uppercase hex** (`0:HEX…`); lowercase returns no rows.
   - `ton.messages`: timestamp `block_time`; `opcode` as integer (decimals in the SQL); keep
     `direction = 'in'`.
   - `ton.jetton_events`: `type` in (`mint`/`burn`/`transfer`), `amount`, `jetton_master`,
     and `tx_aborted` (filtered out).
   - `ton.balances_history` / `ton.latest_balances` (supply, holders, distribution): `address`
     (holder), `asset` (jetton master, or `'TON'` for the coin), `amount` (absolute balance),
     `block_date`, `lt`.
   - The weekly `sequence(DATE '2024-01-01', …)` spine in `holders.sql`: set the start near
     hGRAM's first on-chain activity to trim empty rows.
4. **Run** and sanity-check against the validation steps below.
5. **Name** it exactly `Hipo — <metric>` (e.g. `Hipo — TVL (GRAM)`), matching
   [`dashboard.md`](dashboard.md).
6. **Save**, set visibility **public**, and add tags: `hipo`, `liquid-staking`, `ton`, `hgram`.
7. Add the **visualization** specified for that query in [`dashboard.md`](dashboard.md).

## 4. Build the dashboard

1. **New dashboard** in the Hipo team, titled **`Hipo — Liquid Staking on TON`**; tag it
   `hipo`, `liquid-staking`, `ton`, `hgram`; visibility **public**.
2. Add a **text widget** at the top (see [`dashboard.md`](dashboard.md) → "Text widget").
3. Add each query's visualization in the section order in [`dashboard.md`](dashboard.md):
   Headline stat tiles → Size & rate → Flows → Users → Operations.
4. On every **approximate** panel, put the method + bias in the panel description: unstake
   volume and the withdrawal leg of net flow are lower bounds (custom burns may be
   under-captured in `jetton_events`), and round/borrower GRAM amounts are omitted. (TVL, rate
   and APY are exact — from the dataset.)
5. Publish. Copy the dashboard URL into [`README.md`](README.md).

## 5. Validate (before and after publishing)

Cross-check against known-good sources (the contract repo's `scripts/` print the getters):

- **Supply / holders** match tonviewer/tonscan for the hGRAM jetton and `showJettonData.ts`
  (supply from `balances_history` trails realtime by up to a day — Dune balances refresh daily).
- **TVL** (`tvl_gram` = `total_coins`) matches `showState.ts` and is in the DefiLlama band.
- **Rate / APY** match `showState.ts` exactly (both come from the same getter values).
- **Stakers** track the contract repo's `scripts/analyzeJoiners.ts` over a shared window.
- Every query filters `block_date` (or a partitioned column) and re-runs to stable results.
- Logged out, all panels render and the dashboard is found by searching "Hipo".

## 6. Keeping it in sync

When a query changes, edit the `.sql` here first, then paste into the corresponding Dune
query and re-save — the repo stays the source of truth. On a **parent (hGRAM master)
upgrade**, update the raw address in every query flagged `>>> ... on a parent upgrade <<<`
(supply, rate, tvl, holders, holder_distribution, unstake_volume, net_flow) and, for full
history, union the old and new masters.
