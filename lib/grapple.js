import { dirname } from 'path'
import readPkgUp from 'read-pkg-up'
import join from 'unijoin'
import { Fail } from 'clif'

export async function configuration (dir) {
  try {
    return await import(join(dir, 'clif.config.js'))
  } catch {
    return null
  }
}

export async function metadata (startPath = process.cwd()) {
  const { packageJson, path } = await readPkgUp(startPath)
  const dir = dirname(path)
  const { bin, name, main = 'index.js' } = packageJson
  const { commands } = await import(join(dir, main))
  const config = await configuration(dir)
  const type = commands ? 'cmd' : 'cli'
  if (commands) {
    return { type, commands, packageJson, path, dir, name, config }
  }

  if (bin === undefined) {
    throw new Fail('clif-dev executed in working directory that does not seem to be clif project (no bin field in package.json)')
  }
  const binName = (typeof bin === 'string') ? name.split('/').pop() : Object.keys(bin).shift()
  const entry = (typeof bin === 'string') ? join(dir, bin) : join(dir, bin[binName])
  return { type, packageJson, path, dir, bin, binName, entry, name, config }
}

export async function executor (startPath = process.cwd(), cmd) {
  const { bin, entry, dir } = await metadata(startPath)
  if (cmd) return join(dir, bin[cmd])
  return entry
}

export async function intercept (startPath) {
  process.env.CLIF_META_MODE = 1
  const { type, commands, entry } = await metadata(startPath)
  if (commands) {
    const { default: clif } = await import('clif')
    const meta = await clif({ structure: commands })
    delete process.env.CLIF_META_MODE
    meta.type = type
    return meta
  }
  const { default: cmd } = await import(entry)
  const meta = await cmd
  if (!meta || !meta.structure) {
    throw new Fail('clif-dev executed in working directory that does not seem to be clif project (unable to intercept)')
  }
  delete process.env.CLIF_META_MODE
  meta.type = type
  return meta
}
