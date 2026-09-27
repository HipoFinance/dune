// Dune uploads, sent only when a dataset has something new.
//
// The upload endpoint replaces the whole table, and every call costs credits. The workflow runs
// every six hours, but the rate moves once a round (about 18 hours) and the burn table keeps one
// row per day, so uploading on every run sent the same data over and over -- eight uploads a day --
// and used up the billing cycle's credits limit on 2026-09-24. Each dataset now records the newest
// key it has uploaded (a round, or a day) in a file next to its CSV, and uploads only when the
// CSV's newest key is past it. A failed upload leaves that file alone, so the next run retries.
//
// There is no plan to buy credits, so an upload also has to fit the billing period's allowance.
// Before sending, the free usage endpoint says how many credits the period has used and includes,
// and an upload is sent only while that stays on an even pace through the period: nothing is lost
// by waiting, since the CSV in git keeps every row and the next upload replaces the whole table.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export async function uploadIfNew({ apiKey, table, csv, key, statePath, description }) {
    const last = existsSync(statePath) ? readFileSync(statePath, 'utf8').trim() : ''
    if (last === key && !process.env.FORCE_UPLOAD) {
        console.info(`Dune dataset "${table}" already holds ${key} — skipped the upload.`)
        return
    }
    if (!apiKey) {
        console.info('DUNE_API_KEY not set — skipped upload (local CSV updated only).')
        return
    }
    const usage = await creditUsage(apiKey)
    if (usage && !process.env.FORCE_UPLOAD) {
        const { used, included, start, end } = usage
        const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)))
        const pace = included * elapsed
        console.info(`Dune credits: ${used} of ${included} used, period ${new Date(start).toISOString().slice(0, 10)}` +
            ` to ${new Date(end).toISOString().slice(0, 10)}, ${pace.toFixed(1)} on an even pace`)
        if (used + 1 > pace) {
            console.info(`Dune dataset "${table}": holding ${key} until the credits pace allows an upload.`)
            return
        }
    }

    // /api/v1/uploads/csv REPLACES the table, so the complete history is always sent. (The old
    // /v1/table/upload/csv endpoint was removed 2026-03-01.) Public upload, no Enterprise plan.
    const res = await fetch('https://api.dune.com/api/v1/uploads/csv', {
        method: 'POST',
        headers: { 'X-Dune-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: table, data: csv, is_private: false, description }),
    })
    if (res.status === 402) {
        // Out of credits for the period. Not a fault to email anyone about: the row is in the CSV,
        // and the next upload after the period resets sends it.
        console.warn(`Dune dataset "${table}": out of credits (${await res.text()}); holding ${key}.`)
        return
    }
    if (!res.ok) {
        throw new Error(`Dune upload failed: ${res.status} ${await res.text()}`)
    }
    writeFileSync(statePath, key + '\n')
    console.info(`Uploaded ${key} to Dune dataset "${table}" → query as dune.<team>.dataset_${table}`)
}

// creditUsage is the current billing period's credits, or null when the usage endpoint cannot say:
// then the upload goes ahead, and a 402 is handled as above. The endpoint costs no credits.
async function creditUsage(apiKey) {
    try {
        const res = await fetch('https://api.dune.com/api/v1/usage', {
            method: 'POST',
            headers: { 'X-Dune-Api-Key': apiKey, 'Content-Type': 'application/json' },
            // Ask for the last 90 days so the log also shows how earlier periods were funded.
            body: JSON.stringify({
                start_date: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
                end_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            }),
        })
        if (!res.ok) {
            console.warn(`Dune usage unavailable: ${res.status} ${await res.text()}`)
            return null
        }
        const periods = (await res.json()).billing_periods ?? []
        for (const p of periods) {
            console.info(`  Dune billing period ${p.start_date} to ${p.end_date}: ${p.credits_used} of ${p.credits_included} credits`)
        }
        const now = Date.now()
        const period = periods.find((p) => Date.parse(p.start_date) <= now && now < Date.parse(p.end_date) + 86400000) ?? periods[0]
        if (!period) {
            return null
        }
        return {
            used: Number(period.credits_used),
            included: Number(period.credits_included),
            start: Date.parse(period.start_date),
            end: Date.parse(period.end_date) + 86400000,
        }
    } catch (e) {
        console.warn(`Dune usage unavailable: ${e?.message ?? e}`)
        return null
    }
}
