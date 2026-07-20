# Hipo — Dune Analytics

Source of truth for the [Hipo](https://hipo.finance) protocol dashboard on
[Dune](https://dune.com). Hipo is a decentralized liquid-staking protocol on the TON
blockchain: users deposit **GRAM** into the treasury and receive **hGRAM** jettons, and the
hGRAM→GRAM exchange rate accrues staking rewards each validation round.

TON is a native chain on Dune, so every metric here is derived purely from on-chain data —
no off-chain API, no secrets. This repo holds the versioned SQL; the live dashboard is
published on Dune under the Hipo team.

- **Live dashboard:** _(add the dune.com link after publishing — see [PUBLISH.md](PUBLISH.md))_
- **Spec / design rationale:** [SPEC.md](SPEC.md)
- **Panel layout:** [dashboard.md](dashboard.md)
- **How to publish / update:** [PUBLISH.md](PUBLISH.md)

## What it shows

| Section | Panels |
|---|---|
| Headline | TVL, APY, hGRAM supply, holder count (stat tiles) |
| Size & rate | TVL over time · hGRAM supply · implied exchange rate · APY |
| Flows | Deposit volume · unstake volume · net flow |
| Users | New stakers · cumulative stakers · holders over time · holder distribution |
| Operations | Validation-round / borrower activity |

## Anchor addresses

Dune stores TON addresses in **raw form with uppercase hex** (`0:HEX…`); lowercase hex
returns no rows. The queries hard-code:

| Entity | Friendly (mainnet) | Raw (in SQL) |
|---|---|---|
| Treasury (holds all GRAM) | `EQCLyZHP4Xe8fpchQz76O-_RmUhaVc_9BAoGyJrwJrcbz2eZ` | `0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF` |
| Parent = hGRAM jetton master | `EQDPdq8xjAhytYqfGSX8KcFWIReCufsB9Wdg0pLlYSO_h76w` | `0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87` |

If governance ever upgrades the **parent** (new hGRAM master), the supply/holder/rate queries
must add the new master address. Each affected `.sql` flags the exact line to edit.

## Accuracy notes

Some metrics are **exact** and some are **approximate** (a documented estimate). Every
approximate panel states its method and known bias:

- **Exact — from on-chain state:** hGRAM supply, holders, holder distribution (from
  `ton.balances_history`); deposit count, new/cumulative stakers (from `ton.messages`).
- **Exact — from the rate dataset:** TVL (`total_coins`), exchange rate
  (`total_coins/total_tokens`), APY. These are stored treasury-getter values that can't be
  reconstructed from Dune's raw tables, so a small [`exporter/`](exporter/) job snapshots them
  daily into `dune.hipofinance.dataset_treasury_rate`.
- **Approximate:** unstake volume and the withdrawal leg of net flow (hGRAM burns from
  `ton.jetton_events` may under-capture Hipo's custom burns → lower bound), and round/borrower
  GRAM amounts (message counts exact; amounts need body decoding — best-effort).

Two things Dune's raw tables **cannot** produce, and how this repo handles them: (1) hGRAM
supply/balances — Hipo's custom mints aren't TEP-74, so `jetton_events` undercount; we use
`balances_history` instead. (2) exchange rate/APY — stored getter values; we snapshot them via
the exporter. See [SPEC.md](SPEC.md). The contract repo's `scripts/showState.ts` prints the
getters and is the cross-check reference.

## Layout

```
queries/                  one .sql per metric (each is a standalone Dune query)
dashboard.md              panel-by-panel layout and chart types
PUBLISH.md                steps to create the Hipo team, the queries, and the dashboard
SPEC.md                   design decisions and validation plan
exporter/                 daily job: snapshot treasury rate/APY/TVL → Dune dataset
data/treasury_rate.csv    versioned source of truth for that dataset
.github/workflows/        cron that runs the exporter
```

## License

[MIT](LICENSE) — © Hipo Finance.
