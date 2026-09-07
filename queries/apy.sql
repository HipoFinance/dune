-- Hipo — APY
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT. APY is precomputed by exporter/export-rates.mjs with the same formula as the
--   contract repo's scripts/showState.ts — (current_rate/previous_rate) ^ (year/window_duration) − 1
--   — and snapshotted daily into the Dune dataset. Matches the Hipo app. The basis is the
--   treasury's own window_duration, the interval that rate pair grew over, which spans two barrier
--   releases and so is NOT a round length.
-- Source: dune.hipofinance.dataset_treasury_rate

SELECT
    from_iso8601_timestamp(ts) AS day,  -- ts is an ISO-8601 varchar in the uploaded dataset
    apy             -- fraction; format as a percentage in the visualization
FROM dune.hipofinance.dataset_treasury_rate
WHERE apy IS NOT NULL
ORDER BY ts
