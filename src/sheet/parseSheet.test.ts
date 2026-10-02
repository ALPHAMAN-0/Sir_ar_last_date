import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildRows, describeColumns, detectMapping, MAX_ROWS, SheetError } from './columns.ts'
import { readSheet } from './parseSheet.ts'

type Value = string | number | null
type Tweak = (sheet: XLSX.WorkSheet) => void

function workbook(rows: Value[][], tweak?: Tweak, bookType: XLSX.BookType = 'xlsx'): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  tweak?.(sheet)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Students')
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer)
}

function parse(rows: Value[][], tweak?: Tweak) {
  const data = readSheet(workbook(rows, tweak))
  const mapping = detectMapping(data.grid)
  return { data, mapping, rows: buildRows(data, mapping) }
}

const summary = (rows: ReturnType<typeof parse>['rows']) =>
  rows.map((row) => [row.rowNumber, row.id, row.name, row.link.ok ? row.link.key : `!${row.link.reason}`])

describe('the expected sheet: id, name, repolink', () => {
  it('reads the three columns and keeps Excel row numbers', () => {
    const { data, mapping, rows } = parse([
      ['id', 'name', 'repolink'],
      ['20-41234-1', 'Rahim Uddin', 'https://github.com/rahim/task-1'],
      ['20-41235-1', 'Karim Hasan', 'github.com/karim/Task-1.git'],
    ])
    expect(data.sheetName).toBe('Students')
    expect(mapping).toEqual({ id: 0, name: 1, link: 2, headerRow: 0 })
    expect(summary(rows)).toEqual([
      [2, '20-41234-1', 'Rahim Uddin', 'rahim/task-1'],
      [3, '20-41235-1', 'Karim Hasan', 'karim/task-1'],
    ])
    expect(rows[0].rowId).toBe('r2')
  })

  it('matches headers loosely and in any column order', () => {
    const { mapping, rows } = parse([
      ['GitHub Repo Link', 'Student Name', 'Student ID'],
      ['https://github.com/a/b', 'Salma', 7],
    ])
    expect(mapping).toEqual({ id: 2, name: 1, link: 0, headerRow: 0 })
    expect(summary(rows)).toEqual([[2, '7', 'Salma', 'a/b']])
  })

  it('prefers the more specific header when two could be the link', () => {
    const { mapping } = parse([
      ['id', 'name', 'link', 'repolink'],
      ['1', 'A', 'https://example.com/profile', 'https://github.com/a/b'],
    ])
    expect(mapping.link).toBe(3)
  })

  it('skips title rows above the header and blank rows between people', () => {
    const { mapping, rows } = parse([
      ['CSE 4100 - Section B', null, null],
      [null, null, null],
      ['ID', 'Name', 'Repo'],
      ['1', 'Rahim', 'https://github.com/rahim/x'],
      [null, null, null],
      ['2', 'Karim', 'https://github.com/karim/x'],
    ])
    expect(mapping.headerRow).toBe(2)
    expect(summary(rows)).toEqual([
      [4, '1', 'Rahim', 'rahim/x'],
      [6, '2', 'Karim', 'karim/x'],
    ])
  })
})

describe('sheets without a usable header', () => {
  it('finds the link column by its content', () => {
    const { mapping, rows } = parse([
      ['1', 'Rahim', 'https://github.com/rahim/x'],
      ['2', 'Karim', 'https://github.com/karim/x'],
    ])
    expect(mapping).toEqual({ id: 0, name: 1, link: 2, headerRow: null })
    expect(rows).toHaveLength(2)
  })

  it('treats an unknown first row above the links as a header', () => {
    const { mapping, rows } = parse([
      ['Roll', 'Naam', 'Kaj'],
      ['1', 'Rahim', 'https://github.com/rahim/x'],
    ])
    expect(mapping).toEqual({ id: 0, name: 1, link: 2, headerRow: 0 })
    expect(rows).toHaveLength(1)
  })

  it('uses a single spare column as the name', () => {
    const { mapping } = parse([
      ['Rahim', 'https://github.com/rahim/x'],
      ['Karim', 'https://github.com/karim/x'],
    ])
    expect(mapping).toMatchObject({ id: null, name: 0, link: 1 })
  })

  it('reports no link column when nothing looks like a repo', () => {
    const { mapping, rows } = parse([
      ['1', 'Rahim'],
      ['2', 'Karim'],
    ])
    expect(mapping.link).toBeNull()
    expect(rows.every((row) => !row.link.ok)).toBe(true)
  })
})

describe('how links are stored in cells', () => {
  it('reads a hyperlink hidden behind display text', () => {
    const { rows } = parse(
      [
        ['id', 'name', 'repolink'],
        ['1', 'Rahim', 'Click here'],
      ],
      (sheet) => {
        sheet.C2.l = { Target: 'https://github.com/rahim/hidden' }
      },
    )
    expect(rows[0].link).toMatchObject({ ok: true, key: 'rahim/hidden' })
    expect(rows[0].rawLink).toBe('https://github.com/rahim/hidden')
  })

  it('reads a HYPERLINK() formula', () => {
    const { rows } = parse(
      [
        ['id', 'name', 'repolink'],
        ['1', 'Rahim', 'Repo'],
      ],
      (sheet) => {
        sheet.C2 = { t: 's', v: 'Repo', f: 'HYPERLINK("https://github.com/rahim/formula","Repo")' }
      },
    )
    expect(rows[0].link).toMatchObject({ ok: true, key: 'rahim/formula' })
  })

  it('trusts visible link text over a different hyperlink target', () => {
    const { rows } = parse(
      [
        ['id', 'name', 'repolink'],
        ['1', 'Rahim', 'https://github.com/rahim/visible'],
      ],
      (sheet) => {
        sheet.C2.l = { Target: 'https://github.com/someone/else' }
      },
    )
    expect(rows[0].link).toMatchObject({ ok: true, key: 'rahim/visible' })
  })

  it('keeps a row with a bad link and says why', () => {
    const { rows } = parse([
      ['id', 'name', 'repolink'],
      ['1', 'Rahim', 'https://github.com/rahim'],
      ['2', 'Karim', null],
      ['3', 'Salma', 'will send later'],
    ])
    expect(summary(rows)).toEqual([
      [2, '1', 'Rahim', '!not_a_repo'],
      [3, '2', 'Karim', '!empty'],
      [4, '3', 'Salma', '!malformed'],
    ])
  })
})

describe('cell values', () => {
  it('keeps leading zeros and never shows scientific notation', () => {
    const { rows } = parse(
      [
        ['id', 'name', 'repolink'],
        [123, 'Zero padded', 'https://github.com/a/b'],
        [20412345678901, 'Long id', 'https://github.com/a/c'],
        ['007', 'Text id', 'https://github.com/a/d'],
      ],
      (sheet) => {
        sheet.A2.z = '00000'
        delete sheet.A2.w
      },
    )
    expect(rows.map((row) => row.id)).toEqual(['00123', '20412345678901', '007'])
  })

  it('fills merged cells from their top-left value', () => {
    const { rows } = parse(
      [
        ['id', 'name', 'repolink'],
        ['1', 'Team Alpha', 'https://github.com/alpha/one'],
        ['2', null, 'https://github.com/alpha/two'],
      ],
      (sheet) => {
        sheet['!merges'] = [{ s: { r: 1, c: 1 }, e: { r: 2, c: 1 } }]
      },
    )
    expect(rows.map((row) => row.name)).toEqual(['Team Alpha', 'Team Alpha'])
  })

  it('does not treat header text as object keys', () => {
    const { rows } = parse([
      ['__proto__', 'constructor', 'repolink'],
      ['1', 'Rahim', 'https://github.com/rahim/x'],
    ])
    expect(summary(rows)).toEqual([[2, '1', 'Rahim', 'rahim/x']])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('limits and errors', () => {
  it('reads at most 1,000 people and says the sheet was cut', () => {
    const many: Value[][] = [['id', 'name', 'repolink']]
    for (let i = 1; i <= MAX_ROWS + 50; i++) many.push([String(i), `P${i}`, `https://github.com/u/r${i}`])
    const { data, rows } = parse(many)
    expect(rows).toHaveLength(MAX_ROWS)
    expect(data.truncated).toBe(true)
    expect(rows[MAX_ROWS - 1].id).toBe(String(MAX_ROWS))
  })

  it('reads a CSV file too', () => {
    const csv = new TextEncoder().encode('id,name,repolink\n1,Rahim,https://github.com/rahim/x\n')
    const data = readSheet(csv)
    const rows = buildRows(data, detectMapping(data.grid))
    expect(summary(rows)).toEqual([[2, '1', 'Rahim', 'rahim/x']])
  })

  it('throws a clear error for an empty sheet', () => {
    expect(() => readSheet(workbook([]))).toThrowError(SheetError)
    try {
      readSheet(workbook([]))
    } catch (error) {
      expect((error as SheetError).problem).toBe('empty')
    }
  })

  it('names the columns for the column picker', () => {
    const { data, mapping } = parse([
      ['id', 'name', 'repolink'],
      ['1', 'Rahim', 'https://github.com/rahim/x'],
    ])
    expect(describeColumns(data, mapping)).toEqual(['A: id', 'B: name', 'C: repolink'])
  })
})
