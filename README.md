
# Cypress Parallel CLI
[![NPM Package Version](https://img.shields.io/npm/v/@kmcid/cypress-parallel-cli?label=npm%20package)](https://img.shields.io/npm/v/@kmcid/cypress-parallel-cli?label=npm%20package)

An interactive CLI app for running parallel cypress tests

Author [@kmcid](https://github.com/kmcid)


## Installation & Usage

```bash
  npm install @kmcid/cypress-parallel-cli --save-dev
  npx parallel-cli
```

![parallel cli](https://raw.githubusercontent.com/kmcid/assets/main/parallel-cli-recording.gif)


## Configuring CLI
To run parallel tests Cypress dashboard record key is needed, to get a record key go to `Cypress dashboard project -> Project settings -> Record keys`,
run cli then `Setup parallel cli settings -> Set project record key`

Select suites to run `Setup parallel cli settings -> Set specs/tests`, spec files inside the suites will be selected automatically, defaults to cypress/e2e

Select available browsers where tests will run `Setup parallel cli settings -> Set browsers`, defaults to electron

Select limit of parallel tests `Setup parallel cli settings -> Set parallel`, defaults to 5, maximum of 20

Set cypress environment variables `Setup parallel cli settings -> Set environment variables`, variables are comma separated

Current settings can be saved as Presets `Setup parallel cli settings -> Save current settings as preset`, once saved preset can be loaded from the main menu

## Running tests
Run tests using `Run cypress tests` or `Run cypress tests (no confirmation)`, this will execute `cypress run` in separate threads

To view the latest run results use `View latest test results`, this will display a table of test results and a link to Cypress dashboard recorded run

## Roadmap

- Add resource monitoring

