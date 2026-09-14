// Hipo — one-off seed for data/hpo_burn.csv.
//
// export-burn.mjs snapshots the burn contracts' counters going forward, which leaves the panels
// starting from the day it was first run rather than from the day the burn started. This
// reconstructs the missing history from the contracts' own logs and writes one end-of-day row per
// burner per day, so the dashboard has the whole story from 2026-09-05.
//
// Re-runnable: it only fills days the CSV does not already have, so the live snapshots stay
// authoritative for the days they cover.
//
// It verifies itself. Every counter is rebuilt by replaying the logs, and the rebuilt totals are
// compared against get_burner_data before anything is written. If a chain does not land exactly
// on what the contract reports, the script throws rather than seeding numbers nobody checked.
//
//   node backfill-burn.mjs

import { TonClient } from '@ton/ton'
import { Address } from '@ton/core'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BURNERS = (process.env.BURNER_ADDRESSES ||
    'EQAGPJMxJ73OLpHUgQhI5YeQe2ZuAuUQ-4f_zfN4rV2Fl6Jp,EQDcjZDWvotoVE0X4HSdt2pR3b2sBZ4XikzSVSdPiqdQMLRK'
).split(',').map((a) => a.trim()).filter(Boolean)
const ENDPOINT = process.env.TON_ENDPOINT || 'https://toncenter.com/api/v2/jsonRPC'
const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY || undefined
const CSV_PATH = process.env.BURN_CSV_PATH || fileURLToPath(new URL('../data/hpo_burn.csv', import.meta.url))
const HEADER = 'ts,burner,total_received,total_deposited,total_swapped,total_burned'
const PAGE = 256
const UNIT = 1e9

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pace = () => (TONCENTER_API_KEY ? Promise.resolve() : sleep(1100))

// Minimal single-cell BOC reader. The log bodies are one cell with no refs.
function parseBoc(b64) {
    const raw = Buffer.from(b64, 'base64')
    if (raw.length < 6 || raw.readUInt32BE(0) !== 0xb5ee9c72) return null
    const flags = raw[4], refSize = flags & 7, offSize = raw[5]
    let p = 6
    const readN = (n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + raw[p++]; return v }
    const cellCount = readN(refSize), rootCount = readN(refSize)
    readN(refSize); readN(offSize)
    if (rootCount !== 1) return null
    if (readN(refSize) !== 0) return null
    if (flags & 0x80) p += cellCount * offSize
    const d1 = raw[p++], d2 = raw[p++]
    if (d1 & 8 || (d1 & 7) !== 0) return null
    const len = (d2 >> 1) + (d2 & 1)
    const data = raw.subarray(p, p + len)
    if (data.length !== len) return null
    let bits = len * 8
    if (d2 & 1) {
        const last = data[len - 1]
        let z = 0
        while (z < 8 && ((last >> z) & 1) === 0) z++
        bits = len * 8 - 1 - z
    }
    return { data, bits }
}

class Reader {
    constructor(data, bits) { this.data = data; this.bits = bits; this.pos = 0 }
    left() { return this.bits - this.pos }
    uint(n) {
        if (this.pos + n > this.bits) throw new Error('short')
        let v = 0n
        for (let i = 0; i < n; i++) { const b = this.pos + i; v = (v << 1n) | BigInt((this.data[b >> 3] >> (7 - (b & 7))) & 1) }
        this.pos += n
        return v
    }
    coins() { const n = Number(this.uint(4)); return n === 0 ? 0n : this.uint(n * 8) }
}

// The burner's logs, by shape. received ends on an address; deposit carries one Coins; swap and
// burn are byte-identical to each other (query_id + amount + running total) and are told apart
// below by which running total each one continues.
function classify(b64) {
    const cell = parseBoc(b64)
    if (!cell) return null
    try {
        const r = new Reader(cell.data, cell.bits)
        r.uint(32)
        const v = r.coins(), t = r.coins()
        if (r.left() === 267 && r.uint(2) === 2n && r.uint(1) === 0n) {
            r.uint(8); r.uint(256)
            if (r.left() === 0 && v > 0n && v <= t) return { kind: 'received', amount: v, total: t }
        }
    } catch { /* not a receipt */ }
    try {
        const r = new Reader(cell.data, cell.bits)
        r.uint(64)
        const a = r.coins()
        if (r.left() === 0 && a > 0n) return { kind: 'deposit', amount: a }
        const t = r.coins()
        if (r.left() === 0 && a > 0n && t >= a) return { kind: 'pair', amount: a, total: t }
    } catch { /* not one of ours */ }
    return null
}

async function fetchLogs(burner) {
    const out = []
    for (let offset = 0; ; offset += PAGE) {
        await pace()
        const url = `https://toncenter.com/api/v3/messages?source=${burner}&direction=out` +
            `&limit=${PAGE}&offset=${offset}&sort=desc` + (TONCENTER_API_KEY ? `&api_key=${TONCENTER_API_KEY}` : '')
        const res = await fetch(url)
        if (!res.ok) throw new Error(`toncenter ${res.status} for ${burner}`)
        const data = await res.json()
        if (!Array.isArray(data?.messages)) throw new Error(`no messages array for ${burner}`)
        for (const m of data.messages) {
            if (m.destination !== null && m.destination !== undefined) continue
            const body = m.message_content?.body
            if (!body) continue
            const c = classify(body)
            if (c) out.push({ at: Number(m.created_at), lt: BigInt(m.created_lt), ...c })
        }
        if (data.messages.length < PAGE) break
    }
    out.sort((x, y) => (x.at - y.at) || (x.lt < y.lt ? -1 : x.lt > y.lt ? 1 : 0))
    return out
}

async function main() {
    const client = new TonClient({ endpoint: ENDPOINT, apiKey: TONCENTER_API_KEY })
    const today = new Date().toISOString().slice(0, 10)
    const rows = []

    for (const burner of BURNERS) {
        const events = await fetchLogs(burner)
        if (events.length === 0) { console.info(`${burner}: no logs`); continue }

        // Replay. The two pair chains are separated by which running total each event continues;
        // an event that continues neither is a parse that should not have been accepted.
        let received = 0n, deposited = 0n, chainA = 0n, chainB = 0n
        const byDay = new Map()
        for (const e of events) {
            if (e.kind === 'received') received = e.total
            else if (e.kind === 'deposit') deposited += e.amount
            else if (chainA + e.amount === e.total) chainA = e.total
            else if (chainB + e.amount === e.total) chainB = e.total
            else throw new Error(`${burner}: log at ${e.at} continues neither running total`)
            const day = new Date(e.at * 1000).toISOString().slice(0, 10)
            byDay.set(day, { received, deposited, chainA, chainB })
        }

        // Ground truth. Which chain is the swap and which is the burn is decided by the contract,
        // not by guessing from magnitudes.
        await pace()
        const { stack } = await client.runMethod(Address.parse(burner), 'get_burner_data')
        stack.skip(2)
        const live = {
            received: stack.readBigNumber(),
            deposited: stack.readBigNumber(),
            swapped: stack.readBigNumber(),
            burned: stack.readBigNumber(),
        }
        const swapIsA = chainA === live.swapped && chainB === live.burned
        const swapIsB = chainB === live.swapped && chainA === live.burned
        if (!swapIsA && !swapIsB) {
            throw new Error(
                `${burner}: replay does not match the contract.\n` +
                `  replayed chains: ${chainA} / ${chainB}\n` +
                `  contract says:   swapped=${live.swapped} burned=${live.burned}`
            )
        }
        if (received !== live.received) {
            throw new Error(`${burner}: replayed received ${received} != contract ${live.received}`)
        }
        if (deposited !== live.deposited) {
            throw new Error(`${burner}: replayed deposited ${deposited} != contract ${live.deposited}`)
        }
        console.info(`${burner}: ${events.length} logs replayed, all four counters match the contract`)

        // One end-of-day row per day from the first event onwards, carrying the last known values
        // through quiet days so a daily delta of zero reads as zero rather than as a gap.
        const days = [...byDay.keys()].sort()
        let cur = byDay.get(days[0])
        for (let d = new Date(days[0] + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
            const day = d.toISOString().slice(0, 10)
            if (byDay.has(day)) cur = byDay.get(day)
            rows.push({
                day,
                line: [
                    `${day}T23:59:59.000Z`,
                    burner,
                    (Number(cur.received) / UNIT).toString(),
                    (Number(cur.deposited) / UNIT).toString(),
                    (Number(swapIsA ? cur.chainA : cur.chainB) / UNIT).toString(),
                    (Number(swapIsA ? cur.chainB : cur.chainA) / UNIT).toString(),
                ].join(','),
                burner,
            })
        }
    }

    // Merge: existing rows win, so live snapshots are never overwritten by a reconstruction.
    let lines = []
    if (existsSync(CSV_PATH)) lines = readFileSync(CSV_PATH, 'utf8').split('\n').filter((l) => l.trim() !== '')
    const body = lines.filter((l) => l !== HEADER)
    const have = new Set(body.map((l) => { const c = l.split(','); return `${c[0].slice(0, 10)},${c[1]}` }))
    let added = 0
    for (const r of rows) {
        if (have.has(`${r.day},${r.burner}`)) continue
        body.push(r.line)
        added++
    }
    body.sort()
    writeFileSync(CSV_PATH, [HEADER, ...body].join('\n') + '\n')
    console.info(`Added ${added} reconstructed rows; ${body.length} total in ${CSV_PATH}`)
    console.info('Now run export-burn.mjs (with DUNE_API_KEY) to upload the seeded CSV.')
}

main().catch((e) => { console.error(e); process.exit(1) })
