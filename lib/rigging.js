import { createRequire } from 'module'
import { dirname } from 'path'
import join from 'unijoin'
import tty from 'tty'
import { parseArgsStringToArgv as stringArv } from 'string-argv'
import bloomrun from 'bloomrun'
import clif, { Fail, kParsers } from 'clif'
import { executor } from './grapple.js'

// this ensures that CLI output snapshots are the same regardless
// of which OS we test on. This is because libraries like ansi-colors,
// which are used by libraries like enquirer adjust certain characters
// based on operating system. Some way in future to create
// output snapshots for every supported operating system would be ideal
Object.defineProperty(process, 'platform', { value: 'linux' })
process.env.FORCE_HYPERLINK = 1

const grapple = join(dirname(join(import.meta.url)), 'grapple.js')

// eslint-disable-next-line
const ansiRx = /([\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])))/g

export function cmd (testPath, loader) {
  testPath = join(testPath) // normalize to path

  process.setMaxListeners(Infinity) // tap snapshots add lots of event listeners

  return async function harness (command, mocks) {
    return async function cmd (interactions, opts) {
      loader.preventClear()
      const { intercept } = await loader(grapple, mocks)
      const meta = await intercept(dirname(testPath))
      loader.clear()
      loader.preventClear(false)
      let { structure: target } = meta
      const parsers = clif[kParsers]
      const cmdPath = parsers.flags(stringArv(command), target).implicits.positionals
      let cmdLength = 0
      for (const key of cmdPath) {
        if (!(key in target)) break
        target = target[key]
        cmdLength++
      }
      const argv = stringArv(command).slice(cmdLength)
      const { inputs } = parsers.flags(argv, target)

      let matcher = null
      if (interactions instanceof Map) {
        matcher = bloomrun({ indexing: 'depth' })
        for (const [pattern, response] of interactions) matcher.add(pattern, response)
        interactions = []
      }

      interactions = [undefined, ...interactions]

      opts.settings = opts.settings || {}
      opts.inputs = { ...inputs, ...(opts.inputs || {}) }

      const iter = target.default(opts)
      const patterns = []
      try {
        while (true) {
          const inject = interactions.shift()
          const { value, done } = await iter.next(inject)
          if (done) break
          if (value === undefined) continue
          if (value === Error) {
            interactions.unshift(Fail)
          }
          if (matcher) {
            const match = matcher.lookup(value)
            if (match) {
              if (typeof match === 'function') {
                interactions.unshift(await match(value))
              } else interactions.unshift(match)
            }
          }

          patterns.push(value)
        }
      } catch (err) {
        if (err instanceof Fail) {
          patterns.push(err)
        } else {
          throw err
        }
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
  const { FORCE_COLOR, FORCE_HYPERLINK, COLORTERM, CI } = process.env
  testPath = join(testPath) // normalize to file path
  let execPath = null
  let clif = null
  let clifPath = null

  process.setMaxListeners(Infinity) // tap snapshots add lots of event listeners

  return async function harness (command, mocks = {}) {
    const [cmd, ...args] = stringArv(command)
    if (!execPath) {
      const { resolve } = createRequire(testPath)
      clifPath = resolve('clif')
      clif = await import(clifPath)
      execPath = await executor(testPath, cmd)
    }
    const binPath = join(dirname(execPath), 'fake', cmd)

    return async function cli (interactions = [], opts = {}) {
      try {
        const result = {
          exitCode: 0,
          output: Buffer.from('')
        }

        delete process.env.CI
        process.env.COLORTERM = 'truecolor'
        process.env.FORCE_COLOR = 3
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

        let lastWrite = Date.now()

        const interval = setInterval(() => {
          inputs.next()
        }, 25)
        const newline = opts.complex ? '' : '\n'
        const wait = opts.wait || 100
        const inputs = (function * writes () {
          let index = 0
          while (index < interactions.length) {
            if (Date.now() - lastWrite > wait) {
              const input = interactions[index]
              process.stdin.push(input + newline)
              index++
            }
            yield
          }
          clearInterval(interval)
        }())
        process.stdout.write = (s, cb) => {
          result.output = Buffer.concat([result.output, Buffer.from(s)])
          if (cb) process.nextTick(cb)
          lastWrite = Date.now()
          // return stdoutWrite.call(process.stdout, s)
        }

        if (opts.stderr) {
          process.stderr.write = (s, cb) => {
            result.output = Buffer.concat([result.output, Buffer.from(s)])
            if (cb) process.nextTick(cb)
          }
        }

        process.on('exit', (code) => {
          if (code !== 0 && process.stdout.write !== stdoutWrite) {
            const output = result.output.toString().replace(ansiRx, (_, $1) => {
              return JSON.stringify($1).slice(1, -1)
            })
            process.stdout.write = stdoutWrite
            console.log(output.slice(0, 512))
          }
        })

        const { default: entry } = await loader(execPath, mocks)
        await entry

        result.output = JSON.stringify(result.output + '')
        return result
      } catch (err) {
        if (err.code === 'ERR_TIMEOUT') exit(1)
        else throw err
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
        if (COLORTERM !== undefined) process.env.COLORTERM = COLORTERM
        if (CI !== undefined) process.env.CI = CI
      }
    }
  }
}
