// Dune uploads, sent only when a dataset has something new.
//
// The upload endpoint replaces the whole table, and every call costs credits. The workflow runs
// every six hours, but the rate moves once a round (about 18 hours) and the burn table keeps one
// row per day, so uploading on every run sent the same data over and over -- eight uploads a day --
// and used up the billing cycle's credits limit on 2026-09-24. Each dataset now records the newest
// key it has uploaded (a round, or a day) in a file next to its CSV, and uploads only when the
// CSV's newest key is past it. A failed upload leaves that file alone, so the next run retries.

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

    // /api/v1/uploads/csv REPLACES the table, so the complete history is always sent. (The old
    // /v1/table/upload/csv endpoint was removed 2026-03-01.) Public upload, no Enterprise plan.
    const res = await fetch('https://api.dune.com/api/v1/uploads/csv', {
        method: 'POST',
        headers: { 'X-Dune-Api-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_name: table, data: csv, is_private: false, description }),
    })
    if (!res.ok) {
        throw new Error(`Dune upload failed: ${res.status} ${await res.text()}`)
    }
    writeFileSync(statePath, key + '\n')
    console.info(`Uploaded ${key} to Dune dataset "${table}" → query as dune.<team>.dataset_${table}`)
}
