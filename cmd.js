#!/usr/bin/env node
import clif from 'clif'
import Parser from 'tap-parser'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { on } from 'events'
import { diffChars } from 'diff'
import executor from './lib/executor.js'
import intercept from './lib/intercept.js'
import * as tmpl from './templates/index.js'

const help = promisify(({ entry, command }, cb) => {
  const args = command.split(' ').slice(1).join(' ')
  exec(`${process.execPath} ${entry} ${args} --help`, { env: {} }, (err, stdout, stderr) => {
    if (err) return cb(err)
    cb(null, stdout.toString().trim())
  })
})

const strike = (s) => `\u001b[9m${s}\u001b[29m`
const inverse = (s) => `\u001b[7m${s}\u001b[27m`

function render (str, locals) {
  for (const [match, key] of str.matchAll(/__([a-zA-Z/\\.]*?)__/g)) {
    str = str.replace(new RegExp(match, 'g'), locals[key])
  }
  return str
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

async function * patterns () {
  // const { patterns } = await intercept()
}

async function * docs () {
  const { structure } = await intercept()
  const entry = await executor()
  const bin = 'ops' // TODO GET THIS PROGRAMATICALLY
  const name = '@cto.ai/ops' // TODO GET THIS PROGRAMATICALLY
  const description = structure.$.describe
  const info = [...traverse({ bin, structure })].sort(([a], [b]) => a.localeCompare(b))
  const toc = []
  const commands = []
  for (const [command, meta] of info) {
    const link = `#${command.split(' ').join('-')}`
    toc.push(render(tmpl.docs.tocItem, { command, link }))
    commands.push(render(tmpl.docs.command, { command, tag: meta.describe, help: await help({ entry, command }) }))
  }

  const result = render(tmpl.docs.readme, {
    bin, name, description, docs: render(tmpl.docs.docs, { toc: toc.join(''), commands: commands.join('') })
  })

  process.stdout.write(result)
}

async function * tests () {
  // const { structure } = await intercept()
}

async function * diff ({ argv }) {
  const [cmd, ...args] = argv
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
    positionals: ['[dir=cwd]'],
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
      default: tests
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
    await clif({ structure, settings })
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

cli()
