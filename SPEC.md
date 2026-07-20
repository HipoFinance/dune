# Hipo Dune Analytics Dashboard — Spec

> Seed spec for the **HipoFinance/dune** repo. Produced via the contract repo's `/spec`
> interview on 2026-07-19. Read this before generating any SQL or repo files. It is the
> durable record of what was decided and why; keep it in sync if the design changes.

## Problem

Hipo is a liquid-staking protocol on TON: users deposit GRAM into the treasury and receive
hGRAM jettons; the exchange rate accrues rewards each validation round. Today the only public
analytics is the DefiLlama listing, which is effectively **TVL-only** and gives no visibility
into growth, flows, holders, the exchange rate/APY trend, or validator-round activity.

TON is now a first-class chain on Dune (raw + decoded tables, updated daily), so the whole
protocol can be observed from SQL alone. We want a **public Dune dashboard that anyone finds
by searching "Hipo" on dune.com** — a richer, self-serve view of the protocol than DefiLlama,
backed by a versioned repo of the queries so they are reviewable and reproducible.

## Decision

Create a new standalone public repo **`HipoFinance/dune`** that holds the dashboard's SQL as
the source of truth, plus a manual publish guide. The live dashboard is published on Dune
under a **new Hipo team** so it is discoverable by search and shared-owned.

Decisions from the interview:

- **Scope = full protocol dashboard** (not DefiLlama parity). Panels: TVL, hGRAM supply,
  implied exchange rate & APY, deposit/unstake volume and net flow, new vs. cumulative
  stakers, holder count and distribution, and validation-round / borrower activity. See
  [Metrics](#metrics--query-manifest).
- **Discoverability = create a Hipo Dune team.** Queries and the dashboard are published
  under the `hipofinance` team; titles are prefixed "Hipo —" and tagged
  `hipo`, `liquid-staking`, `ton`, `hgram` so search surfaces them.
- **Sync = manual publish guide** (no API automation for now). The repo holds `.sql` files;
  a `PUBLISH.md` gives copy-paste steps to create each query on Dune and assemble the
  dashboard. An optional Dune-API sync script is explicitly out of scope for v1 (it needs a
  paid Dune plan) but the repo layout leaves room for it later.
- **Data source = raw/decoded TON tables on Dune only.** No dependency on Hipo's off-chain
  `api` service or any external HTTP. Everything is derivable from on-chain data.

This is a read-only analytics deliverable. It sends no transactions and does not touch the
contracts, wrappers, tests, or any mainnet state.

## Anchors (on-chain constants the queries hard-code)

Dune stores **all TON addresses in raw form with uppercase hex** (`0:HEX…`), so queries must
use the uppercase raw hashes — lowercase hex returns no rows. (The friendly forms are given
for humans / cross-checking on explorers.)

| Entity | Friendly (mainnet) | Raw (use in SQL) |
|---|---|---|
| Treasury (holds all GRAM) | `EQCLyZHP4Xe8fpchQz76O-_RmUhaVc_9BAoGyJrwJrcbz2eZ` | `0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF` |
| Parent = hGRAM jetton master | `EQDPdq8xjAhytYqfGSX8KcFWIReCufsB9Wdg0pLlYSO_h76w` | `0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87` |

Notes and caveats the generator must handle:

- The **hGRAM jetton master is the current parent**. Hipo has had *old parents* (see
  `showState.ts` "Old Parents"); a fully historical supply/holder series may need to union
  old parent masters. v1 targets the current parent and documents this limitation; the
  generator should leave a clearly-marked place to add old-parent addresses if history
  before the last parent upgrade turns out to matter.
- Confirm the exact raw form / friendly form Dune's `ton.jetton_metadata` records for hGRAM
  (name, symbol `hGRAM`, decimals `9`) during generation, and reconcile if it differs.

### Relevant Hipo op-codes (from `contracts/imports/constants.fc`)

Used to classify `ton.messages` by `opcode`. TON opcodes are 32-bit; store/compare as the
unsigned value shown (verify Dune's `opcode` column type — hex string vs. bigint — when
writing the first query and normalize consistently).

| Op | Hex | Meaning for analytics |
|---|---|---|
| `deposit_coins` | `0x3d3761a6` | user → treasury: a deposit (GRAM in) |
| `unstake_tokens` | `0x595f07bc` | user → wallet: an unstake request |
| `burn_tokens` | `0x7cffe1ee` | wallet → treasury: hGRAM burned for an unstake |
| `mint_tokens` / `tokens_minted` | `0x42684479` / `0x5445efee` | hGRAM minted to a depositor |
| `proxy_new_stake` / `new_stake` | `0x089cd4d0` / `0x4e73744b` | treasury/loan → elector: stake sent to a validation round |
| `recover_stake` / `recover_stakes` | `0x47657424` / `0x4f173d3e` | round recovery (stake + reward returned) |

Prefer the **decoded `ton.jetton_events`** table for hGRAM mints/burns/transfers over
hand-decoding message bodies; fall back to `ton.messages` + opcode only where jetton events
don't carry what a metric needs (e.g. GRAM value of a deposit).

## Dune TON data tables (reference for the generator)

All partitioned by `block_date` — every query MUST filter on it. Internal messages appear
twice (same `msg_hash`, `direction` in/out); filter `direction = 'in'` for analytics unless a
flow needs the out-leg.

- `ton.messages` — inter-contract messages: `source`, `destination`, `value` (nanoton),
  `opcode`, `body`, `direction`, `block_date`, tx/msg hashes.
- `ton.transactions` — per-account transactions.
- `ton.jetton_events` — decoded transfers / mints / burns: `jetton_master`,
  `amount`, event `type`, `source`, `destination`, `block_date`.
- `ton.jetton_metadata` / `result_ton_jettons_metadata_latest_values` — name/symbol/decimals.
- `ton.balances_history` — state-recovered, point-in-time balances; one row per `address` per
  balance **change**. Columns: `address` (holder raw address), `asset` (jetton master address
  for jettons, `'TON'` for the native coin), `amount` (absolute balance), `block_date`,
  `block_time`, `lt` (intra-day tiebreaker). This is the authoritative source for
  supply/holders/balances (jetton events cannot reconstruct them — see the caveat in the
  manifest).
- `ton.latest_balances` — current balances (same `address`/`asset`/`amount` columns); use for
  the current holder count / distribution / supply cross-check.
- `ton.prices_daily` — token prices, for an optional USD overlay.

Exact column names must be confirmed against the live schema when writing each query (the
Dune docs list tables but not every column); this list is the intent, not a frozen contract.

## Metrics & query manifest

Each bullet becomes one `.sql` file in `queries/`. Grouped by dashboard section. "Exact"
means fully determined by on-chain data; "approx" means a derived/estimated figure whose
method and error are documented on the panel.

**Size & rate**
1. `tvl.sql` — **TVL in GRAM** = treasury `total_coins`, from the rate dataset (see the
   pipeline section below). *Exact.* This is the authoritative TVL (it includes GRAM out on
   loan with the elector during rounds, which a raw treasury balance would miss).
2. `hgram_supply.sql` — **hGRAM circulating supply**, summed from jetton-wallet **balances**
   (`ton.balances_history`), *not* from mint/burn events. *Exact, state-derived.* This is the
   backbone supply metric. **Important:** Hipo mints via a custom, multi-phase (bill-based)
   mechanism that is not a TEP-74 `internal_transfer`, so `ton.jetton_events` under-tags mints
   and `SUM(mint) − SUM(burn)` undercounts by ~2× (~904k vs the true ~1,825,060). The TON data
   lake documents this directly: *"mints are not covered by TEP-74 … use the balance history."*
   This caveat applies to **every** balance/supply/minted-hGRAM figure — always derive those
   from balances, never from mint events.
3. `exchange_rate.sql` — **GRAM/hGRAM exchange rate** = `total_coins/total_tokens`, from the
   rate dataset. *Exact* (matches the Hipo app). The rate cannot be reconstructed from Dune raw
   tables (the implied "GRAM deposited ÷ hGRAM minted" estimate was overstated because mints
   undercount — see 2), so it is snapshotted from the treasury getter instead.
4. `apy.sql` — **APY** = `(current_rate/previous_rate) ^ (year/round_len) − 1`, precomputed by
   the exporter with the exact `scripts/showState.ts` formula and read from the rate dataset.
   *Exact.*

**Flows**
5. `deposit_volume.sql` — GRAM deposited per day/week: `ton.messages`, `direction='in'`,
   `destination = treasury`, `opcode = deposit_coins`, sum `value` (note fee caveat).
6. `unstake_volume.sql` — unstake volume per day/week from hGRAM burns
   (`ton.jetton_events` type=burn, hGRAM master), reported in hGRAM and in GRAM via the rate.
7. `net_flow.sql` — net GRAM flow = deposits − withdrawals over time; cumulative net flow.

**Users**
8. `stakers.sql` — **new stakers** (first-ever depositor per address: `min(block_time)` per
   deposit `source`) and **cumulative unique stakers** over time. Mirrors the definition in
   the contract repo's `scripts/analyzeJoiners.ts` (joiner = first-time depositor).
9. `holders.sql` — **hGRAM holder count** over time (distinct accounts with balance > 0) from
   `ton.balances_history` for the hGRAM master.
10. `holder_distribution.sql` — current holder **distribution** by balance bucket
    (whales vs. long tail; e.g. Gini / top-10 share) from latest balances.

**Protocol operations**
11. `round_activity.sql` — validation-round / borrower activity: stake sent to rounds
    (`proxy_new_stake`/`new_stake`) and recoveries (`recover_stake*`) from `ton.messages`
    between treasury and loan contracts; active borrowers per round, staked amount per round.
    *Best-effort* — mark clearly and refine against `showState.ts` participation data.

**Optional overlays** (only if cheap): USD TVL via `ton.prices_daily`; a single headline
"stat" tile block (current TVL, APY, supply, holders) for the top of the dashboard.

The dashboard lays these out top-down: headline stat tiles → Size & rate → Flows → Users →
Operations. Follow the contract repo's `dataviz` skill for palette/labeling when configuring
chart types, and label every approximate panel with its method.

## Exchange rate / APY / TVL: the snapshot pipeline

The exchange rate (`total_coins/total_tokens`), APY, and exact TVL (`total_coins`) are stored
treasury-getter values that **cannot** be reconstructed from Dune's raw TON tables. So a small
exporter samples them and publishes them to a Dune **uploaded dataset**:

- **`exporter/export-rates.mjs`** — calls `get_treasury_state` + `get_times` (toncenter v2),
  computes `rate` and `apy` with the exact `scripts/showState.ts` formulas, upserts one row per
  **round** (keyed by `round_since`) into `data/treasury_rate.csv`, and uploads the full CSV via
  `POST /api/v1/uploads/csv` (a full-replace endpoint; **public** upload, so no Enterprise plan
  — only *private* uploads need Enterprise). Note: the old `/v1/table/upload/csv` endpoint was
  removed 2026-03-01, hence `/v1/uploads/csv`.
- **`data/treasury_rate.csv`** — the versioned source of truth (columns: `ts`, `round_since`,
  `total_coins`, `total_tokens`, `rate`, `current_rate`, `previous_rate`, `apy`). Builds forward
  from the first run; each row self-contains `current_rate`+`previous_rate` so APY is valid from
  day one. Optional backfill from the `api` service's per-round `HtonRewardLog`.
- **`.github/workflows/update-rates.yml`** — cron every **6 hours** (rounds are ~18h, so every
  round is sampled ~3× and never skipped; `round_since` keying makes intra-round re-runs
  idempotent). Runs the exporter and commits the CSV. Needs repo secret `DUNE_API_KEY`
  (optionally `TONCENTER_API_KEY`, `TON_ENDPOINT`). Public-repo Actions and CSV upload are free,
  so the frequency costs nothing.
- On Dune the dataset is queryable as **`dune.hipofinance.dataset_treasury_rate`**; `exchange_rate`,
  `apy`, `tvl` read it directly, and `net_flow`/`unstake_volume` use it to value hGRAM burns in
  GRAM at the exact rate. The dataset-backed queries reference `dune.hipofinance.dataset_treasury_rate` directly.

This makes the rate/APY/TVL panels exact (matching the app) — the one class of metric Dune's
raw tables can't produce — at the cost of a tiny daily job you own. It is the reason the "future
enhancement" note from the first draft was pulled into scope.

## Repo layout (what the "generate" step will create)

```
dune/
  README.md            # what this is, link to the live dashboard, how it's built
  SPEC.md              # this file
  LICENSE              # match the contract repo (MIT)
  PUBLISH.md           # step-by-step: create the Hipo team, create each query, build the dashboard
  queries/             # one .sql per metric above, each with a header comment (title, tags, source tables)
    tvl.sql
    hgram_supply.sql
    exchange_rate.sql
    apy.sql
    deposit_volume.sql
    unstake_volume.sql
    net_flow.sql
    stakers.sql
    holders.sql
    holder_distribution.sql
    round_activity.sql
  dashboard.md         # panel-by-panel layout: which query, chart type, axis, section order
  exporter/            # the rate/APY/TVL snapshot job
    export-rates.mjs   # reads treasury getters, upserts CSV, uploads to Dune
    package.json
    README.md
  data/
    treasury_rate.csv  # versioned source of truth for the rate dataset
  .github/workflows/
    update-rates.yml   # daily cron: run exporter, commit CSV
```

Each `.sql` starts with a comment block: human title (`Hipo — <metric>`), the tags, the
anchor addresses it uses, and a one-line note on exact-vs-approx. Addresses live in the SQL
directly (Dune has no repo-level variables); a comment flags them as the single place to edit
on a parent upgrade.

## Invariants (analytical correctness — what must stay true)

This has no protocol invariants (no on-chain effect). The analytical invariants the queries
must preserve:

- **A staker is counted once**, at its first-ever deposit (matches `analyzeJoiners.ts`);
  cumulative-staker and new-staker series are internally consistent.
- **Supply is exact**: cumulative mints − burns from decoded jetton events must reconcile with
  `ton.jetton_metadata`/latest supply for hGRAM at "now".
- **Flows reconcile**: net cumulative flow and supply×rate move together (sanity, not identity —
  rewards accrue into rate, not into deposit flow).
- **Every approximate panel states its method and known bias** (esp. TVL lower-bound during
  rounds, rate excluding fees). No panel presents an estimate as exact.
- **`block_date` filter present in every query** (correctness + cost).

## Compatibility

- **Contract repo**: untouched. No contract, wrapper, test, schema, `Integration.md`, or
  `docs/architecture.md` change. No gas impact (`MaxGas`/`MinGas` unaffected).
- **On-chain constants the queries embed**: treasury and hGRAM-master addresses, and the
  op-codes above. If governance upgrades the **parent** (new hGRAM master), supply/holder
  queries must add the new master (union old + new). This is the one maintenance coupling;
  `dashboard.md` and each query header must call it out. Treasury address is stable across
  code upgrades (upgrades replace code, not address).
- **Dune schema drift**: column names are confirmed at generation time, not frozen here; if
  TON tables change, queries — not this spec — are updated.
- **External dependencies**: a Dune account with permission to create a team; that's all. No
  API key, no npm/Go deps, no secrets in the repo.

## Test plan (validation — no automated suite)

Analytics repo, validated by cross-checking against known-good sources:

1. **Supply/holders vs. explorer** — hGRAM supply and holder count at "now" match
   tonviewer/tonscan for the parent jetton and `showJettonData.ts` output.
2. **TVL vs. getters & DefiLlama** — supply×rate TVL is within a plausible band of
   `showState.ts` `total_coins` and the DefiLlama figure; the treasury-balance cross-check
   line sits at/below it and the gap grows during active rounds (validates the lower-bound
   explanation). Reconcile any large discrepancy before publishing.
3. **Rate/APY vs. `showState.ts`** — implied rate and APY track the contract getter's
   `current_rate`/`previous_rate`-derived APY over the same window (trend and rough level).
4. **Stakers vs. `analyzeJoiners`** — cumulative unique stakers and new-staker buckets match
   (or closely track) the `analyzeJoiners.ts` output over a shared window and `--since`.
5. **Idempotency/partitioning** — every query filters `block_date`; re-running yields stable
   historical buckets; spot-check a handful of deposits/mints against the explorer.
6. **Discoverability** — after publishing, searching "Hipo" on dune.com finds the dashboard;
   titles/tags are correct; all panels render for a logged-out viewer.

## Out of scope (v1)

- Dune API sync automation / dashboard-as-code (manual publish guide only; leave room to add).
- Dune Spellbook `hipo_*` decoded-table contribution (heavier upstream process).
- Any dependency on Hipo's off-chain `api` service or uploaded off-chain snapshots (including
  the exact `total_coins` snapshot table that would make TVL exact).
- Full pre-current-parent history for supply/holders (documented limitation; union later).
- Referrer/ad attribution, churn/retention, per-borrower validator performance deep-dives.
- USD-denominated everything (a single optional overlay only), DEX/secondary-market hGRAM
  price analysis.
- Any contract, wrapper, schema, or on-chain change.

## Rollout

1. Approve this spec. 2. Generate the repo files (`queries/`, `PUBLISH.md`, `dashboard.md`,
`README.md`, `LICENSE`) per the manifest. 3. Create the Hipo Dune team; create each query and
the dashboard per `PUBLISH.md`; validate per the test plan. 4. `git init`, commit, and push to
a new public **`HipoFinance/dune`** GitHub repo; link the live dashboard from `README.md`.
