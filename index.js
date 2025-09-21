const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const CryptoJS = require('crypto-js')
let useSqlite = false
let db = null
let Database = null
try {
  Database = require('better-sqlite3')
} catch (err) {
  // better-sqlite3 not available; we'll fall back to file-based store later
}

const app = express()
app.use(cors())
app.use(bodyParser.json())

// If better-sqlite3 is present, initialize DB. Otherwise we'll use file JSON store.
const DB_PATH = path.resolve(__dirname, 'data.db')
if (Database) {
  try {
    db = new Database(DB_PATH)
    useSqlite = true
    // Create tables if not exist
    db.exec(`
CREATE TABLE IF NOT EXISTS anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  invoice_json TEXT NOT NULL,
  wallet TEXT,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT,
  amount REAL,
  escrow INTEGER,
  status TEXT,
  meta_json TEXT,
  ts INTEGER
);
`)
    console.log('Using better-sqlite3 for persistence')
  } catch (err) {
    console.warn('Failed to initialize better-sqlite3 - falling back to JSON file store', String(err))
    useSqlite = false
    db = null
  }
} else {
  console.log('better-sqlite3 not installed — using JSON file fallback')
}

function assessRisk({to, amount, escrow}){
  const reasons = []
  let score = 0
  if (!to || String(to).length < 3){ score += 30; reasons.push('Unknown recipient') }
  if (amount > 2000){ score += 40; reasons.push('High amount') }
  if (!escrow && amount > 500){ score += 20; reasons.push('No escrow for medium/large amount') }
  const noise = Math.floor(Math.random()*10)
  score += noise
  const label = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low'
  const suggestedAction = label === 'high' ? 'block' : label === 'medium' ? 'require_mfa' : 'allow'
  return {score, label, reasons, suggestedAction}
}

// JSON-file helper fallback
const fs = require('fs').promises
const JSON_PATH = path.resolve(__dirname, 'data.json')

async function loadJSON(){
  try {
    const raw = await fs.readFile(JSON_PATH, 'utf8')
    return JSON.parse(raw)
  } catch(e){
    return {anchors: [], payments: []}
  }
}

async function saveJSON(obj){
  const tmp = JSON_PATH + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8')
  await fs.rename(tmp, JSON_PATH)
}

app.get('/api/health', async (req, res) => {
  if (useSqlite) return res.json({ok:true, storage: 'sqlite'})
  const data = await loadJSON()
  return res.json({ok:true, storage: 'jsonfile', counts: {anchors: data.anchors.length, payments: data.payments.length}})
})

app.post('/api/risk', (req,res)=>{
  const {to, amount, escrow} = req.body || {}
  res.json(assessRisk({to, amount, escrow}))
})

// Anchor invoice and persist to SQLite
app.post('/api/anchor', async (req,res)=>{
  const {invoice, wallet} = req.body || {}
  if (!invoice) return res.status(400).json({error:'missing invoice'})
  const invoiceJson = JSON.stringify(invoice)
  const hash = CryptoJS.SHA256(invoiceJson).toString()
  const ts = Date.now()
  if (useSqlite && db){
    try {
      const insert = db.prepare('INSERT INTO anchors (hash, invoice_json, wallet, ts) VALUES (?, ?, ?, ?)')
      insert.run(hash, invoiceJson, wallet || null, ts)
    } catch (err) {
      if (!/UNIQUE constraint failed/.test(String(err))){
        console.error('DB insert anchor error', err)
        return res.status(500).json({ok:false, error: 'db_error', detail: String(err)})
      }
    }
    const row = db.prepare('SELECT id, hash, wallet, ts, invoice_json FROM anchors WHERE hash = ?').get(hash)
    const record = {
      id: row.id,
      hash: row.hash,
      wallet: row.wallet,
      ts: row.ts,
      invoice: JSON.parse(row.invoice_json)
    }
    return res.json({ok:true, hash, record})
  }

  // JSON fallback
  const data = await loadJSON()
  let existing = data.anchors.find(a => a.hash === hash)
  if (!existing){
    existing = { id: data.anchors.length + 1, hash, wallet: wallet || null, ts, invoice }
    data.anchors.unshift(existing)
    await saveJSON(data)
  }
  res.json({ok:true, hash, record: existing})
})

app.get('/api/anchors', async (req, res) => {
  if (useSqlite && db){
    const rows = db.prepare('SELECT id, hash, wallet, ts, invoice_json FROM anchors ORDER BY ts DESC').all()
    const mapped = rows.map(r=>({id:r.id, hash:r.hash, wallet:r.wallet, ts:r.ts, invoice: JSON.parse(r.invoice_json)}))
    return res.json(mapped)
  }
  const data = await loadJSON()
  return res.json(data.anchors)
})

app.post('/api/pay', async (req,res)=>{
  const {to, amount, escrow, meta} = req.body || {}
  const ts = Date.now()
  if (useSqlite && db){
    const insert = db.prepare('INSERT INTO payments (recipient, amount, escrow, status, meta_json, ts) VALUES (?, ?, ?, ?, ?, ?)')
    const info = insert.run(to, amount || 0, escrow ? 1 : 0, 'pending', meta ? JSON.stringify(meta) : null, ts)
    const row = db.prepare('SELECT id, recipient, amount, escrow, status, meta_json, ts FROM payments WHERE id = ?').get(info.lastInsertRowid)
    const record = {id: row.id, recipient: row.recipient, amount: row.amount, escrow: !!row.escrow, status: row.status, meta: row.meta_json ? JSON.parse(row.meta_json) : null, ts: row.ts}
    return res.json({ok:true, record})
  }

  const data = await loadJSON()
  const record = {id: data.payments.length + 1, recipient: to, amount: amount || 0, escrow: !!escrow, status: 'pending', meta: meta || null, ts}
  data.payments.unshift(record)
  await saveJSON(data)
  res.json({ok:true, record})
})

app.get('/api/payments', async (req, res) => {
  if (useSqlite && db){
    const rows = db.prepare('SELECT id, recipient, amount, escrow, status, meta_json, ts FROM payments ORDER BY ts DESC').all()
    const mapped = rows.map(r=>({id:r.id, recipient:r.recipient, amount:r.amount, escrow:!!r.escrow, status:r.status, meta: r.meta_json?JSON.parse(r.meta_json):null, ts:r.ts}))
    return res.json(mapped)
  }
  const data = await loadJSON()
  return res.json(data.payments)
})

// Delete a payment by id
app.delete('/api/payments/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ok:false, error:'invalid_id'})
  if (useSqlite && db){
    try {
      const row = db.prepare('SELECT id, recipient, amount, escrow, status, meta_json, ts FROM payments WHERE id = ?').get(id)
      if (!row) return res.status(404).json({ok:false, error:'not_found'})
      db.prepare('DELETE FROM payments WHERE id = ?').run(id)
      const record = {id: row.id, recipient: row.recipient, amount: row.amount, escrow:!!row.escrow, status: row.status, meta: row.meta_json?JSON.parse(row.meta_json):null, ts: row.ts}
      return res.json({ok:true, deleted: record})
    } catch (err) {
      console.error('DB delete payment error', err)
      return res.status(500).json({ok:false, error:'db_error', detail: String(err)})
    }
  }

  // JSON fallback
  const data = await loadJSON()
  const idx = data.payments.findIndex(p => p.id === id)
  if (idx === -1) return res.status(404).json({ok:false, error:'not_found'})
  const [deleted] = data.payments.splice(idx, 1)
  await saveJSON(data)
  return res.json({ok:true, deleted})
})

const port = process.env.PORT || 4001
app.listen(port, ()=> console.log('Backend listening on', port))

// Graceful shutdown
process.on('SIGINT', ()=>{
  console.log('Shutting down...')
  try { db.close() } catch(e){}
  process.exit(0)
})

