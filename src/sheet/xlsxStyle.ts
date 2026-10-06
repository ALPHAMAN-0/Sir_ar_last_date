// The free edition of the Excel library writes no colours, no bold text and no
// frozen rows. This module adds them afterwards, by editing two kinds of XML
// file inside the finished .xlsx: the style table and each worksheet. Both
// downloads (the register's and the similarity report) go through here.

import * as XLSX from 'xlsx'

/** The register's tones, plus the look of a header row. */
export type Paint = 'header' | 'good' | 'info' | 'warn' | 'bad' | 'muted'

export type SheetStyle = {
  /** Keeps the first row in view while scrolling down. */
  freezeHeader?: boolean
  /** Cells to paint, by address ("D2"). A cell that was never written is left alone. */
  cells?: ReadonlyMap<string, Paint>
}

/** Light fills, readable on screen and in print. ARGB. */
const FILL: Record<Paint, string> = {
  header: 'FFE9E4D6',
  good: 'FFD4EFDB',
  info: 'FFDCE8F7',
  warn: 'FFFBE6B3',
  bad: 'FFF6CDC8',
  muted: 'FFE6E6E6',
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const encode = (text: string) => new TextEncoder().encode(text)

/** "A1", "AB12": the only cell addresses the sheet XML ever holds. */
const CELL_TAG = /<c r="([A-Z]{1,3}[0-9]{1,7})"([^>]*?)(\/?)>/g

type Styles = {
  xml: string
  /** numFmtId of every existing cell format, by index. */
  formats: string[]
  boldFont: number
  fills: Map<Paint, number>
  /** "baseIndex|paint" → new cell format index. */
  made: Map<string, number>
  added: string[]
}

function readStyles(xml: string): Styles {
  const fonts = /<fonts count="(\d+)">([\s\S]*?)<\/fonts>/.exec(xml)
  const fills = /<fills count="(\d+)">([\s\S]*?)<\/fills>/.exec(xml)
  const cellXfs = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(xml)
  if (!fonts || !fills || !cellXfs) throw new Error('Unexpected styles.xml')

  // A bold copy of the default font.
  const firstFont = /<font>([\s\S]*?)<\/font>/.exec(fonts[2])?.[1] ?? ''
  const boldFont = Number(fonts[1])
  let out = xml.replace(fonts[0], `<fonts count="${boldFont + 1}">${fonts[2]}<font><b/>${firstFont}</font></fonts>`)

  const fillIds = new Map<Paint, number>()
  let fillXml = ''
  let fillCount = Number(fills[1])
  for (const paint of Object.keys(FILL) as Paint[]) {
    fillIds.set(paint, fillCount++)
    fillXml += `<fill><patternFill patternType="solid"><fgColor rgb="${FILL[paint]}"/><bgColor indexed="64"/></patternFill></fill>`
  }
  out = out.replace(fills[0], `<fills count="${fillCount}">${fills[2]}${fillXml}</fills>`)

  const formats = [...cellXfs[2].matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((match) => match[1])
  return { xml: out, formats, boldFont, fills: fillIds, made: new Map(), added: [] }
}

/** The index of a cell format: the cell's own number format, painted. */
function formatFor(styles: Styles, base: number, paint: Paint): number {
  const key = `${base}|${paint}`
  const known = styles.made.get(key)
  if (known !== undefined) return known
  const numFmtId = styles.formats[base] ?? '0'
  const fontId = paint === 'header' ? styles.boldFont : 0
  const index = styles.formats.length + styles.added.length
  styles.added.push(
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${styles.fills.get(paint)}" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>`,
  )
  styles.made.set(key, index)
  return index
}

function finishStyles(styles: Styles): string {
  const total = styles.formats.length + styles.added.length
  return styles.xml.replace(
    /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/,
    (_, inner: string) => `<cellXfs count="${total}">${inner}${styles.added.join('')}</cellXfs>`,
  )
}

const FROZEN =
  '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
  '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'

function styleSheet(xml: string, style: SheetStyle, styles: Styles): string {
  let out = xml
  const cells = style.cells
  if (cells && cells.size > 0) {
    out = out.replace(CELL_TAG, (tag, ref: string, attrs: string, close: string) => {
      const paint = cells.get(ref)
      if (!paint) return tag
      const own = /\ss="(\d+)"/.exec(attrs)
      const index = formatFor(styles, own ? Number(own[1]) : 0, paint)
      const rest = own ? attrs.replace(own[0], '') : attrs
      return `<c r="${ref}" s="${index}"${rest}${close}>`
    })
  }
  if (style.freezeHeader) {
    out = /<sheetView\b[^>]*?\/>/.test(out)
      ? out.replace(/<sheetView\b([^>]*?)\/>/, `<sheetView$1>${FROZEN}</sheetView>`)
      : out.replace(/(<dimension\b[^>]*\/>)/, `$1<sheetViews><sheetView workbookViewId="0">${FROZEN}</sheetView></sheetViews>`)
  }
  return out
}

type ZipEntry = { content: Uint8Array }
type Zip = { FullPaths: string[]; FileIndex: ZipEntry[] }

function entry(zip: Zip, path: string): ZipEntry | null {
  const index = zip.FullPaths.findIndex((full) => full.endsWith(`/${path}`))
  return index === -1 ? null : zip.FileIndex[index]
}

/**
 * Writes the workbook as .xlsx bytes, then applies `sheets[i]` to the i-th sheet.
 * The library names its sheet files sheet1.xml, sheet2.xml… in workbook order.
 */
export function writeStyledXlsx(book: XLSX.WorkBook, sheets: ReadonlyArray<SheetStyle | undefined>): Uint8Array {
  const plain = new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true }))
  if (sheets.every((style) => !style)) return plain

  const zip = XLSX.CFB.read(plain, { type: 'array' }) as Zip
  const stylesEntry = entry(zip, 'xl/styles.xml')
  if (!stylesEntry) throw new Error('No styles.xml in the workbook')
  const styles = readStyles(decode(stylesEntry.content))

  sheets.forEach((style, index) => {
    if (!style) return
    const sheet = entry(zip, `xl/worksheets/sheet${index + 1}.xml`)
    if (!sheet) throw new Error(`No sheet${index + 1}.xml in the workbook`)
    sheet.content = encode(styleSheet(decode(sheet.content), style, styles))
  })
  stylesEntry.content = encode(finishStyles(styles))

  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayLike<number>)
}

/** Hands the bytes to the browser as a download. */
export function saveFile(bytes: Uint8Array, fileName: string, type = XLSX_TYPE): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start reading the file only after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Paints a header row: every cell from column 0 to `columns - 1` in row 1. */
export function headerCells(columns: number, into = new Map<string, Paint>()): Map<string, Paint> {
  for (let c = 0; c < columns; c++) into.set(XLSX.utils.encode_cell({ r: 0, c }), 'header')
  return into
}
