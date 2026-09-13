-- Hipo — HPO burned
-- Tags: hipo, liquid-staking, ton, hgram, hpo
-- Metric: EXACT. The burn contracts' own cumulative counter, snapshotted daily into a Dune
--   dataset by exporter/export-burn.mjs and differenced here. HPO is a Notcoin-fork jetton, so
--   these tokens leave total_supply rather than moving to an unspendable address.
-- Why not raw tables: the contract accepts GRAM from anyone and returns its own change --
--   discovery replies, unspent swap forwards, DeDust refunds -- and counts only the difference,
--   behind a route guard that lives in the contract. Summing messages in SQL would count that
--   change as income. The contract has already done the arithmetic; this reads its answer.
-- Source: dune.hipofinance.dataset_hpo_burn

WITH per_burner_day AS (
    -- The counters only ever grow, so the largest value seen on a day is that day's closing
    -- figure and intra-day re-runs of the exporter collapse to the same row.
    SELECT
        CAST(date_trunc('day', from_iso8601_timestamp(ts)) AS date) AS day,
        burner,
        MAX(total_burned) AS total_burned
    FROM dune.hipofinance.dataset_hpo_burn
    GROUP BY 1, 2
),
pooled AS (
    -- Across every burn contract Hipo has run. The retired one's counter is frozen but still
    -- part of the protocol's total, so it stays in the sum.
    SELECT day, SUM(total_burned) AS total_burned
    FROM per_burner_day
    GROUP BY 1
)
SELECT
    day,
    -- NULL on the first day on purpose: the first snapshot carries everything burned before the
    -- dataset existed, and charting that as one day's activity would invent a spike. The
    -- cumulative column below is correct from the first row either way.
    total_burned - LAG(total_burned) OVER (ORDER BY day) AS hpo_burned,
    total_burned AS cumulative_hpo_burned
FROM pooled
ORDER BY day
