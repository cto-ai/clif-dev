#!/usr/bin/env node
import { spawn, exec } from 'child_process'
import { promisify, inspect } from 'util'
import { on, once } from 'events'
import { join } from 'path'
import { createWriteStream } from 'fs'
import clif, { Fail } from 'clif'
import Parser from 'tap-parser'
import { diffChars } from 'diff'
import prostamp from 'prostamp'
import { intercept, metadata } from './lib/grapple.js'
import * as templates from './templates/index.js'

const help = promisify(({ entry, command }, cb) => {
  const args = command.split(' ').slice(1).join(' ')
  exec(`${process.execPath} ${entry} ${args} --help`, { env: {} }, (err, stdout, stderr) => {
    if (err) return cb(err)
    cb(null, stdout.toString().trim())
  })
})

const strike = (s) => `\u001b[9m${s}\u001b[29m`
const inverse = (s) => `\u001b[7m${s}\u001b[27m`

function powerset (array, offset = 0) {
  function * powerset (array, offset = 0) {
    while (offset < array.length) {
      const first = array[offset++]
      for (let subset of powerset(array, offset)) {
        subset = subset || []
        subset.push(first)
        yield subset
      }
    }
    yield
  }
  return [...powerset(array, offset)].filter(Boolean)
}

function * traverse ({ bin, structure, parents = [] }) {
  for (const [command, meta] of Object.entries(structure)) {
    if (command === '$') continue
    if (meta.default) {
      yield [[bin, ...parents, command].join(' '), meta]
      continue
    }
    yield * traverse({ bin, structure: meta, parents: [...parents, command] })
  }
}

async function * patterns ({ inputs }) {
  let { patterns } = await intercept()
  const { name } = await metadata()
  if (inputs.ns) patterns = patterns.filter(([{ ns }]) => ns === inputs.ns)
  if (patterns.length === 0) return
  let curNs = patterns[0][0].ns
  console.log(`\n\u001b[1m${name} – \u001b[3mpatterns\u001b[0m\n`)
  if (curNs) console.log(`\u001b[1m -> \u001b[32m${curNs}\u001b[0m`)
  for (const [pattern, fn] of patterns) {
    if (pattern.ns && curNs !== pattern.ns) {
      curNs = pattern.ns
      console.log(`\n\u001b[1m -> \u001b[32m${curNs}\u001b[0m`)
    }
    if (pattern instanceof Error) delete pattern.stack
    let parsed = /\(.+\)\s*(=>)?\s*{/.exec(fn) || /\(\)\s*(=>)?\s*{/.exec(fn) || ''
    if (parsed) parsed = `\u001b[36m${parsed[0].replace(/\s*(=>)?\s*{$/, '')}\u001b[0m`
    console.log(`  ${inspect(pattern, { colors: true })}\n    \u001b[3m${inspect(fn)} ${parsed}\u001b[0m\n`)
  }
}

async function * docs () {
  const { structure } = await intercept()
  const { entry, binName: bin, name, config } = await metadata()
  const description = structure.$.describe
  const info = [...traverse({ bin, structure })].sort(([a], [b]) => a.localeCompare(b))
  const toc = []
  const commands = []
  const tmpl = config && config.docs ? { ...templates.docs, ...config.docs } : templates.docs

  for (const [command, meta] of info) {
    const link = `#${command.split(' ').join('-')}`
    toc.push(prostamp(tmpl.tocItem, { command, link }))
    commands.push(prostamp(tmpl.command, { command, tag: meta.describe, help: help({ entry, command }) }))
  }

  const result = prostamp(tmpl.readme, {
    bin, name, description, docs: prostamp(tmpl.docs, { toc, commands })
  })

  for await (const output of result) process.stdout.write(output)
}

async function * tests ({ inputs, implicits }) {
  const { type = 'cli' } = inputs
  const { structure } = await intercept()
  const { binName: bin, config, dir } = await metadata()
  const info = [...traverse({ bin, structure })].sort(([a], [b]) => a.localeCompare(b))
  const tmpl = config && config.tests ? { ...templates.tests, ...config.tests } : templates.tests

  const commands = info.sort(([a], [b]) => a.localeCompare(b)).reduce((result, [command, meta]) => {
    // TODO positionals - optional and required

    const flags = Object.entries(meta)
      .filter(([k]) => k[0] === '$')
      .map(([k, v]) => [k.slice(1), v])
      .map(([k, { type, alias }]) => {
        const dash = (k.length > 1) ? '--' : '-'
        const aliases = [alias].flat().map((alias) => {
          const dash = (alias.length > 1) ? '--' : '-'
          return (type === 'boolean' ? `${dash}${alias}` : `${dash}${alias}="VALUE"`)
        })
        const name = (type === 'boolean' ? `${dash}${k}` : `${dash}${k}="VALUE"`)
        return { name, aliases }
      })

    result.push(command)

    for (const combo of powerset(flags)) {
      result.push(`${command} ${combo.map(({ name }) => name).join(' ')}`)
      const longest = combo.map(({ aliases }) => aliases.length).sort((a, b) => b - a).shift()
      const matrix = combo.map(({ aliases }, ix) => {
        if (aliases.length < longest) {
          aliases.push(...Array.from({ length: longest - aliases.length }).map(() => combo[ix].name))
        }
        return aliases
      })
      let pos = 0
      while (pos < longest) {
        result.push(`${command} ${matrix.map((aliases) => aliases[pos]).join(' ')}`)
        pos++
      }
    }

    return result
  }, [])
  const testTmpl = type === 'cli' ? tmpl.cliTest : tmpl.cmdTest

  if (implicits.positionals.length === 0) {
    const tests = {}

    for (const command of commands) {
      const [, top] = command.split(' ')
      tests[top] = tests[top] || []
      tests[top].push(prostamp(testTmpl, { command }))
    }

    for (const top of Object.keys(tests)) {
      try {
        const file = createWriteStream(join(dir, 'test', `${top}.test.js`), { flags: 'wx' })
        await once(file, 'open')
        const result = prostamp(tmpl.file, { tests: tests[top] })
        for await (const output of result) file.write(output)
      } catch (err) {
        const { code } = err
        if (code === 'ENOENT') throw Error('test folder not found')
        if (code === 'EEXIST') console.error(`Refusing to overwrite test/${top}.test.js`)
        else throw err
      }
    }
  } else {
    const tests = []
    const cmd = implicits.positionals.filter(([f]) => f !== '-')
    if (implicits.positionals[0] !== bin) cmd.unshift(bin)
    const matcher = RegExp(cmd.join(' '))
    for (const command of commands) {
      if (matcher.test(command) === false) continue
      tests.push(prostamp(testTmpl, { command }))
    }
    const result = prostamp(cmd.length === 2 ? tmpl.file : '__tests__', { tests })
    for await (const output of result) process.stdout.write(output)
  }
}

async function * diff ({ argv }) {
  const [cmd, ...args] = argv
  if (!cmd) throw new Fail('Missing command. clif-dev diff <cmd...> (e.g. cliv-def diff npm test)')
  const sp = spawn(cmd, args, { env: { ...process.env, TAP: 1 }, stdio: ['inherit', 'pipe', 'inherit'] })
  const parser = new Parser()

  sp.stdout.pipe(parser)

  for await (const results of on(parser, 'result')) {
    for (const result of results) {
      if (result.ok) continue
      const [,,, a, b] = result.diag.diff.split('\n')
      const changes = diffChars(JSON.parse(a.slice(1)), JSON.parse(b.slice(1)))
      result.diag.diff = ''
      for (let { added, removed, value } of changes) {
        if (/^\u001b.+m$/.test(value)) { // eslint-disable-line
          value += '§' + (removed ? '\u001b[0m' : '')
        }
        result.diag.diff += added ? inverse(value) : (removed ? strike(value) : value)
      }
      result.diag.diff += '\u001b[0m'
      console.log()
      console.log(strike('                                  '))
      console.log(`\u001b[3m${result.fullname}: ${result.name}\u001b[0m`)
      console.log(`\u001b[3m${result.diag.at.file}:${result.diag.at.line}:${result.diag.at.column}\u001b[0m`)
      console.log(strike('                                  '))
      console.log(result.diag.diff)
    }
  }
}

const structure = {
  $: {
    describe: '👾 clif developer tool'
  },
  patterns: {
    describe: 'Output available patterns',
    positionals: ['[ns]'],
    default: patterns
  },
  render: {
    $: {
      describe: 'Generate artifacts'
    },
    docs: {
      describe: 'Generate markdown docs',
      default: docs
    },
    tests: {
      describe: 'Generate command test skeletons',
      default: tests,
      $type: {
        describe: 'Type of tests: cmd, cli',
        alias: 't',
        type: 'string'
      }
    }
  },
  diff: {
    describe: 'View a snapshot diff as terminal output',
    default: diff
  }
}

export default async function cli () {
  try {
    const settings = {}
    const patterns = [
      [new Fail(), ({ message }) => console.error('⛔️', message)]
    ]
    await clif({ structure, settings, patterns })
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

cli()
