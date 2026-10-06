// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { headerCells, saveFile, writeStyledXlsx, XLSX_TYPE, type Paint } from './xlsxStyle.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function book(): XLSX.WorkBook {
  const sheet: XLSX.WorkSheet = {
    A1: { t: 's', v: 'Status' },
    B1: { t: 's', v: 'When' },
    C1: { t: 's', v: 'Share' },
    A2: { t: 's', v: 'Late' },
    B2: { t: 'n', v: 46000.5, z: 'yyyy-mm-dd hh:mm' },
    C2: { t: 'n', v: 0.25, z: '0%' },
    '!ref': 'A1:C2',
  }
  const result = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(result, sheet, 'One')
  XLSX.utils.book_append_sheet(result, { A1: { t: 's', v: 'untouched' }, '!ref': 'A1' }, 'Two')
  return result
}

const read = (bytes: Uint8Array) => XLSX.read(bytes, { type: 'array', cellStyles: true })
const fill = (cell: XLSX.CellObject) => (cell.s as { fgColor?: { rgb?: string } } | undefined)?.fgColor?.rgb

function xml(bytes: Uint8Array, path: string): string {
  const zip = XLSX.CFB.read(bytes, { type: 'array' })
  const index = zip.FullPaths.findIndex((full: string) => full.endsWith(`/${path}`))
  return new TextDecoder().decode(zip.FileIndex[index].content)
}

describe('writeStyledXlsx', () => {
  it('paints cells and keeps their number formats', () => {
    const cells = new Map<string, Paint>([['A2', 'bad'], ['B2', 'bad'], ['C2', 'good']])
    const sheet = read(writeStyledXlsx(book(), [{ cells }])).Sheets.One
    expect(fill(sheet.A2)).toBe('F6CDC8')
    expect(fill(sheet.B2)).toBe('F6CDC8')
    expect(fill(sheet.C2)).toBe('D4EFDB')
    expect(sheet.B2.z).toBe('yyyy-mm-dd hh:mm')
    expect(sheet.C2.z).toBe('0%')
    expect(sheet.B2.v).toBe(46000.5)
  })

  it('makes header cells bold and shaded', () => {
    const bytes = writeStyledXlsx(book(), [{ cells: headerCells(3) }])
    expect(fill(read(bytes).Sheets.One.A1)).toBe('E9E4D6')
    const styles = xml(bytes, 'xl/styles.xml')
    expect(styles).toMatch(/<fonts count="2">.*<font><b\/>/)
    expect(xml(bytes, 'xl/worksheets/sheet1.xml')).toMatch(/<c r="C1" s="\d+" t="str">/)
  })

  it('freezes the header row of the chosen sheets only', () => {
    const bytes = writeStyledXlsx(book(), [{ freezeHeader: true }, undefined])
    expect(xml(bytes, 'xl/worksheets/sheet1.xml')).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    )
    expect(xml(bytes, 'xl/worksheets/sheet2.xml')).not.toContain('frozen')
  })

  it('ignores cells that were never written', () => {
    const bytes = writeStyledXlsx(book(), [{ cells: new Map([['Z99', 'warn']]) }])
    expect(read(bytes).Sheets.One.Z99).toBeUndefined()
  })

  it('reuses one cell format for cells that look the same', () => {
    const cells = new Map<string, Paint>([['A1', 'bad'], ['A2', 'bad']])
    const styles = xml(writeStyledXlsx(book(), [{ cells }]), 'xl/styles.xml')
    const plain = xml(writeStyledXlsx(book(), [{ cells: new Map([['A1', 'bad']]) }]), 'xl/styles.xml')
    expect(/<cellXfs count="(\d+)"/.exec(styles)?.[1]).toBe(/<cellXfs count="(\d+)"/.exec(plain)?.[1])
  })

  it('leaves the second sheet and every value as they were', () => {
    const books = read(writeStyledXlsx(book(), [{ freezeHeader: true, cells: headerCells(3) }]))
    expect(books.SheetNames).toEqual(['One', 'Two'])
    expect(books.Sheets.Two.A1.v).toBe('untouched')
    expect(books.Sheets.One.A2.v).toBe('Late')
  })
})

describe('saveFile', () => {
  it('starts a download under the given name and lets go of the file afterwards', () => {
    vi.useFakeTimers()
    const created: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return 'blob:report'
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })

    saveFile(new Uint8Array([1, 2, 3]), 'results.xlsx')

    expect(created[0].type).toBe(XLSX_TYPE)
    expect(created[0].size).toBe(3)
    expect(clicked[0].download).toBe('results.xlsx')
    expect(clicked[0].href).toBe('blob:report')
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    vi.unstubAllGlobals()
  })
})
