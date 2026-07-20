-- Hipo — stakers (new & cumulative)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT. A staker is counted once, at its first-ever deposit into the treasury
--   (matches the contract repo's scripts/analyzeJoiners.ts definition of a "joiner").
-- Source: ton.messages, op deposit_coins. `source` is the depositor's wallet.
-- Note: this counts the message sender. A deposit body can carry an `owner` that differs
--   from the sender (deposit-on-behalf); those are rare and out of scope for v1.

WITH first_deposit AS (
    SELECT
        source AS staker,
        MIN(block_time) AS first_time
    FROM ton.messages
    WHERE destination = '0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF'
      AND direction = 'in'
      AND opcode = 1027039654  -- 0x3d3761a6 deposit_coins
      AND bounced = false
    GROUP BY 1
),
by_day AS (
    SELECT CAST(date_trunc('day', first_time) AS date) AS day, COUNT(*) AS new_stakers
    FROM first_deposit
    GROUP BY 1
)
SELECT
    day,
    new_stakers,
    SUM(new_stakers) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) AS cumulative_stakers
FROM by_day
ORDER BY day
