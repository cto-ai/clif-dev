import { createRequire } from 'module'
import { dirname } from 'path'
import join from 'unijoin'
import tty from 'tty'
import findExecutor from './executor.js'

const loadLib = join(import.meta.url, '..', 'load.js')

export function cmd (structure, loader) {
  return async function harness (dotPath, mocks) {
    if (typeof structure === 'string') {
      const load = await loader(loadLib, mocks)
      structure = await load.structure(structure)
    }
    let target = structure
    for (const key of dotPath.split('.')) target = target[key]
    return async function cmd (interactions, opts) {
      interactions = [...interactions]
      opts.settings = opts.settings || {}
      opts.inputs = opts.inputs || {}
      const iter = target.default(opts)
      const patterns = []
      while (true) {
        const { value, done } = await iter.next(interactions.shift())
        if (done) break
        patterns.push(value)
      }
      return patterns
    }
  }
}

export function cli (testPath, loader) {
  const argv = [...process.argv]
  const { write: stdoutWrite, isTTY: stdoutIsTty } = process.stdout
  const { write: stderrWrite, isTTY: stderrIsTty } = process.stderr
  const { exit } = process
  const { FORCE_COLOR, FORCE_HYPERLINK } = process.env
  testPath = join(testPath) // normalize to file path
  let executor = null
  let clif = null
  let clifPath = null
  return async function harness (command, mocks = {}) {
    const [cmd, ...args] = command.split(' ')
    if (!executor) {
      const { resolve } = createRequire(testPath)
      clifPath = resolve('clif')
      clif = await import(clifPath)
      executor = await findExecutor(testPath, cmd)
    }
    const binPath = join(dirname(executor), 'fake', cmd)

    return async function cli (interactions = [], opts = {}) {
      try {
        const result = {
          exitCode: 0,
          output: Buffer.from('')
        }

        process.env.FORCE_COLOR = 1
        process.env.FORCE_HYPERLINK = 1

        mocks.clif = {
          ...clif,
          async default (options, argv) {
            if (opts.settings) options.settings = opts.settings
            return await clif.default(options, argv)
          }
        }

        mocks.tty = {
          ...tty,
          isatty () { return true },
          ...(mocks.tty || {})
        }
        process.stdout.isTTY = true
        process.stderr.isTTY = true

        process.argv = [process.argv0, binPath, ...args]
        process.exit = (code) => { result.exitCode = code }

        for (const input of interactions) process.stdin.push(input + '\n')

        process.stdout.write = (s) => {
          result.output = Buffer.concat([result.output, Buffer.from(s)])
        }

        if (opts.stderr) {
          process.stderr.write = (s) => {
            result.output = Buffer.concat([result.output, Buffer.from(s)])
          }
        }

        const { default: entry } = await loader(executor, mocks)
        await entry
        result.output = JSON.stringify(result.output + '')
        return result
      } finally {
        mocks.clif = null
        process.stdout.write = stdoutWrite
        process.stderr.write = stderrWrite
        process.exit = exit
        process.argv = argv
        process.stdout.isTTY = stdoutIsTty
        process.stderr.isTTY = stderrIsTty

        if (FORCE_COLOR !== undefined) process.env.FORCE_COLOR = FORCE_COLOR
        if (FORCE_HYPERLINK !== undefined) process.env.FORCE_HYPERLINK = FORCE_HYPERLINK
      }
    }
  }
}
