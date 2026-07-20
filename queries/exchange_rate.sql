-- Hipo — GRAM/hGRAM exchange rate
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT. Reads the treasury getter value (total_coins/total_tokens) snapshotted daily
--   into a Dune dataset by exporter/export-rates.mjs. NOT reconstructed from events (mints
--   undercount in jetton_events, so the old "GRAM deposited / hGRAM minted" estimate was wrong).
-- Source: dune.hipofinance.dataset_treasury_rate

SELECT
    ts AS day,
    rate,           -- = total_coins / total_tokens (matches the Hipo app)
    current_rate,
    previous_rate
FROM dune.hipofinance.dataset_treasury_rate
ORDER BY ts
