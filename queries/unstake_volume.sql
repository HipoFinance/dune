-- Hipo — unstake volume (hGRAM burned)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: hGRAM burned per day (from jetton_events burns) valued in GRAM at the EXACT daily
--   rate (from the treasury-rate dataset). The GRAM column is a valuation of the burns.
-- Caveat: like mints, Hipo's burns are custom (non-TEP-74), so ton.jetton_events may
--   under-capture some burns — treat this as a lower bound on unstake volume. (A fully exact
--   unstake series would need decoding the treasury's withdrawal messages — future work.)
-- Sources: ton.jetton_events (burns) + dune.hipofinance.dataset_treasury_rate (rate).
-- >>> Update the master address on a parent upgrade. <<<

WITH burns AS (
    SELECT block_date, SUM(CAST(amount AS double)) / 1e9 AS hgram_burned
    FROM ton.jetton_events
    WHERE jetton_master = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
      AND type = 'burn'
      AND NOT tx_aborted
    GROUP BY 1
),
rate AS (
    -- ts is an ISO-8601 varchar in the uploaded dataset; parse before casting.
    -- One row per round (~18h), so pick the latest rate when two rounds share a date.
    SELECT
        CAST(from_iso8601_timestamp(ts) AS date) AS d,
        MAX_BY(rate, ts) AS rate
    FROM dune.hipofinance.dataset_treasury_rate
    GROUP BY 1
),
filled AS (
    SELECT
        b.block_date,
        b.hgram_burned,
        LAST_VALUE(r.rate) IGNORE NULLS OVER (ORDER BY b.block_date ROWS UNBOUNDED PRECEDING) AS rate
    FROM burns b
    LEFT JOIN rate r ON b.block_date = r.d
)
SELECT
    block_date,
    hgram_burned,
    hgram_burned * rate AS gram_out_est
FROM filled
ORDER BY block_date
