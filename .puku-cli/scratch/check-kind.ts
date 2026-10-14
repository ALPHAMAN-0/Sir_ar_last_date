import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'
import { detectSheetKind, markColumnIndices } from '../src/sheet/kind.ts'
import { detectMapping } from '../src/sheet/columns.ts'

const path = process.argv[2] ?? 'demo-sheet.xlsx'
const bytes = readFileSync(path)
const workbook = XLSX.read(bytes, { type: 'buffer', cellFormula: true, cellHTML: false })
const sheetName = workbook.SheetNames[0]
const sheet = workbook.Sheets[sheetName]
const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).map((r) =>
  (r as unknown[]).map((cell) => (cell === null || cell === undefined ? { text: '' } : { text: String(cell) })),
)
const mapping = detectMapping(grid)
const kind = detectSheetKind(grid, mapping)
const marks = markColumnIndices(grid, mapping.headerRow ?? 0)
console.log('Kind:', kind)
console.log('Mapping:', mapping)
console.log('Mark columns:', marks)
