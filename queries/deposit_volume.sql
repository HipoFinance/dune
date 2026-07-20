-- Hipo — deposit volume (GRAM in)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: near-exact (message value includes network/deposit fee; ~exact for trend/volume)
-- Source: ton.messages, op deposit_coins = 0x3d3761a6
-- Treasury: EQCLyZHP4Xe8fpchQz76O-_RmUhaVc_9BAoGyJrwJrcbz2eZ
-- Verify at publish: timestamp column (block_time vs created_at), `opcode` type
--   (integer vs 0x-hex string vs varbinary), `value` (nanoton) and `direction` columns.

SELECT
    CAST(date_trunc('day', block_time) AS date) AS day,   -- if no block_time, use created_at
    COUNT(*) AS deposits,
    SUM(CAST(value AS double)) / 1e9 AS gram_in
FROM ton.messages
WHERE destination = '0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF'
  AND direction = 'in'
  AND opcode = 1027039654   -- 0x3d3761a6 deposit_coins (opcode is int; 0x3d3761a6 also works)
  AND bounced = false
GROUP BY 1
ORDER BY 1
