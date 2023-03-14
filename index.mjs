#!/usr/bin/env node

/**
 * before using this, you need to install the ff dependencies, use one of commands below
 *   "conf": "^11.0.1", "inquirer": "^9.1.4", "mocha": "^10.2.0", "table": "^6.8.1", "uuid": "^9.0.0"
 *
 * $ npm install chalk conf inquirer mocha table uuid
 * $ pnpm add chalk conf inquirer mocha table uuid
 *
 * execute this script using node
 * $ node parallel.mjs
 *
 * Having problems? Message me
 * Maintainer: Krizzchanne Cid <kcid@cambridge.org>
 *
 * TODOs:
 *  - Test using windows machine (compatibility)
 **/

import Conf from 'conf'
import chalk from 'chalk'
import inquirer from 'inquirer'
import open from 'open'
import { table } from 'table'
import { globSync } from 'glob'
import { parallelLimit } from 'async'
import { v4 as uuidv4 } from 'uuid'

import { spawn } from 'node:child_process'
// import { fileURLToPath } from 'url'
import { resolve, basename } from 'path'
import { writeFileSync, readdirSync, existsSync } from 'node:fs'
import { readFileSync, rmSync, renameSync, mkdirSync } from 'node:fs'

import PressToContinuePrompt from 'inquirer-press-to-continue'
inquirer.registerPrompt('press-to-continue', PressToContinuePrompt)

// __dirname is not working (used for fetching specs):
// https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c#what-do-i-use-instead-of-__dirname-and-__filename
// const __filename = fileURLToPath(import.meta.url)
// const __dirname = dirname(__filename)
const __dirname = process.cwd()

const packagejson = JSON.parse(readFileSync(resolve(__dirname, 'package.json')))
// sometimes package.json does not have a name, use folder name
const packagejsonname = packagejson?.name || basename(__dirname)

// default and global variables
const DEFAULT_CYPRESS_DIR = 'cypress'
const DEFAULT_SPECS_DIR = 'e2e'
const DEFAULT_SPECS = [DEFAULT_SPECS_DIR]
const DEFAULT_BROWSERS = ['electron']
const DEFAULT_PARALLEL = 5
const MAX_PARALLEL_ALLOWED = 20
const DEFAULT_REPORTER = 'parallel-cli-reporter.js'
const DEFAULT_REPORTER_DIR = 'parallel-cli-results'
const DEFAULT_REPORTER_DIR_PATH = resolve(__dirname, DEFAULT_REPORTER_DIR)
// variables for conf, we do not want to fetch it everytime
let PRESET, PRESETS, RECORDKEY, SPECS, ENVVARS, BROWSERS, PARALLEL, DASHBOARD

// configuration of conf storage for parallel cli settings
const config = new Conf({
  projectName: packagejsonname,
  schema: {
    preset: { type: 'string' },
    presets: {
      type: 'array',
      items: [{ type: 'object' }],
      minItems: 0,
    },
    recordkey: { type: 'string' },
    // TODO: strict mode: "items" is 1-tuple, but minItems or maxItems/additionalItems are not specified or different at path "#/properties/specs"
    specs: {
      type: 'array',
      items: [{ type: 'string' }],
      default: DEFAULT_SPECS,
      minItems: 1,
    },
    envvars: { type: 'string' },
    browsers: {
      type: 'array',
      items: [{ type: 'string' }],
      default: DEFAULT_BROWSERS,
      minItems: 1,
    },
    parallel: { type: 'number', default: 5 },
    dashboard: { type: 'string' },
    init: { type: 'boolean', default: false },
  },
})

// set config variables
const setvars = () => {
  // use default values if config is not found
  PRESET = config.get('preset')
  PRESETS = config.get('presets') || []
  DASHBOARD = config.get('dashboard')
  RECORDKEY = config.get('recordkey')
  SPECS = config.get('specs') || DEFAULT_SPECS
  ENVVARS = config.get('envvars')
  BROWSERS = config.get('browsers') || DEFAULT_BROWSERS
  PARALLEL = config.get('parallel') || DEFAULT_PARALLEL
}

// reset cli config
const resetvars = () => {
  config.delete('preset')
  config.delete('presets')
  config.delete('recordkey')
  config.delete('envvars')
  config.delete('dashboard')

  config.set('specs', DEFAULT_SPECS)
  config.set('browsers', DEFAULT_BROWSERS)
  config.set('parallel', DEFAULT_PARALLEL)
  setvars()
}

const loadpreset = () => {
  if (!PRESET) return
  // load presets if available
  const preset = PRESETS.find((p) => p.name === PRESET)
  if (preset) {
    RECORDKEY = preset.recordkey
    SPECS = preset.specs || DEFAULT_SPECS
    ENVVARS = preset.envvars
    BROWSERS = preset.browsers || DEFAULT_BROWSERS
    PARALLEL = preset.parallel || DEFAULT_PARALLEL
  }
}

// clear cli then display banner
const resetcli = () => {
  console.clear()
  console.log(chalk.greenBright(generatebanner()))
}

// ASCII Art from: https://patorjk.com/software/taag/#p=display&h=1&v=2&f=Big%20Money-ne&t=parallel%20cli
const generatebanner = () => {
  return `
                                          /$$ /$$           /$$                 /$$ /$$
                                         | $$| $$          | $$                | $$|__/
    /$$$$$$   /$$$$$$   /$$$$$$  /$$$$$$ | $$| $$  /$$$$$$ | $$        /$$$$$$$| $$ /$$
   /$$__  $$ |____  $$ /$$__  $$|____  $$| $$| $$ /$$__  $$| $$       /$$_____/| $$| $$
  | $$  \\ $$  /$$$$$$$| $$  \\__/ /$$$$$$$| $$| $$| $$$$$$$$| $$      | $$      | $$| $$
  | $$  | $$ /$$__  $$| $$      /$$__  $$| $$| $$| $$_____/| $$      | $$      | $$| $$
  | $$$$$$$/|  $$$$$$$| $$     |  $$$$$$$| $$| $$|  $$$$$$$| $$      |  $$$$$$$| $$| $$
  | $$____/  \\_______/|__/      \\_______/|__/|__/ \\_______/|__/       \\_______/|__/|__/
  | $$   -- parallel cli settings -- RECORDKEY: ${RECORDKEY || '<not set>'} --
  | $$   -- SPECS: ${SPECS} -- ENV: ${ENVVARS || '<not set>'} --
  | $$   -- BROWSERS: ${BROWSERS.join(',')} -- PARALLEL: ${PARALLEL} --
  |__/   -- LATEST DASHBOARD RESULT: ${DASHBOARD || '<not set>'} --`
}

// from the name itself, it gets the directories from provided path
// TODO: refactor this using glob lib
const getdirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)

// delay timer using async
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// threads for running parallel tests: https://github.com/tnicola/cypress-parallel/blob/master/lib/thread.js
const runnerthread = async (command, index) => {
  // from original cypress-parallel implementation. but i do not think we have xvfb in our machine or do we?
  // staggered start (when executed in container with xvfb ends up having a race condition causing intermittent failures)
  await sleep(index * 2000)

  const timeMap = new Map()

  const promise = new Promise((resolve) => {
    const child = spawn('npx', [command], {
      cwd: process.cwd(),
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        // those colored texts makes the cli pretty
        FORCE_COLOR: true,
      },
    })

    const logs = []
    child.stdout.on('data', (data) => {
      const datastring = data.toString()
      console.log(datastring)
      // store logs for later processing
      logs.push(datastring)
    })

    child.on('exit', () => {
      // find cypress dashboard link and store at conf.dashboard
      // this will happen multiple times, overwriting from one run and another, should be ok
      const regex = /https:\/\/cloud.cypress.io\/projects\/\w+\/runs\/\d+/gi
      const recordedrun = logs
        .flat()
        .filter((x) => regex.test(x))
        .pop()

      if (recordedrun) {
        const matches = recordedrun.match(regex)
        config.set('dashboard', matches.pop())
        setvars()
      }

      // we do not really have a use for this timemap, but leaving it as it is
      resolve(timeMap)
    })
  })

  return promise
}

const runtest = async () => {
  // remove existing dashboard results
  config.delete('dashboard')
  DASHBOARD = ''

  // cleanup results directory by FORCE! nobody survives!
  if (existsSync(DEFAULT_REPORTER_DIR_PATH)) {
    for (const file of readdirSync(DEFAULT_REPORTER_DIR_PATH)) {
      rmSync(resolve(DEFAULT_REPORTER_DIR_PATH, file), { recursive: true, force: true })
    }
  }

  // generate uuid to be used as ci-build-id
  // https://docs.cypress.io/guides/guides/parallelization#Linking-CI-machines-for-parallelization-or-grouping
  const uuid = uuidv4()

  const suites = SPECS.map((suite) => `${DEFAULT_CYPRESS_DIR}/${suite}`)
  // cypress run command builder
  // TODO: find improvements. current threads/parallel runs per browser
  // TODO: listing spec files by folder, folder selection and greptags selection
  for (const browser of BROWSERS) {
    let command = `npx cypress run`
    if (ENVVARS) command = command.concat(` --env ${ENVVARS}`)
    command = command.concat(` --browser ${browser}`)
    // using --headed runs for debugging purposes, maybe allow configuration?
    // command = command.concat(` --headed`)
    command = command.concat(` --reporter ./${DEFAULT_REPORTER}`)

    if (RECORDKEY) {
      command = command.concat(` --spec ${suites.join(',')}`)
      command = command.concat(` --group ${browser} --record --key ${RECORDKEY}`)
      command = command.concat(` --parallel --ci-build-id ${uuid}`)

      if (PRESET) command = command.concat(` --tag parallel-cli,${PRESET}`)

      console.log(`${chalk.bold.greenBright(`Running command: `)}${chalk.whiteBright(command)}`)

      // run array of threads limited by parallel count
      // cypress dashboard will handle parallellization of tests
      await Promise.all(
        Array(PARALLEL)
          .fill(undefined)
          .map((_, index) => runnerthread(command, index))
      )
    } else {
      const specs = [
        ...new Set(
          suites
            .map((suite) =>
              globSync(`${resolve(__dirname, suite)}/**/*.cy.{ts,js}`, { withFileTypes: true })
                .filter((path) => path.isFile())
                .map((file) => file.fullpath())
            )
            .flat()
        ),
      ]

      if (specs.length === 0) console.log(chalk.bold.redBright('No specs found on selected suites'))

      await parallelLimit(
        // use set to filter out redundant specs
        specs.map((spec, index) => {
          return (callback) => {
            const finalcommand = command.concat(` --spec ${spec}`)
            console.log(
              `${chalk.bold.greenBright(`[${index + 1}/${specs.length}] Running command: `)}${chalk.whiteBright(
                finalcommand
              )}`
            )
            runnerthread(finalcommand, index).then(() => callback(null))
          }
        }),
        PARALLEL
      )
    }

    // move results to browser specific results folder
    if (existsSync(DEFAULT_REPORTER_DIR_PATH)) {
      for (const dirent of readdirSync(DEFAULT_REPORTER_DIR_PATH, { withFileTypes: true })) {
        if (dirent.isDirectory()) continue
        const browserdir = resolve(DEFAULT_REPORTER_DIR_PATH, browser)
        existsSync(browserdir) || mkdirSync(browserdir)
        renameSync(resolve(DEFAULT_REPORTER_DIR_PATH, dirent.name), resolve(browserdir, dirent.name))
      }
    }
  }
}

const askexit2menu = async () => {
  inquirer
    .prompt({
      name: 'mainmenu',
      type: 'press-to-continue',
      anyKey: true,
      pressToContinueMessage: 'Press any key to return to main menu ...',
    })
    .then(() => {
      menuprompt()
    })
}

const addnewpreset = (presetname) => {
  PRESETS = [
    ...PRESETS,
    {
      name: presetname,
      recordkey: RECORDKEY,
      specs: SPECS,
      envvars: ENVVARS,
      browsers: BROWSERS,
      parallel: PARALLEL,
    },
  ]
  PRESET = presetname
  config.set('preset', PRESET)
  config.set('presets', PRESETS)
}

const showcliresultstable = () => {
  const spanningcells = []

  // results are grouped by browser. extract results from each browser folder, results are stored in JSON
  let tabledata = getdirectories(DEFAULT_REPORTER_DIR_PATH).map((dir) => {
    const totals = { tests: 0, passes: 0, failures: 0, duration: 0 }
    const results = readdirSync(resolve(DEFAULT_REPORTER_DIR_PATH, dir))
      // we are using readFileSync here because require(jsonfile) does not work in .mjs, anyway it works the same
      .map((file) => JSON.parse(readFileSync(resolve(DEFAULT_REPORTER_DIR_PATH, dir, file))))
      .reduce((a, c) => {
        a.push([dir, c.file, c.start, c.tests, c.passes, c.failures, c.duration])
        // increment our totals counter (for tallying data)
        totals.tests += c.tests
        totals.passes += c.passes
        totals.failures += c.failures
        totals.duration += c.duration
        return a
      }, [])

    return [...results, ['Totals', '', '', totals.tests, totals.passes, totals.failures, totals.duration]]
  })

  // to hard to explain but spanning cells are needed to group repeated cells
  // https://www.npmjs.com/package/table#user-content-configspanningcells
  for (const group of tabledata) {
    // tldr; added some magical calculations in generating spanning cells
    const lastspanningcell = spanningcells[spanningcells.length - 1]
    const lastrow = lastspanningcell ? lastspanningcell.row + 1 : 1
    // spanning cell for browser group, spans the length of results
    spanningcells.push({
      col: 0,
      row: lastrow,
      rowSpan: group.length - 1,
      verticalAlignment: 'middle',
    })
    // spanning cell for totals, covers 3 columns, always the row from browser group
    spanningcells.push({
      col: 0,
      row: lastrow + group.length - 1,
      colSpan: 3,
      alignment: 'center',
    })
  }

  // flatten table data to combine grouped results
  tabledata = tabledata.flat()

  // colorize table data
  tabledata = tabledata.map((x) => [
    chalk.bold.cyanBright(x[0]),
    chalk.bold.whiteBright(x[1]),
    x[2],
    chalk.cyanBright(x[3]),
    chalk.greenBright(x[4]),
    chalk.redBright(x[5]),
    chalk.yellowBright(x[6]),
  ])

  // add table headers
  tabledata.unshift(
    ['Browser', 'Spec', 'Date', 'Tests', 'Passed', 'Failed', 'Duration'].map((x) => chalk.bold.greenBright(x))
  )

  /**
   * "tabledata" should look like this (without the gibberish coloring), real data log from canvas project
   * so yes, stop wondering how this "tabledata" looks like before it is displayed beautifully
   * [
   *  ['Browser','Spec','Date','Tests','Passed','Failed','Duration'],
   *  ["chrome","cypress/e2e/canvas-regression/buttons.cy.ts","2023-02-20T18:05:02.707Z",3,3,0,66959],
   *  ["chrome","cypress/e2e/canvas-regression/sidebar.cy.ts","2023-02-20T18:05:09.745Z",1,1,0,13391],
   *  ["Totals", "", "", 4, 4, 0, 80350],
   *  ["electron","cypress/e2e/canvas-regression/buttons.cy.ts","2023-02-20T18:02:30.555Z",3,3,0,78557],
   *  ["electron","cypress/e2e/canvas-regression/sidebar.cy.ts","2023-02-20T18:02:29.624Z",1,1,0,16392],
   *  ["Totals", "", "", 4, 4, 0, 94949],
   * ]
   */

  console.log('\n')
  console.log(table(tabledata, { columns: [{ alignment: 'center', width: 12 }], spanningCells: spanningcells }))

  // optionally display recorded cypress dashboard run link
  if (DASHBOARD) {
    process.stdout.write(`${chalk.bold.blueBright('⏺️  Cypress dashboard record (click link to navigate): ')}`)
    console.log(`${chalk.bold.whiteBright(DASHBOARD)}\n`)
  }
}

const menuchoices = () => {
  return [
    'Run cypress tests',
    'Run cypress tests (not recorded)',
    'View latest test results',
    'Setup parallel cli settings',
    `Load preset ${PRESET ? `(preset: ${PRESET})` : ''}`,
    'Help me',
    'Exit',
  ]
}
const menuprompt = () => {
  resetcli()

  inquirer
    .prompt({
      type: 'list',
      name: 'menu',
      message: 'What do you like to do?',
      choices: menuchoices(),
    })
    .then(async ({ menu }) => {
      switch (menu) {
        case menuchoices()[0]:
          // blah, blah, blah, r u sure 'bout this?
          inquirer
            .prompt({
              type: 'confirm',
              name: 'confirm',
              message: `Are you sure you want to run cypress tests with these settings:
      -- RECORDKEY: ${RECORDKEY || '<not set>'} --
      -- SPECS: ${SPECS} -- ENV: ${ENVVARS || '<not set>'} --
      -- BROWSERS: ${BROWSERS} -- PARALLEL: ${PARALLEL} --`,
              default: false,
            })
            .then(async ({ confirm }) => {
              if (confirm) {
                await runtest()
                askexit2menu()
              } else menuprompt()
            })
          break
        case menuchoices()[1]:
          // remove RECORDKEY before running tests to disable recording
          const _RECORDKEY = RECORDKEY
          RECORDKEY = ''
          await runtest()
          askexit2menu()
          RECORDKEY = _RECORDKEY
          break
        case menuchoices()[2]:
          // proceed only when results folder exists
          if (!existsSync(DEFAULT_REPORTER_DIR_PATH)) {
            console.log(chalk.redBright('parallel-cli-results folder does not exist, unable to get test results.'))
            console.log(chalk.redBright('maybe you should run your tests first. returning to main menu in 3s...'))
            setTimeout(() => menuprompt(), 3000)
          } else {
            showcliresultstable()
            askexit2menu()
          }
          break
        case menuchoices()[3]:
          settingsprompt()
          break
        case menuchoices()[4]:
          // TODO: add presets here
          if (!PRESET || PRESET === 'CUSTOM') {
            console.log(chalk.whiteBright(`No presets are available, creating default preset from current settings`))
            addnewpreset('DEFAULT')
            await sleep(2000)
            config.set('preset', 'DEFAULT')
          }

          inquirer
            .prompt({
              type: 'list',
              name: 'preset',
              message: 'Select which preset to load',
              default: PRESET,
              choices: PRESETS.map((p) => {
                return {
                  // TODO: customise preset name to be descriptive
                  name: `${p.name}`,
                  value: p.name,
                }
              }),
            })
            .then(({ preset }) => {
              PRESET = preset
              config.set('preset', PRESET)
              loadpreset()
              menuprompt()
            })
          break
        case menuchoices()[5]:
          console.log(chalk.bold.whiteBright(`Read README.md to learn how to setup and use parallel-cli`))
          console.log(chalk.greenBright('Opening readme documentation in 2s...'))
          await sleep(2000)
          await open('https://www.npmjs.com/package/@kmcid/cypress-parallel-cli')
          askexit2menu()
          break
        default:
          console.clear()
          process.exitCode = 1
      }
    })
}

// browser list: https://docs.cypress.io/guides/guides/launching-browsers
const browserlist = {
  'Electron browsers': [{ name: 'Electron', value: 'electron' }],
  'Chrome browsers': [
    { name: 'Chrome', value: 'chrome' },
    { name: 'Chromium', value: 'chromium' },
    { name: 'Chrome Beta', value: 'chrome:beta' },
    { name: 'Chrome Canary', value: 'chrome:canary' },
    { name: 'Edge', value: 'edge' },
    { name: 'Edg Canarye', value: 'edge:canary' },
  ],
  'Firefox browsers': [
    { name: 'Firefox', value: 'firefox' },
    { name: 'Firefox Dev', value: 'firefox:dev' },
    { name: 'Firefox Nightly', value: 'firefox:nightly' },
  ],
  'Webkit browsers (experimental)': [{ name: 'Webkit', value: 'webkit' }],
}

const settingschoices = [
  'Set project record key',
  'Set specs/tests to run',
  'Set environment variables',
  'Set target browsers',
  'Set parallel threads count',
  'Save current settings as preset',
  'Reset defaults',
  'Reset Parallel CLI',
  'Back',
]
const settingsprompt = () => {
  resetcli()

  inquirer
    .prompt({
      type: 'list',
      name: 'settings',
      message: 'Select which setting do you want to modify.',
      choices: settingschoices,
    })
    .then(({ settings }) => {
      switch (settings) {
        case settingschoices[0]:
          // allow setting of project record key, without the recordkey parallel would not work
          // this mimics real cypress parallelization, by providing threads and using dashboard to control the flow
          inquirer
            .prompt({
              type: 'input',
              name: 'recordkey',
              message: 'Write your project record key here:',
              default: RECORDKEY,
              validate(answer) {
                // record key is a uuid version 4 format
                if (
                  answer &&
                  !/^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/gi.test(
                    answer
                  )
                )
                  return 'You provided an invalid record key. Record key should match uuid format.'
                return true
              },
            })
            .then(({ recordkey }) => {
              config.set('recordkey', recordkey)
              setvars()
              settingsprompt()

              // since settings were changed, show custom preset
              PRESET = 'CUSTOM'
            })
          break
        case settingschoices[1]:
          // get suites under cypress/e2e
          const suites = globSync(`${resolve(__dirname, DEFAULT_CYPRESS_DIR, DEFAULT_SPECS_DIR)}/**`, {
            withFileTypes: true,
          })
            .filter((g) => g.isDirectory())
            .map((g) => g.fullpath().replace(resolve(__dirname, DEFAULT_CYPRESS_DIR), '').substring(1))

          // generate choices, currently allowing suites/folder choices
          const suitechoices = suites.map((suite) => {
            return { name: suite, value: suite, checked: SPECS.includes(suite) }
          })

          // current implementation: allows selection of folders in cypress/e2e
          // then each cypress test (1 level) in that folder will be executed
          // TODO: allow selection of nested (recursive), multiple spec files
          inquirer
            .prompt({
              type: 'checkbox',
              message: 'Select which suites to run',
              name: 'specs',
              choices: suitechoices,
              validate(answer) {
                if (answer.length < 1) return 'You must choose at least one suite'
                return true
              },
            })
            .then(({ specs }) => {
              config.set('specs', specs)
              setvars()
              settingsprompt()

              PRESET = 'CUSTOM'
            })
          break
        case settingschoices[2]:
          inquirer
            .prompt({
              type: 'input',
              name: 'envvars',
              message: 'Set cypress environment variables (e.g. configFile=qa)',
              default: ENVVARS,
            })
            .then(({ envvars }) => {
              config.set('envvars', envvars)
              setvars()
              settingsprompt()

              PRESET = 'CUSTOM'
            })
          break
        case settingschoices[3]:
          inquirer
            .prompt({
              type: 'checkbox',
              message: 'Select which browsers to run:',
              name: 'browsers',
              // build choices using "browserlist"
              choices: Object.entries(browserlist).reduce((a, [k, v]) => {
                a.push(new inquirer.Separator(k))
                v.forEach(({ name, value, enabled }) => {
                  a.push({
                    name,
                    value,
                    checked: BROWSERS.includes(value),
                    disabled: enabled ? false : true,
                  })
                })
                return a
              }, []),
              validate(answer) {
                if (answer.length < 1) return 'You must choose at least one browser'
                return true
              },
            })
            .then(({ browsers }) => {
              config.set('browsers', browsers)
              setvars()
              settingsprompt()

              PRESET = 'CUSTOM'
            })
          break
        case settingschoices[4]:
          inquirer
            .prompt({
              type: 'input',
              name: 'parallel',
              message: 'How many parallel runners do you want:',
              default: PARALLEL || MAX_PARALLEL_ALLOWED,
              validate(answer) {
                if (isNaN(parseInt(answer))) return 'You must provide a number'
                if (parseInt(answer) > MAX_PARALLEL_ALLOWED)
                  return `Current max parallel allowed is ${MAX_PARALLEL_ALLOWED}`
                return true
              },
            })
            .then(({ parallel }) => {
              // parse to number and return absolute number value
              config.set('parallel', Math.abs(parseInt(parallel)))
              setvars()
              settingsprompt()

              PRESET = 'CUSTOM'
            })
          break
        case settingschoices[5]:
          inquirer
            .prompt({
              type: 'input',
              name: 'preset',
              message: 'What would you like to name this preset?\nThis will overwrite existing preset with same name',
              default: PRESET,
              validate(answer) {
                if (answer.length < 3)
                  return 'Preset name should be longer than 3 characters, a little bit descriptive please'
                if (!/^[A-Z\-]+$/i.test(answer))
                  return 'Preset name should be not contain any number or special characters other than -'
                return true
              },
            })
            .then(({ preset }) => {
              // remove existing preset, will be overwritten by new settings
              const existsindex = PRESETS.findIndex((p) => p.name === preset)
              if (existsindex > -1) PRESETS.splice(existsindex, 1)

              addnewpreset(preset)
              settingsprompt()
            })
          break
        case settingschoices[6]:
          inquirer
            .prompt({
              type: 'confirm',
              name: 'reset',
              message: 'Are you sure you want to reset cli settings?',
              default: false,
            })
            .then(({ reset }) => {
              if (reset) resetvars()
              else settingsprompt()
            })
          break
        case settingschoices[7]:
          inquirer
            .prompt({
              type: 'confirm',
              name: 'reset',
              message: 'Are you sure you want to reset cli app? This is equivalent to uninstalling the cli app',
              default: false,
            })
            .then(({ reset }) => {
              if (reset) {
                console.log(chalk.cyanBright('Removing parallel-cli-results folder'))
                if (existsSync(DEFAULT_REPORTER_DIR_PATH))
                  rmSync(DEFAULT_REPORTER_DIR_PATH, { force: true, recursive: true })

                console.log(chalk.cyanBright('Removing parallel-cli reporter'))
                if (existsSync(resolve(__dirname, DEFAULT_REPORTER))) rmSync(resolve(__dirname, DEFAULT_REPORTER))

                console.log(chalk.cyanBright('Cleaning configurations'))
                config.clear()
                console.log(chalk.greenBright('Parallel CLI reset successful, rerun cli app again to setup'))
                process.exitCode = 1
              } else settingsprompt()
            })
          break
        default:
          menuprompt()
      }
    })
}

// cli repoter from cypress-parallel lib: https://github.com/tnicola/cypress-parallel/blob/master/lib/json-stream.reporter.js
const paralelclireporter = `"use strict";var Base=require("mocha/lib/reporters/base"),constants=require("mocha/lib/runner").constants,path=require("path"),fs=require("fs");const t=path.join(process.cwd(),"${DEFAULT_REPORTER_DIR}"),{EVENT_SUITE_END:e}=constants;function JSONStreamCustom(s,i){Base.call(this,s,i);var n=this;s.total,s.on(e,function(){writeFile({...n.stats,duration:calculateDuration(n.stats.start,n.stats.end),file:n.runner.suite.file})})}function calculateDuration(s,i){return i=i||new Date,new Date(i).getTime()-new Date(s).getTime()}function writeFile(s){let i=s.file.replace(/\\\\|\\\//g,"_");fs.existsSync(t)||fs.mkdirSync(t);let n=path.join(t,\`\${i}.json\`);fs.writeFileSync(n,JSON.stringify(s,null,2))}exports=module.exports=JSONStreamCustom,JSONStreamCustom.description="Writes statistics per spec file to result files";`

// we do not want someone selecting a browser that is not available, so we control the availability
const getavailablebrowsers = () => {
  // "cypress info" returns browsers installed in this machine, extracting it from logs
  console.log(chalk.bold.greenBright(`Detecting available browsers using cypress info`))
  // create a process and run "cypress info"
  return new Promise((resolve) => {
    const child = spawn('npx', ['npx cypress info'], {
      cwd: process.cwd(),
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
      },
    })

    const browsers = []
    // extracts data from: "1. Chrome\nName: chrome" -> "chrome"
    const extractbrowserdetails = (data, browser, regex) =>
      data.substring(data.indexOf(browser)).match(regex).pop().split(' ').pop().trim()

    child.stdout.on('data', (data) => {
      const datastring = data.toString()
      // match any word that looks like this: "1. Chrome" or "2. Firefox"
      for (const match of datastring.match(/\d\. \w+/g) || []) {
        // we can receive multiple browser info from a log string so we iterate those matches
        match.split(',').forEach((browser) => {
          const name = browser.split('.').pop().trim()
          const key = extractbrowserdetails(datastring, browser, /Name: \w+/)
          const version = extractbrowserdetails(datastring, browser, /Version: [\d\.]+/)
          // log our extracted browser so the user knows something is happening :D
          const _browser = { name, key, version }
          console.log(chalk.cyanBright(`Browser ${name} detected with version ${version}`))
          browsers.push(_browser)
        })
      }
    })

    child.on('exit', () => {
      // webkit browser is installed using a dependency called "playwright-webkit"
      // https://docs.cypress.io/guides/guides/launching-browsers#WebKit-Experimental
      console.log(chalk.bold.greenBright(`Detecting availability of webkit browser`))
      // check packagejson for installed webkit dependency
      const playrightwebkit =
        (packagejson.dependencies || {})['playwright-webkit'] ||
        (packagejson.devDependencies || {})['playwright-webkit']

      if (playrightwebkit) {
        const _browser = { name: 'Webkit', key: 'webkit', version: '' }
        browsers.push(_browser)
        console.log(
          chalk.cyanBright(
            `Playwright webkit (version ${playrightwebkit}) detected in package.json, ${_browser.name} enabled`
          )
        )
      }

      // electron ships with cypress, so yeah store that too
      browsers.push({ name: 'Electron', key: 'electron', version: '' })
      console.log(chalk.cyanBright(`Electron browser is enabled by default in cypress`))
      console.log(chalk.greenBright('Browser detection done, setting registered browsers'))

      // iterate found browsers and enable them in var: browserlist
      for (const browser of browsers) {
        // we do not know where this browser is so we iterate each browser category
        for (const category of Object.keys(browserlist)) {
          const { key, version } = browser
          const match = browserlist[category].find((x) => x.value === key)
          if (match) {
            // adding browser version to its name, looks cool
            match.name = `${match.name} ${version ? `(v${version})` : ''}`
            match.enabled = true
          }
        }
      }

      resolve()
    })
  })
}

;(async () => {
  // clearing console to remove config warnings
  console.clear()

  // catch RUN command for direct preset runs
  const args = process.argv.slice(2)
  if (args.length >= 1) {
    setvars()
    if (args[1] && !PRESETS.find((p) => p.name === args[1]))
      throw new Error(`Preset "${args[1]}" was not found in cli presets`)
    else {
      PRESET = args[1]
      loadpreset()
    }

    if (args[0] === 'run') await runtest()
    else if (args[0] === 'run-norecord') {
      // remove RECORDKEY before running tests to disable recording
      const _RECORDKEY = RECORDKEY
      RECORDKEY = ''
      await runtest()
      RECORDKEY = _RECORDKEY
    } else throw new Error(`Unknown cli command "${args[0]}"`)

    showcliresultstable()

    inquirer
      .prompt({
        name: 'exit',
        type: 'press-to-continue',
        anyKey: true,
        pressToContinueMessage: 'Press any key to exit cli runner ...',
      })
      .then(() => {
        // push down extra texts after: ⠦ Press any key to exit cli runner ...aksjdkjqwqwd
        console.log()
        process.exitCode = 1
      })

    return
  }

  // setup parallel-cli defaults and cli reporter
  if (!config.get('init')) {
    console.log(chalk.bold.greenBright(`Initialising parallel-cli configuration`))
    resetvars()
    setvars()

    await getavailablebrowsers()

    // include parallel-cli files to gitignore
    console.log(chalk.greenBright(`Updating .gitignore to include parallel-cli files`))
    const gitignorepath = resolve(__dirname, '.gitignore')
    const ignoreparallelcli = '# parallel-cli\nparallel-cli-results\nparallel-cli-reporter.js\n'
    if (existsSync(gitignorepath)) {
      console.log(chalk.cyanBright('.gitignore found, adding parallel-cli to gitignore now'))
      const gitignore = readFileSync(resolve(__dirname, '.gitignore'), 'utf-8')
      if (!gitignore.includes('# parallel-cli'))
        writeFileSync(gitignorepath, `${gitignore}\n${ignoreparallelcli}`, 'utf-8')
    } else {
      console.log(chalk.cyanBright('.gitignore not found, creating one now'))
      writeFileSync(gitignorepath, ignoreparallelcli, 'utf-8')
    }

    // write parallel-cli custom reporter
    console.log(chalk.greenBright(`Generating parallel-cli custom cypress reporter`))
    writeFileSync(DEFAULT_REPORTER, paralelclireporter, 'utf-8')
    config.set('init', true)
    console.log(chalk.greenBright(`Parallel-cli has been initialised successfully`))
  } else {
    setvars()
    loadpreset()
    await getavailablebrowsers()
  }

  // a little bit of delay before starting cli app
  await sleep(1000)
  menuprompt()
})()
