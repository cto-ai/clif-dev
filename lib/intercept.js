import executor from './executor.js'

export default async function intercept () {
  process.env.CLIF_META_MODE = 1
  const { default: cmd } = await import(await executor())
  const meta = await cmd
  delete process.env.CLIF_META_MODE
  return meta
}
