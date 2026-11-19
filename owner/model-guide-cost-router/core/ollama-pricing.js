/**
 * Official Ollama Cloud pricing ingestion: parse the official pricing table
 * defensively, then map rates onto discovered model ids with exact matching.
 *
 * Source contract (verified against https://ollama.com/pricing, section
 * `id="model-pricing"`): one table with headers Model / Input / Cached input /
 * Output; each body row's first cell links `/library/<slug>` with the display
 * name, ` (Off-Peak)` suffix marks the off-peak variant of the same model;
 * price cells are `$<number>` or a dash meaning "not listed". Prices are
 * published per million tokens; off-peak windows are the provider's own note
 * and are recorded verbatim, never computed.
 *
 * Nothing here guesses: a page lacking the expected section or headers, or a
 * row whose price cells do not parse as dollar amounts, fails closed; a model
 * id that matches zero or several rows stays unmapped and the caller retains
 * the previously stored price.
 */

/**
 * One parsed official pricing row.
 * @typedef {object} OllamaPriceRow
 * @property {string} name display name exactly as published, without the Off-Peak suffix.
 * @property {string} slug canonical /library/ slug the row links to.
 * @property {number} [inputPerMTok] USD per 1M uncached input tokens; absent when not published.
 * @property {number|null} cachedInputPerMTok USD per 1M cached input tokens; null means explicitly not listed.
 * @property {number} [outputPerMTok] USD per 1M output tokens; absent when not published.
 */

/** @typedef {{row: OllamaPriceRow, offPeak?: OllamaPriceRow}} MappedPricing */

/**
 * Parsed rows keyed by exact published name, each with its optional off-peak twin.
 * @typedef {Record<string, MappedPricing>} OllamaPricingTable
 */

const PRICE_CELL = /^\$([0-9]+(?:\.[0-9]+)?)$/
const DASH = /^(?:-|–|—|&nbsp;|\s*)$/
const OFF_PEAK_SUFFIX = /\s*\(Off-Peak\)\s*$/

/** Decode the handful of HTML entities and stray tags the table can contain. */
const decodeHtml = (text) => text
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, '\'')
  .replace(/<\/?[^>]+>/g, '')

/**
 * Parse the official model-pricing table out of one fetched page.
 * @param {string} html raw page body.
 * @returns {{ok: true, table: OllamaPricingTable, offPeakNote?: string} | {ok: false, reason: string}}
 */
export function parseOllamaModelPricing(html) {
  const section = html.match(/<section\s+id="model-pricing"[\s\S]*?<\/section>/)
  if (section === null) {
    return { ok: false, reason: 'the page has no `id="model-pricing"` section; it does not look like the official Ollama model pricing source' }
  }
  const tableMatch = section[0].match(/<table[\s\S]*?<\/table>/)
  if (tableMatch === null) return { ok: false, reason: 'the model-pricing section contains no pricing table' }
  const table = tableMatch[0]

  const thead = table.match(/<thead>([\s\S]*?)<\/thead>/)
  if (thead === null) return { ok: false, reason: 'the pricing table has no header row' }
  const headers = [...thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((th) => decodeHtml(th[1]).trim())
  const expected = ['Model', 'Input', 'Cached input', 'Output']
  if (headers.join('\u0000') !== expected.join('\u0000')) {
    return { ok: false, reason: `pricing table headers changed: found [${headers.join(', ')}], expected [${expected.join(', ')}]` }
  }

  const tbody = table.match(/<tbody>([\s\S]*?)<\/tbody>/)
  if (tbody === null) return { ok: false, reason: 'the pricing table has no body rows' }
  const rows = tbody[1].match(/<tr[\s\S]*?<\/tr>/g)
  if (rows === null || rows.length === 0) return { ok: false, reason: 'the pricing table body is empty' }

  /** @type {OllamaPricingTable} */
  const mapped = {}
  for (const rowHtml of rows) {
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => td[1])
    if (cells.length !== headers.length) {
      const { length } = cells
      return { ok: false, reason: `a pricing row has ${length} cells, expected ${headers.length}; refusing to parse a changed schema` }
    }
    const link = cells[0].match(/<a\s+href="\/library\/([a-z0-9._:-]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (link === null) {
      return { ok: false, reason: 'a pricing row model cell is not a /library/ link; refusing to guess the model name' }
    }
    const slug = decodeHtml(link[1]).trim()
    const display = decodeHtml(link[2]).trim()

    // A published row may leave a price cell as a dash: `clef` is `$0.24 / - / -`
    // and `mistral-large-3` is `$0.50 / - / $1.50`. A dash is the provider's
    // own way of saying "not listed", so it records null for THAT cell and the
    // model keeps whatever prices it does publish. Only one row is affected;
    // every other row on the page still parses, which is the difference
    // between losing one model's price and losing the whole table.
    //
    // Structural change still fails closed: a cell that is neither a dollar
    // price nor a dash means the table's shape is not the one this parser was
    // written against, and guessing there would mis-price every model.
    const pricedCells = [
      { cell: decodeHtml(cells[1]).trim(), label: 'inputPerMTok' },
      { cell: decodeHtml(cells[2]).trim(), label: 'cachedInputPerMTok' },
      { cell: decodeHtml(cells[3]).trim(), label: 'outputPerMTok' },
    ]
    const rates = /** @type {Record<string, number | null | undefined>} */ ({})
    for (const { cell, label } of pricedCells) {
      const price = cell.match(PRICE_CELL)
      if (price !== null && Number(price[1]) < 1e6) {
        rates[label] = Number(price[1])
      } else if (DASH.test(cell)) {
        rates[label] = null
      } else {
        return { ok: false, reason: `${label} cell "${cell}" is neither a dollar price nor a dash for ${display}; refusing to parse a changed schema` }
      }
    }

    const offPeak = OFF_PEAK_SUFFIX.test(display)
    const name = offPeak ? display.replace(OFF_PEAK_SUFFIX, '').trim() : display
    const parsed = /** @type {OllamaPriceRow} */ ({
      name,
      slug,
      // A null here means the provider explicitly did not list that rate; an
      // absent field means the row did not carry the cell at all. Callers
      // distinguish the two, so a null is never silently treated as free.
      inputPerMTok: /** @type {number | null} */ (rates['inputPerMTok']),
      cachedInputPerMTok: /** @type {number | null} */ (rates['cachedInputPerMTok']),
      outputPerMTok: /** @type {number | null} */ (rates['outputPerMTok']),
    })
    if (offPeak) {
      const existing = mapped[name]
      if (existing === undefined) {
        return { ok: false, reason: `off-peak row for "${name}" has no published regular-price row; refusing to store partially published rates` }
      }
      existing.offPeak = parsed
    } else {
      if (mapped[name] !== undefined) {
        return { ok: false, reason: `duplicate regular-price row for "${name}"; refusing to guess which price applies` }
      }
      mapped[name] = { row: parsed }
    }
  }

  const offPeakNote = section[0].match(/Off-peak[^<]*/)?.[0]
  return { ok: true, table: mapped, ...(offPeakNote === undefined ? {} : { offPeakNote }) }
}

/**
 * Map parsed official rates onto discovered model ids with exact matching.
 * A model id matches when either its exact display name equals the row name,
 * or (only when unique among published rows) its exact /library/ slug does —
 * ambiguity of any kind leaves the model unmapped and the caller retains its
 * previously stored price.
 * @param {OllamaPricingTable} table parsed official rows.
 * @param {string[]} modelIds discovered model ids on the Ollama provider.
 * @returns {{mapped: Record<string, MappedPricing>, unmatched: string[], ambiguous: {id: string, reason: string}[]}}
 */
export function mapOllamaRates(table, modelIds) {
  const rowsBySlug = /** @type {Record<string, string[]>} */ ({})
  for (const name of Object.keys(table)) {
    const slug = table[name].row.slug.toLowerCase()
    ;(rowsBySlug[slug] ??= []).push(name)
  }

  const mapped = /** @type {Record<string, MappedPricing>} */ ({})
  const unmatched = /** @type {string[]} */ ([])
  const ambiguous = /** @type {{id: string, reason: string}[]} */ ([])
  for (const id of modelIds) {
    const nameMatches = Object.keys(table).filter((name) => name.toLowerCase() === id.toLowerCase())
    if (nameMatches.length > 1) {
      ambiguous.push({ id, reason: 'matches several published rows by name' })
      continue
    }
    if (nameMatches.length === 1) {
      mapped[id] = table[nameMatches[0]]
      continue
    }
    const slugMatches = rowsBySlug[id.toLowerCase()] ?? []
    if (slugMatches.length > 1) {
      ambiguous.push({ id, reason: `library slug is published under several display names (${slugMatches.join(', ')})` })
      continue
    }
    if (slugMatches.length === 1) {
      mapped[id] = table[slugMatches[0]]
      continue
    }
    unmatched.push(id)
  }
  return { mapped, unmatched, ambiguous }
}

/**
 * Build one verified rate record from a mapped official row. Off-peak rates
 * carry the provider's own row; no reasoning multiplier or derived number is
 * ever invented.
 * @param {MappedPricing} mapping the matched rows.
 * @param {string} source URL the table was parsed from.
 * @param {string} verifiedAt ISO instant of this verification.
 * @returns {object} a CloudRates-shaped record including off-peak when published.
 */
export function rateRecordFromRow(mapping, source, verifiedAt) {
  const { row, offPeak } = mapping
  /**
   * A price the provider did not publish is recorded as null, never as a
   * number and never as zero: a zero would read as "free" in every consumer
   * that only checks for a number.
   * @param {number|null|undefined} value
   * @returns {number|null}
   */
  const price = (value) => (typeof value === 'number' ? value : null)
  return {
    inputPerMTok: price(row.inputPerMTok),
    cachedInputPerMTok: price(row.cachedInputPerMTok),
    outputPerMTok: price(row.outputPerMTok),
    ...(!offPeak ? {} : {
      offPeak: {
        inputPerMTok: price(offPeak.inputPerMTok),
        cachedInputPerMTok: price(offPeak.cachedInputPerMTok),
        outputPerMTok: price(offPeak.outputPerMTok),
      },
    }),
    source,
    verifiedAt,
  }
}