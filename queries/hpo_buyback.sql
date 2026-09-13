-- Hipo — GRAM spent buying back HPO
-- Tags: hipo, liquid-staking, ton, hgram, hpo
-- Metric: EXACT. GRAM that reached the burn contracts, from their own income counter,
--   snapshotted daily by exporter/export-burn.mjs and differenced here.
-- Two things pay it: the treasury forwards the borrower fee, charged on top of what the pool
--   receives and out of the borrower's own funds, so it never reduces the staker reward or moves
--   the exchange rate; and Hipo's HPO trading bot sweeps its realized profit to the same
--   contract. The counter does not distinguish them -- see the DefiLlama fees adapter, which
--   splits by payer -- so this is the combined figure.
-- The GRAM does not leave the protocol: the burner stakes it into Hipo, and the resulting hGRAM
--   is what buys HPO on DeDust. It is therefore also permanent Hipo TVL, already inside
--   total_coins and so already counted by tvl.sql. Do not add the two together.
-- Source: dune.hipofinance.dataset_hpo_burn

WITH per_burner_day AS (
    SELECT
        CAST(date_trunc('day', from_iso8601_timestamp(ts)) AS date) AS day,
        burner,
        MAX(total_received) AS total_received
    FROM dune.hipofinance.dataset_hpo_burn
    GROUP BY 1, 2
),
pooled AS (
    SELECT day, SUM(total_received) AS total_received
    FROM per_burner_day
    GROUP BY 1
)
SELECT
    day,
    -- NULL on the first day, as in hpo_burned.sql: the opening snapshot is a running total, not
    -- one day's inflow.
    total_received - LAG(total_received) OVER (ORDER BY day) AS gram_to_burner,
    total_received AS cumulative_gram_to_burner
FROM pooled
ORDER BY day
