-- Hipo — APY
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT. APY is precomputed by exporter/export-rates.mjs with the same formula as the
--   contract repo's scripts/showState.ts — (current_rate/previous_rate) ^ (year/round_len) − 1 —
--   and snapshotted daily into the Dune dataset. Matches the Hipo app.
-- Source: dune.hipofinance.dataset_treasury_rate

SELECT
    ts AS day,
    apy             -- fraction; format as a percentage in the visualization
FROM dune.hipofinance.dataset_treasury_rate
WHERE apy IS NOT NULL
ORDER BY ts
