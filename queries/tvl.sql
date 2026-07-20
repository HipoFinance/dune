-- Hipo — TVL (GRAM)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT. TVL = treasury total_coins, the authoritative protocol figure (includes GRAM
--   out on loan with the elector during rounds — which a raw treasury balance would miss).
--   Snapshotted daily into the Dune dataset by exporter/export-rates.mjs.
-- Source: dune.hipofinance.dataset_treasury_rate
-- For a USD line, multiply total_coins by the GRAM price from ton.prices_daily (optional).

SELECT
    ts AS day,
    total_coins  AS tvl_gram,      -- authoritative TVL
    total_tokens AS hgram_tokens,  -- protocol token total (≈ circulating supply)
    rate
FROM dune.hipofinance.dataset_treasury_rate
ORDER BY ts
