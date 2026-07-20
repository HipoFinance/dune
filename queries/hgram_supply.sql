-- Hipo — hGRAM circulating supply
-- Tags: hipo, liquid-staking, ton, hgram
-- Metric: EXACT, state-derived. Supply is reconstructed from jetton-wallet BALANCES, NOT from
--   mint/burn events. Hipo mints via a custom, multi-phase (bill-based) mechanism that is not a
--   TEP-74 internal_transfer, so ton.jetton_events under-tags mints and SUM(mint) - SUM(burn)
--   undercounts badly (~904k vs the true ~1,825,060). The TON data lake documents exactly this:
--   "mints are not covered by TEP-74 ... use the balance history." So we sum wallet balances.
-- Source: ton.balances_history — state-recovered balances, one row per address per CHANGE.
--   Token is identified by the `asset` column (jetton master for jettons; 'TON' for the coin).
--   `amount` is the address's absolute balance at that change; `address` is the holder.
-- hGRAM jetton master (parent): EQDPdq8xjAhytYqfGSX8KcFWIReCufsB9Wdg0pLlYSO_h76w
--   >>> On a parent upgrade, switch/union the asset (master) address below. <<<
-- Cross-check the final value against the latest-balances helper:
--   SELECT SUM(CAST(amount AS double))/1e9 FROM ton.latest_balances
--   WHERE asset = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
--     AND CAST(amount AS double) > 0;   -- expect ~1,825,060
-- Note: assumes `amount` is the absolute balance (point-in-time). If it is instead a signed
--   delta, drop the LAG and sum `amount` directly.

WITH bh AS (
    SELECT
        address,
        block_date,
        lt,
        CAST(amount AS double) AS bal
    FROM ton.balances_history
    WHERE asset = '0:CF76AF318C0872B58A9F1925FC29C156211782B9FB01F56760D292E56123BF87'
),
delta AS (
    -- per-address change vs its previous known balance; telescopes to the final balance,
    -- so the cumulative line below equals total supply regardless of intra-day ordering
    SELECT
        block_date,
        bal - COALESCE(LAG(bal) OVER (PARTITION BY address ORDER BY block_date, lt), 0) AS d
    FROM bh
)
SELECT
    block_date,
    SUM(d) / 1e9 AS daily_net_hgram,
    SUM(SUM(d)) OVER (ORDER BY block_date ROWS UNBOUNDED PRECEDING) / 1e9 AS hgram_supply
FROM delta
GROUP BY block_date
ORDER BY block_date
