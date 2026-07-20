-- Hipo — hGRAM holders over time
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT at each sampled date, state-derived. Counts holders whose hGRAM balance > 0,
--   sampled weekly (as-of the sample date), from ton.balances_history — NOT from jetton events
--   (Hipo's custom mints aren't fully captured as mint events; see hgram_supply.sql).
--   For the exact current count, cross-check ton.latest_balances (~23k).
-- Columns: `asset` = jetton master (hGRAM); `address` = holder; `amount` = absolute balance.
-- Perf: weekly spine keeps the as-of join bounded; widen the interval if it gets slow.
-- >>> Set the spine start near first hGRAM activity; update the asset address on a parent upgrade. <<<

WITH bh AS (
    SELECT address, block_date, lt, CAST(amount AS double) AS bal
    FROM ton.balances_history
    WHERE asset = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
),
spine AS (
    SELECT CAST(t AS date) AS d
    FROM UNNEST(sequence(DATE '2024-01-01', current_date, INTERVAL '7' DAY)) AS s(t)
),
as_of AS (
    -- each holder's most recent known balance on or before each sample day
    SELECT
        s.d AS sample_day,
        b.address,
        b.bal,
        ROW_NUMBER() OVER (PARTITION BY s.d, b.address ORDER BY b.block_date DESC, b.lt DESC) AS rn
    FROM spine s
    JOIN bh b ON b.block_date <= s.d
)
SELECT
    sample_day,
    COUNT_IF(bal > 0) AS holders
FROM as_of
WHERE rn = 1
GROUP BY sample_day
ORDER BY sample_day
