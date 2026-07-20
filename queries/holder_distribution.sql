-- Hipo — hGRAM holder distribution (current)
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT, state-derived. Current hGRAM balance per holder from ton.latest_balances
--   (NOT from jetton events — Hipo's custom mints are not fully captured as mint events; see
--   hgram_supply.sql). Bucketed to show concentration.
-- Columns: `asset` = jetton master (hGRAM); `address` = holder; `amount` = balance.
--   Total holders should be ~23k and total ~1,825,060 hGRAM.
-- >>> Update the asset (master) address on a parent upgrade. <<<

WITH balances AS (
    SELECT address, CAST(amount AS double) / 1e9 AS balance
    FROM ton.latest_balances
    WHERE asset = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
      AND CAST(amount AS double) > 0
)
SELECT
    CASE
        WHEN balance >= 1000000 THEN '1. 1M+'
        WHEN balance >=  100000 THEN '2. 100k–1M'
        WHEN balance >=   10000 THEN '3. 10k–100k'
        WHEN balance >=    1000 THEN '4. 1k–10k'
        WHEN balance >=     100 THEN '5. 100–1k'
        WHEN balance >=      10 THEN '6. 10–100'
        ELSE                         '7. <10'
    END AS balance_bucket,
    COUNT(*) AS holders,
    SUM(balance) AS total_hgram,
    SUM(balance) / (SELECT SUM(balance) FROM balances) AS share_of_supply
FROM balances
GROUP BY 1
ORDER BY 1
