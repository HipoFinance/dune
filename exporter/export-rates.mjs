// Hipo — treasury rate/APY/TVL exporter.
//
// Reads the exact protocol figures from the treasury getters (the same values
// scripts/showState.ts prints in the contract repo), appends today's row to
// data/treasury_rate.csv, and uploads the FULL CSV to a public Dune dataset.
//
// Why a snapshot pipeline: the exchange rate is total_coins/total_tokens, a stored field in
// the treasury getter. It cannot be reconstructed from Dune's raw TON tables (mint events
// undercount Hipo's custom mint; there is no on-chain "rate published" message). So we sample
// it here and push it to Dune, where dataset table `dune.<team>.dataset_treasury_rate` backs
// the exact exchange_rate / apy / tvl panels.
//
// Env:
//   TREASURY_ADDRESS   default mainnet treasury
//   TON_ENDPOINT       toncenter v2 jsonRPC endpoint (default toncenter.com)
//   TONCENTER_API_KEY  optional, raises toncenter rate limits
//   DUNE_API_KEY       required to upload; if unset, the script only updates the local CSV
//   DUNE_TABLE_NAME    Dune dataset table name (default "treasury_rate")
//   CSV_PATH           override the CSV location

import { TonClient } from '@ton/ton'
import { Address } from '@ton/core'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TREASURY = process.env.TREASURY_ADDRESS || 'EQCLyZHP4Xe8fpchQz76O-_RmUhaVc_9BAoGyJrwJrcbz2eZ'
const ENDPOINT = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC'
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || undefined
const DUNE_API_KEY = process.env.DUNE_API_KEY || undefined
const DUNE_TABLE_NAME = process.env.DUNE_TABLE_NAME || 'treasury_rate'
const CSV_PATH =
    process.env.CSV_PATH || fileURLToPath(new URL('../data/treasury_rate.csv', import.meta.url))

const YEAR = 365 * 24 * 60 * 60
const HEADER = 'ts,round_since,total_coins,total_tokens,rate,current_rate,previous_rate,apy'

async function main() {
    const client = new TonClient({ endpoint: ENDPOINT, apiKey: TONCENTER_API_KEY })
    const addr = Address.parse(TREASURY)

    // get_treasury_state — read in the order defined by wrappers/Treasury.ts (indices 0..12)
    const ts = (await client.runMethod(addr, 'get_treasury_state')).stack
    const totalCoins = ts.readBigNumber() // 0
    const totalTokens = ts.readBigNumber() // 1
    ts.readBigNumber() // 2 total_staking
    ts.readBigNumber() // 3 total_unstaking
    ts.readBigNumber() // 4 total_borrowers_stake
    ts.readAddressOpt() // 5 parent
    ts.readCellOpt() // 6 participations
    ts.readBigNumber() // 7 rounds_imbalance
    ts.readBoolean() // 8 stopped
    ts.readBoolean() // 9 instant_mint
    ts.readCell() // 10 loan_codes
    const previousRate = ts.readBigNumber() // 11
    const currentRate = ts.readBigNumber() // 12

    // get_times — for the round length that sets the compounding frequency (indices 0 and 3)
    const tm = (await client.runMethod(addr, 'get_times')).stack
    const currentRoundSince = tm.readBigNumber() // 0
    tm.readBigNumber() // 1 participate_since
    tm.readBigNumber() // 2 participate_until
    const nextRoundSince = tm.readBigNumber() // 3

    // Rate and APY, computed exactly like scripts/showState.ts.
    const rate = Number(totalCoins) / Number(totalTokens)
    const duration = Number(nextRoundSince - currentRoundSince)
    const compoundingFrequency = duration > 0 ? YEAR / duration : 0
    const growth = Number(currentRate) / Number(previousRate)
    const apy = previousRate > 0n && duration > 0 ? Math.pow(growth, compoundingFrequency) - 1 : ''

    const iso = new Date(Date.now()).toISOString()
    const roundSinceStr = currentRoundSince.toString()

    const row = [
        iso,
        currentRoundSince.toString(),
        (Number(totalCoins) / 1e9).toString(),
        (Number(totalTokens) / 1e9).toString(),
        rate.toString(),
        (Number(currentRate) / 1e9).toString(),
        (Number(previousRate) / 1e9).toString(),
        apy === '' ? '' : apy.toString(),
    ].join(',')

    // Upsert one row per ROUND (keyed by round_since, column 1). Running more often than the
    // round length (see the workflow cron) then guarantees every round is captured exactly
    // once; re-runs within the same round just refresh that round's row (idempotent).
    let lines = []
    if (existsSync(CSV_PATH)) {
        lines = readFileSync(CSV_PATH, 'utf8').split('\n').filter((l) => l.trim() !== '')
    }
    if (lines.length === 0 || lines[0] !== HEADER) {
        lines = [HEADER, ...lines.filter((l) => l !== HEADER)]
    }
    const body = lines.slice(1).filter((l) => l.split(',')[1] !== roundSinceStr)
    body.push(row)
    body.sort() // ISO timestamps (column 0) sort chronologically
    const csv = [HEADER, ...body].join('\n') + '\n'

    mkdirSync(dirname(CSV_PATH), { recursive: true })
    writeFileSync(CSV_PATH, csv)
    console.info(`Wrote ${body.length} rows to ${CSV_PATH} (round ${roundSinceStr}: rate=${rate.toFixed(6)}, apy=${apy === '' ? 'n/a' : (apy * 100).toFixed(2) + '%'})`)

    if (!DUNE_API_KEY) {
        console.info('DUNE_API_KEY not set — skipped upload (local CSV updated only).')
        return
    }

    // Upload the full CSV to Dune. The /api/v1/uploads/csv endpoint REPLACES the table, so we
    // always send the complete history. (The old /v1/table/upload/csv endpoint was removed
    // 2026-03-01.) Public upload — no Enterprise plan needed.
    const res = await fetch('https://api.dune.com/api/v1/uploads/csv', {
        method: 'POST',
        headers: { 'X-Dune-Api-Key': DUNE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table_name: DUNE_TABLE_NAME,
            data: csv,
            is_private: false,
            description: 'Hipo treasury exchange rate / APY / TVL daily snapshots (from get_treasury_state).',
        }),
    })
    if (!res.ok) {
        throw new Error(`Dune upload failed: ${res.status} ${await res.text()}`)
    }
    console.info(`Uploaded to Dune dataset "${DUNE_TABLE_NAME}" → query as dune.<team>.dataset_${DUNE_TABLE_NAME}`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
