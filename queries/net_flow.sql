-- Hipo — net flow (GRAM in vs GRAM out)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: deposits are near-exact (message value); withdrawals are hGRAM burned valued at the
--   EXACT daily rate (treasury-rate dataset). Net flow reflects principal in/out; it excludes
--   reward accrual (which lifts total_coins/rate — see tvl.sql).
-- Caveat: the withdrawal leg uses jetton_events burns, which may under-capture Hipo's custom
--   burns (see unstake_volume.sql), so net flow is an upper bound (withdrawals understated).
-- Sources: ton.messages (deposits) + ton.jetton_events (burns) + dune.hipofinance.dataset_treasury_rate.
-- >>> Update addresses on a parent upgrade. <<<

WITH deposits AS (
    SELECT
        CAST(date_trunc('day', block_time) AS date) AS d,
        SUM(CAST(value AS double)) / 1e9 AS gram_in
    FROM ton.messages
    WHERE destination = '0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF'
      AND direction = 'in'
      AND opcode = 1027039654  -- deposit_coins
    GROUP BY 1
),
burns AS (
    SELECT block_date AS d, SUM(CAST(amount AS double)) / 1e9 AS hgram_burned
    FROM ton.jetton_events
    WHERE jetton_master = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
      AND type = 'burn'
      AND NOT tx_aborted
    GROUP BY 1
),
rate AS (
    SELECT CAST(ts AS date) AS d, rate FROM dune.hipofinance.dataset_treasury_rate
),
days AS (
    SELECT d FROM deposits
    UNION SELECT d FROM burns
),
joined AS (
    SELECT
        x.d,
        COALESCE(dep.gram_in, 0) AS gram_in,
        COALESCE(bn.hgram_burned, 0) AS hgram_burned,
        LAST_VALUE(rt.rate) IGNORE NULLS OVER (ORDER BY x.d ROWS UNBOUNDED PRECEDING) AS rate
    FROM days x
    LEFT JOIN deposits dep ON x.d = dep.d
    LEFT JOIN burns    bn  ON x.d = bn.d
    LEFT JOIN rate     rt  ON x.d = rt.d
)
SELECT
    d AS day,
    gram_in,
    hgram_burned * rate AS gram_out_est,
    gram_in - hgram_burned * rate AS net_flow,
    SUM(gram_in - hgram_burned * rate) OVER (ORDER BY d ROWS UNBOUNDED PRECEDING) AS cumulative_net_flow
FROM joined
ORDER BY d
