import * as XLSX from 'xlsx'
import { writeFileSync } from 'node:fs'
import { detectSheetKind, markColumnIndices } from '../src/sheet/kind.ts'
import { detectMapping } from '../src/sheet/columns.ts'

// A sheet that has BOTH a link column AND mark columns. The detector should
// classify it as 'project' (link wins) and leave marks empty.
const rows = [
  ['id', 'name', 'repolink', 'midterm', 'final'],
  ['22-46001-1', 'Rahim Uddin', 'https://github.com/octocat/Hello-World', 30, 50],
  ['22-46002-1', 'Karim Hasan', 'https://github.com/octocat/Spoon-Knife', 25, 45],
]
const sheet = XLSX.utils.aoa_to_sheet(rows)
const book = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(book, sheet, 'Both')
const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
writeFileSync('qa/both-demo.xlsx', Buffer.from(bytes as ArrayLike<number>))

const wb2 = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false })
const sn = wb2.SheetNames[0]
const grid = XLSX.utils
  .sheet_to_json<unknown[]>(wb2.Sheets[sn], { header: 1 })
  .map((r) => (r as unknown[]).map((cell) => (cell === null || cell === undefined ? { text: '' } : { text: String(cell) })))
const mapping = detectMapping(grid)
const kind = detectSheetKind(grid, mapping)
const marks = markColumnIndices(grid, mapping.headerRow ?? 0)
console.log('Kind:', kind)
console.log('Mapping:', mapping)
console.log('Mark columns:', marks)
