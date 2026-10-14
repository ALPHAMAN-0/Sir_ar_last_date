import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const path = process.argv[2] ?? 'demo-sheet.xlsx'
const bytes = readFileSync(path)
const workbook = XLSX.read(bytes, { type: 'buffer' })
const sheetName = workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 })
console.log('Sheet name:', sheetName)
console.log('Total rows:', rows.length)
console.log('First row (header?):', JSON.stringify(rows[0]))
console.log('Second row:', JSON.stringify(rows[1]))
console.log('Third row:', JSON.stringify(rows[2]))
