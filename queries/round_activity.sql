-- Hipo — validation-round / borrower activity
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: BEST-EFFORT. Message counts and distinct-borrower counts are exact; GRAM amounts
--   are NOT reported here because the staked amount lives in the message body, not `value`
--   (decoding it is out of scope for v1).
-- Flow: treasury --proxy_new_stake--> per-borrower loan contract --new_stake--> elector.
--   Distinct proxy_new_stake destinations per day ~= active borrowers.
-- Source: ton.messages out of the treasury.
--   op::proxy_new_stake     = 0x089cd4d0 = 144495824
--   op::proxy_recover_stake = 0x407cb243 = 1081913923
-- Verify at publish: opcode column type/format (int vs 0x-hex vs text) and the out-leg
--   `direction` semantics; if opcode is hex/text, use 0x089cd4d0 / 0x407cb243 directly.

SELECT
    CAST(date_trunc('day', block_time) AS date) AS day,
    COUNT_IF(opcode = 144495824)  AS stakes_sent,     -- 0x089cd4d0 proxy_new_stake
    COUNT(DISTINCT CASE WHEN opcode = 144495824 THEN destination END) AS active_borrowers,
    COUNT_IF(opcode = 1081913923) AS recoveries       -- 0x407cb243 proxy_recover_stake
FROM ton.messages
WHERE source = '0:8BC991CFE177BC7E9721433EFA3BEFD199485A55CFFD040A06C89AF026B71BCF'
  AND direction = 'out'
  AND opcode IN (144495824, 1081913923)
  AND bounced = false
GROUP BY 1
ORDER BY 1
