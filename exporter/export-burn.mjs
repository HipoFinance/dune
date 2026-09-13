// Hipo — HPO buy-and-burn exporter.
//
// Reads the cumulative counters from every burn contract Hipo has run and appends today's
// snapshot to data/hpo_burn.csv, then uploads the FULL CSV to a public Dune dataset. Daily
// figures come from differencing the counters in SQL; see queries/hpo_burned.sql.
//
// Why a snapshot pipeline, same as the rate exporter: what reaches the burn is not
// reconstructable from Dune's raw TON tables. The contract accepts GRAM from anyone and returns
// its own change -- discovery replies, unspent swap forwards, DeDust refunds -- and only counts
// the difference as income, behind a route guard that lives in the contract. Summing inbound
// message values in SQL would count that change as revenue. The contract has already done the
// arithmetic correctly, so read its answer rather than re-deriving a rule off chain.
//
// Env: as export-rates.mjs, plus DUNE_BURN_TABLE_NAME and BURN_CSV_PATH.

import { TonClient } from '@ton/ton'
import { Address } from '@ton/core'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Every burn contract, oldest first. The first served from 2026-09-05 until the second replaced
// it on 2026-09-09; it had no set_code, so a fix meant redeploying. Both are read every run
// rather than switching on a cutover date: the first one's counters are frozen but still part of
// the protocol's total, and dropping it would make cumulative HPO burned fall off a cliff.
const BURNERS = (process.env.BURNER_ADDRESSES ||
    'EQAGPJMxJ73OLpHUgQhI5YeQe2ZuAuUQ-4f_zfN4rV2Fl6Jp,EQDcjZDWvotoVE0X4HSdt2pR3b2sBZ4XikzSVSdPiqdQMLRK'
).split(',').map((a) => a.trim()).filter(Boolean)

const ENDPOINT = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC'
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || undefined
const DUNE_API_KEY = process.env.DUNE_API_KEY || undefined
const DUNE_TABLE_NAME = process.env.DUNE_BURN_TABLE_NAME || 'hpo_burn'
const CSV_PATH =
    process.env.BURN_CSV_PATH || fileURLToPath(new URL('../data/hpo_burn.csv', import.meta.url))

// GRAM and HPO are both 9 decimals; HPO is a Notcoin fork, so the burn genuinely lowers its
// total supply rather than parking tokens at an unspendable address.
const UNIT = 1e9

const HEADER = 'ts,burner,total_received,total_deposited,total_swapped,total_burned'

// Unauthenticated toncenter allows one request per second and answers anything faster with a
// 429. Pacing alone is not enough: this script runs straight after export-rates.mjs in the same
// workflow, so its FIRST read races that script's last call and there is no in-process state
// that knows about it. Hence a retry as well, which also covers the endpoint simply being busy.
const RETRIES = 4

async function readBurnerWithRetry(client, friendly) {
    let last
    for (let attempt = 0; attempt < RETRIES; attempt++) {
        if (!TONCENTER_API_KEY || attempt > 0) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 1100 : 2000 * attempt))
        }
        try {
            return await readBurner(client, friendly)
        } catch (e) {
            last = e
            console.warn(`  ${friendly}: attempt ${attempt + 1}/${RETRIES} failed (${e?.response?.status ?? e?.message ?? e})`)
        }
    }
    throw last
}

async function readBurner(client, friendly) {
    // get_burner_data returns (hgram_wallet, hpo_wallet, total_received, total_deposited,
    // total_swapped, total_burned). The two wallets are skipped rather than parsed: they are
    // addr_none until TEP-89 discovery answers, and reading them as addresses would throw on a
    // freshly deployed contract for values this dataset does not use.
    const { stack } = await client.runMethod(Address.parse(friendly), 'get_burner_data')
    stack.skip(2)
    return {
        totalReceived: stack.readBigNumber(),
        totalDeposited: stack.readBigNumber(),
        totalSwapped: stack.readBigNumber(),
        totalBurned: stack.readBigNumber(),
    }
}

async function main() {
    const client = new TonClient({ endpoint: ENDPOINT, apiKey: TONCENTER_API_KEY })
    const iso = new Date(Date.now()).toISOString()
    const day = iso.slice(0, 10)

    const rows = []
    for (const burner of BURNERS) {
        const d = await readBurnerWithRetry(client, burner)
        rows.push([
            iso,
            burner,
            (Number(d.totalReceived) / UNIT).toString(),
            (Number(d.totalDeposited) / UNIT).toString(),
            (Number(d.totalSwapped) / UNIT).toString(),
            (Number(d.totalBurned) / UNIT).toString(),
        ].join(','))
        console.info(
            `${burner}: received=${(Number(d.totalReceived) / UNIT).toFixed(6)} GRAM, ` +
            `burned=${(Number(d.totalBurned) / UNIT).toFixed(6)} HPO`
        )
    }

    // Upsert one row per DAY per burner, keyed by the date part of the timestamp and the address.
    // The counters are cumulative, so the last snapshot of a day is the one that matters and
    // intra-day re-runs simply refresh it. One row per burner per day is also what makes the
    // daily delta in SQL a plain LAG.
    let lines = []
    if (existsSync(CSV_PATH)) {
        lines = readFileSync(CSV_PATH, 'utf8').split('\n').filter((l) => l.trim() !== '')
    }
    if (lines.length === 0 || lines[0] !== HEADER) {
        lines = [HEADER, ...lines.filter((l) => l !== HEADER)]
    }
    const written = new Set(BURNERS.map((b) => `${day},${b}`))
    const body = lines.slice(1).filter((l) => {
        const [ts, burner] = l.split(',')
        return !written.has(`${ts.slice(0, 10)},${burner}`)
    })
    body.push(...rows)
    body.sort() // ISO timestamp then address; chronological
    const csv = [HEADER, ...body].join('\n') + '\n'

    mkdirSync(dirname(CSV_PATH), { recursive: true })
    writeFileSync(CSV_PATH, csv)
    console.info(`Wrote ${body.length} rows to ${CSV_PATH}`)

    if (!DUNE_API_KEY) {
        console.info('DUNE_API_KEY not set — skipped upload (local CSV updated only).')
        return
    }

    const res = await fetch('https://api.dune.com/api/v1/uploads/csv', {
        method: 'POST',
        headers: { 'X-Dune-Api-Key': DUNE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            table_name: DUNE_TABLE_NAME,
            data: csv,
            is_private: false,
            description:
                'Hipo HPO buy-and-burn: cumulative GRAM received, staked, swapped and HPO burned, per burn contract (from get_burner_data).',
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
