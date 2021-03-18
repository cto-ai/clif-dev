export const file = `import { rigging } from 'clif-dev'
import { test, mockalicious } from 'tapx'
const common = { settings: {}. mocks: {} }
const harness = rigging.cmd(import.meta.url, mockalicious(import.meta.url))

__tests__
`

export const test = `
test('__command__', async ({ matchSnapshot }) => {
  const mocks = { ...common.mocks }
  const cmd = await harness('__command__', mocks)
  const interactions = new Map()
  const opts = { settings: { ...common.settings } }
  const patterns = await cmd(interactions, opts)
  matchSnapshot(patterns)
})
`
