// A small JSON Schema validator covering the keywords the config schema uses:
// type, const, enum, pattern, minLength, minimum, minItems, properties,
// required, additionalProperties, items, oneOf and local $ref. Returns a list
// of "path: problem" strings; an empty list means valid.
const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v

function matchesType(value, type) {
  if (type === 'integer') return Number.isInteger(value)
  return typeOf(value) === type
}

export function validate(schema, value, root = schema, path = '$') {
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((node, key) => node?.[key], root)
    if (!target) return [ `${path}: unknown $ref ${schema.$ref}` ]
    return validate(target, value, root, path)
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((option) => validate(option, value, root, path).length === 0)
    if (passing.length === 1) return []
    if (passing.length === 0) {
      const errors = schema.oneOf.map((option) => validate(option, value, root, path))
      return errors.reduce((best, e) => (e.length < best.length ? e : best))
    }
    return [ `${path}: matches more than one allowed shape` ]
  }
  const errors = []
  if (schema.type !== undefined) {
    const types = [ schema.type ].flat()
    if (!types.some((t) => matchesType(value, t))) return [ `${path}: expected ${types.join(' or ')}, got ${typeOf(value)}` ]
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: must be ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: must not be empty`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: must match ${schema.pattern}`)
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}`)
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`)
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)))
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: missing ${key}`)
    for (const [ key, item ] of Object.entries(value)) {
      const sub = schema.properties?.[key]
      if (sub) errors.push(...validate(sub, item, root, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown key ${key}`)
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, item, root, `${path}.${key}`))
    }
  }
  return errors
}
