// A small in-memory stand-in for the part of PostgREST / supabase-js that the My Leads list uses, so pagination, filters,
// sorting and ownership run against real data (thousands of rows) in tests. It follows SQL's rules where they matter here:
// a comparison with NULL is never true (so `neq` and `not.in` exclude NULL rows), NULLs sort last ascending and first
// descending unless told otherwise, and an inner embedded join keeps only rows with a matching child.

const splitTop = (text) => {
  const parts = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of text) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (!quoted && depth === 0 && char === ',') { parts.push(current); current = '' } else current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

const read = (row, path) => {
  const [column, key] = path.split('->>')
  const value = row[column]
  if (key === undefined) return value === undefined ? null : value
  if (value === null || value === undefined || typeof value !== 'object') return null
  const inner = value[key]
  if (inner === undefined || inner === null) return null
  return typeof inner === 'string' ? inner : JSON.stringify(inner)
}

const like = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.')}$`, 'i')
const unquote = (value) => (value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value)
const list = (value) => value.replace(/^\(|\)$/g, '').split(',')

function conditionFromOr(item) {
  const match = /^([^.]+(?:->>[^.]+)?)\.(.*)$/.exec(item)
  const [, column, rest] = match
  return (row) => {
    const value = read(row, column)
    if (rest === 'is.null') return value === null
    if (value === null) return false
    if (rest.startsWith('eq.')) return String(value) === rest.slice(3)
    if (rest.startsWith('neq.')) return String(value) !== rest.slice(4)
    if (rest.startsWith('ilike.')) return like(unquote(rest.slice(6))).test(String(value))
    if (rest.startsWith('not.in.')) return !list(rest.slice(7)).includes(String(value))
    if (rest.startsWith('in.')) return list(rest.slice(3)).includes(String(value))
    throw new Error(`fake PostgREST: unsupported or() item ${item}`)
  }
}

export function createFakeClient(tables) {
  const requests = []
  const client = {
    requests,
    from(table) {
      const state = { table, columns: '*', count: false, head: false, filters: [], embedded: [], orders: [], range: null, embed: null }
      const query = {
        select(columns, options = {}) { state.columns = columns; state.count = options.count === 'exact'; state.head = Boolean(options.head); return query },
        eq(column, value) { return add(column, (v) => v !== null && v === value) },
        neq(column, value) { return add(column, (v) => v !== null && v !== value) },
        not(column, operator, value) {
          if (operator === 'is') return add(column, (v) => (value === null ? v !== null : v !== value))
          if (operator === 'ilike') return add(column, (v) => v !== null && !like(value).test(String(v)))
          throw new Error(`fake PostgREST: unsupported not.${operator}`)
        },
        ilike(column, pattern) { return add(column, (v) => v !== null && like(pattern).test(String(v))) },
        in(column, values) { return add(column, (v) => v !== null && values.includes(v)) },
        or(expression) { const conditions = splitTop(expression).map(conditionFromOr); state.filters.push((row) => conditions.some((condition) => condition(row))); return query },
        order(column, options = {}) { state.orders.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst }); return query },
        range(from, to) { state.range = [from, to]; return query },
        async maybeSingle() { const result = await run(); return { data: result.data?.[0] ?? null, error: result.error } },
        then(resolve, reject) { return run().then(resolve, reject) },
      }
      function add(column, test) {
        if (column.startsWith('commercial_intelligence_queue.')) state.embedded.push({ column: column.slice('commercial_intelligence_queue.'.length), test })
        else state.filters.push((row) => test(read(row, column)))
        return query
      }
      async function run() {
        requests.push({ table, columns: state.columns, range: state.range, orders: state.orders.map((o) => o.column) })
        let rows = tables[table] ?? []
        const items = splitTop(state.columns).map((item) => item.trim())
        const inner = items.some((item) => item.startsWith('commercial_intelligence_queue!inner'))
        for (const filter of state.filters) rows = rows.filter(filter)
        if (inner) {
          rows = rows.filter((row) => (tables.commercial_intelligence_queue ?? []).some((job) => job.lead_id === row.id && state.embedded.every((e) => e.test(read(job, e.column)))))
        }
        const total = rows.length
        const sorted = [...rows]
        const direction = (order, a, b) => {
          const nullsFirst = order.nullsFirst ?? !order.ascending
          if (a === null && b === null) return 0
          if (a === null) return nullsFirst ? -1 : 1
          if (b === null) return nullsFirst ? 1 : -1
          if (a === b) return 0
          return (a < b ? -1 : 1) * (order.ascending ? 1 : -1)
        }
        sorted.sort((x, y) => { for (const order of state.orders) { const r = direction(order, read(x, order.column), read(y, order.column)); if (r) return r } return 0 })
        const window = state.range ? sorted.slice(state.range[0], state.range[1] + 1) : sorted
        const project = (row) => {
          if (state.columns === '*') return { ...row }
          const out = {}
          for (const item of items) {
            if (item.startsWith('commercial_intelligence_queue')) continue
            const aliased = item.includes(':') ? item.split(':') : [item, item]
            out[aliased[0].trim()] = read(row, aliased[1].trim())
          }
          return out
        }
        return { data: state.head ? null : window.map(project), count: state.count ? total : null, error: null }
      }
      return query
    },
  }
  return client
}
