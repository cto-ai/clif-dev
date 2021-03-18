import { createRequire } from 'module'
import { dirname } from 'path'
import { once } from 'events'
import join from 'unijoin'
import tty from 'tty'
import minimist from 'minimist'
import { parseArgsStringToArgv as stringArv } from 'string-argv'
import bloomrun from 'bloomrun'
import { Fail, kParsingConfig } from 'clif'
import { executor } from './grapple.js'

const grapple = join(dirname(join(import.meta.url)), 'grapple.js')

export function cmd (testPath, loader) {
  testPath = join(testPath) // normalize to path

  process.setMaxListeners(Infinity) // tap snapshots add lots of event listeners

  return async function harness (command, mocks) {
    
    const { _: cmdPath } = minimist(stringArv(command))
    
    return async function cmd (interactions, opts) {
      loader.preventClear()
      const { intercept } = await loader(grapple, mocks)
      const meta = await intercept(testPath)
      loader.clear()
      loader.preventClear(false)
    
      let { structure: target } = meta

      const parsingConfig = target[kParsingConfig]

      for (const key of cmdPath) target = target[key]

      const { _, ...inputs} = minimist(stringArv(command), parsingConfig(target))

      let matcher = null
      if (interactions instanceof Map) {
        matcher = bloomrun({indexing: 'depth'})
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
          if (value === Error) interactions.unshift(Fail)
          if (matcher) {
            const match = matcher.lookup(value)
            if (match) interactions.unshift(match)
          }
          if (done) break
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
  const { FORCE_COLOR, FORCE_HYPERLINK } = process.env
  testPath = join(testPath) // normalize to file path
  let execPath = null
  let clif = null
  let clifPath = null

  process.setMaxListeners(Infinity) // tap snapshots add lots of event listeners

  return async function harness (command, mocks = {}) {
    const [cmd, ...args] = command.split(' ')
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

        let lastWrite = Date.now()

        let interval = setInterval(() => {
          inputs.next()
        }, 25)

        const inputs = (function * writes () {
          let index = 0
          while (index < interactions.length) {
            if (Date.now() - lastWrite > 100) {
              const input = interactions[index]
              process.stdin.push(input + '\n')
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
        }

        if (opts.stderr) {
          process.stderr.write = (s, cb) => {
            result.output = Buffer.concat([result.output, Buffer.from(s)])
            if (cb) process.nextTick(cb)
          }
        }
        const { default: entry } = await loader(execPath, mocks)
        
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
