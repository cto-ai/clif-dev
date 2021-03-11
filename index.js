export function todo (type, input) {
  console.log(`\u001b[32mTODO\u001b[0m (${type}): `, input)
}

export * as rigging from './lib/rigging.js'
