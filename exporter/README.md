# Exporters

Snapshots the Hipo treasury's **exact** exchange rate, APY and TVL and publishes them to a
Dune dataset, so the `exchange_rate` / `apy` / `tvl` panels are correct.

## Why this exists

The exchange rate is `total_coins / total_tokens` — a stored field in the treasury getter. It
is **not** reconstructable from Dune's raw TON tables: Hipo mints with a custom, non-TEP-74
mechanism that `ton.jetton_events` under-tags, and there is no on-chain "rate published"
message. So we read the getter (exactly like the contract repo's `scripts/showState.ts`) and
push the numbers to Dune.

## What it does

1. Calls `get_treasury_state` and `get_times` on the treasury (toncenter v2).
2. Computes `rate = total_coins/total_tokens`, and `apy` via the SDK's `computeApy`, which
   annualises over `window_duration` — the interval the rate pair actually grew over, about two
   settlement releases. Not a round length: those two agreed once and no longer do, and
   dividing by a round length would roughly square the figure.
3. Upserts **one row per round** (keyed by `round_since`) into
   [`../data/treasury_rate.csv`](../data/treasury_rate.csv) (the versioned source of truth).
4. Uploads the **full** CSV to Dune via `POST /api/v1/uploads/csv` (a full-replace endpoint;
   public upload, no Enterprise plan needed). It becomes `dune.hipofinance.dataset_treasury_rate`.

`total_coins` is the authoritative TVL; `rate`/`apy` match the Hipo app to the decimal.

## Run

```bash
cd exporter
npm install
DUNE_API_KEY=xxxx node export-rates.mjs      # updates CSV + uploads to Dune
node export-rates.mjs                         # no key: updates the local CSV only (dry run)
```

### Env

| Var | Default | Notes |
|---|---|---|
| `DUNE_API_KEY` | — | Required to upload. Without it the script only writes the CSV. |
| `DUNE_TABLE_NAME` | `treasury_rate` | Dataset name → `dune.hipofinance.dataset_treasury_rate`. |
| `TREASURY_ADDRESS` | mainnet treasury | — |
| `TON_ENDPOINT` | `https://toncenter.com/api/v2/jsonRPC` | Any toncenter v2 endpoint. |
| `TONCENTER_API_KEY` | — | Optional; raises toncenter rate limits. |
| `CSV_PATH` | `../data/treasury_rate.csv` | — |

## HPO buy-and-burn exporter

`export-burn.mjs` does the same job for the buy-and-burn, reading `get_burner_data` from **every**
burn contract Hipo has run — the 2026-09-05 one, now retired and frozen, and the upgradable
2026-09-09 replacement — and upserting one row per burner per **day** into
[`../data/hpo_burn.csv`](../data/hpo_burn.csv), uploaded as `dune.hipofinance.dataset_hpo_burn`.
Daily figures are the differences between those cumulative counters, taken in SQL
(`queries/hpo_burned.sql`, `queries/hpo_buyback.sql`).

Why a snapshot rather than raw tables, again: the contract takes GRAM from anyone and hands its
own change back — discovery replies, unspent swap forwards, DeDust refunds — and counts only the
difference as income, behind a route guard that lives in the contract. Summing inbound message
values in SQL would book that change as revenue. The contract has already done the arithmetic.

Both burners are read every run. The retired one's counters no longer move, but they are part of
the protocol's cumulative total, and dropping it would make total HPO burned fall off a cliff.

Extra env: `BURNER_ADDRESSES` (comma-separated, defaults to both mainnet contracts),
`DUNE_BURN_TABLE_NAME` (default `hpo_burn`), `BURN_CSV_PATH`.

## Automation

[`.github/workflows/update-rates.yml`](../.github/workflows/update-rates.yml) runs both of these **every
6 hours** and commits the updated CSVs. Set repo secrets `DUNE_API_KEY` (and optionally
`TONCENTER_API_KEY`, `TON_ENDPOINT`). Why 6h: rounds are ~18h, so every round is sampled ~3×
and never skipped; because rows are keyed by `round_since`, the extra runs just refresh the
current round's row (and keep `total_coins`/TVL fresh). On a public repo GitHub Actions is free,
and the Dune CSV upload is a data upload — not a billed query — so the frequency costs nothing.

## History / backfill

The CSV builds forward from the first run. Each row already carries `current_rate` and
`previous_rate`, so APY is meaningful from day one. To backfill older points, prepend rows
sourced from the `api` service's per-round reward logs (`HtonRewardLog` holds `TotalCoins` /
`TotalTokens` / `Time` per round), then re-run to re-upload.
