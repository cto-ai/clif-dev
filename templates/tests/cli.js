export const file = `import { rigging } from 'clif-dev'
import { test, mockalicious } from 'tapx'

const harness = rigging.cli(import.meta.url, mockalicious(import.meta.url))

const common = {
  mocks: {},
  settings: {}
}
__tests__
`

export const test = `
test('__command__', async ({ is, matchSnapshot }) => {
  const mocks = {
    ...common.mocks
  }
  const cli = await harness('__command__', mocks)
  const interactions = []
  const opts = { settings: { ...common.settings } }
  const { exitCode, output } = await cli(interactions, opts)
  is(exitCode, 0)
  matchSnapshot(output)
})
`
