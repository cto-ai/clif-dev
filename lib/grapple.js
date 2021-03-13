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
  const { bin, name } = packageJson
  if (bin === undefined) {
    throw new Fail('clif-dev executed in working directory that does not seem to be clif project (no bin field in package.json)')
  }
  const dir = dirname(path)
  const config = await configuration(dir)
  const binName = (typeof bin === 'string') ? name.split('/').pop() : Object.keys(bin).shift()
  const entry = (typeof bin === 'string') ? join(dir, bin) : join(dir, bin[binName])
  return { packageJson, path, dir, bin, binName, entry, name, config }
}

export async function executor (startPath = process.cwd(), cmd) {
  const { bin, entry, dir } = await metadata(startPath)
  if (cmd) return join(dir, bin[cmd])
  return entry
}

export async function intercept () {
  process.env.CLIF_META_MODE = 1
  const { default: cmd } = await import(await executor())
  const meta = await cmd
  if (!meta || !meta.structure) {
    throw new Fail('clif-dev executed in working directory that does not seem to be clif project (unable to intercept)')
  }
  delete process.env.CLIF_META_MODE
  return meta
}
