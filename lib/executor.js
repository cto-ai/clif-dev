import { dirname } from 'path'
import readPkgUp from 'read-pkg-up'
import join from 'unijoin'

export default async function (startPath = process.cwd(), cmd) {
  const { packageJson, path } = await readPkgUp(startPath)
  const { bin } = packageJson
  if (typeof bin === 'string') return join(dirname(path), bin)
  else if (cmd) return join(dirname(path), bin[cmd])
  return join(dirname(path), bin[Object.keys(bin).shift()])
}
