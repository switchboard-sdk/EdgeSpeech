#!/usr/bin/env node
/**
 * Postinstall script for edgespeech
 * Downloads Switchboard SDK frameworks from S3
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const { intro, outro, log, note, tasks } = require('@clack/prompts')

const SDK_VERSION = 'release/3.2.0'
const SDK_BASE_URL = 'https://switchboard-sdk-public.s3.amazonaws.com/builds'

const PACKAGES = [
  'SwitchboardSDK',
  'SwitchboardOnnx',
  'SwitchboardSileroVAD',
  'SwitchboardWhisper',
  'SwitchboardSherpa',
]

const SCRIPT_DIR = __dirname
const PACKAGE_ROOT = path.dirname(SCRIPT_DIR)
const FRAMEWORKS_DIR = path.join(PACKAGE_ROOT, 'ios', 'Frameworks')

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadFile(response.headers.location, dest).then(resolve).catch(reject)
          return
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      })
      .on('error', (err) => {
        fs.unlink(dest, () => {})
        reject(err)
      })
  })
}

async function downloadPackage(packageName, message) {
  const packageDir = path.join(FRAMEWORKS_DIR, packageName, 'ios')
  const zipPath = path.join(packageDir, `${packageName}.zip`)
  const url = `${SDK_BASE_URL}/${SDK_VERSION}/ios/${packageName}.zip`

  fs.mkdirSync(packageDir, { recursive: true })

  message(`Downloading ${packageName}`)
  await downloadFile(url, zipPath)

  message(`Extracting ${packageName}`)
  execSync(`unzip -o -q "${zipPath}" -d "${packageDir}"`, { stdio: 'pipe' })

  fs.unlinkSync(zipPath)
}

function setupExampleEnv() {
  const exampleDir = path.join(PACKAGE_ROOT, 'example')
  const envExample = path.join(exampleDir, '.env.example')
  const envFile = path.join(exampleDir, '.env')

  if (!fs.existsSync(exampleDir) || !fs.existsSync(envExample)) {
    return
  }

  if (fs.existsSync(envFile)) {
    log.warn('The ./example/.env already exists')
    return
  }

  fs.copyFileSync(envExample, envFile)
  note(
    'Update example/.env with your credentials\nGet credentials at https://console.switchboard.audio/register',
    'Action Required'
  )
}

async function main() {
  intro(`Switchboard SDK ${SDK_VERSION}`)

  log.info('Setting up example environment')

  setupExampleEnv()

  log.info('Downloading frameworks')

  const sdkPath = path.join(FRAMEWORKS_DIR, 'SwitchboardSDK', 'ios', 'SwitchboardSDK.xcframework')
  if (fs.existsSync(sdkPath)) {
    log.warn('Frameworks already downloaded')
  } else {
    if (fs.existsSync(FRAMEWORKS_DIR)) {
      fs.rmSync(FRAMEWORKS_DIR, { recursive: true })
    }
    fs.mkdirSync(FRAMEWORKS_DIR, { recursive: true })

    const failures = []

    await tasks(
      PACKAGES.map((packageName, index) => {
        const progress = `(${index + 1}/${PACKAGES.length})`
        return {
          title: `${packageName} ${progress}`,
          task: async (message) => {
            try {
              await downloadPackage(packageName, (msg) => message(`${msg} ${progress}`))
            } catch (err) {
              failures.push(packageName)
              return `Failed: ${packageName}`
            }
            return `Downloaded ${packageName} ${progress}`
          },
        }
      })
    )

    if (failures.length > 0) {
      log.error(`Failed to download: ${failures.join(', ')}`)
      log.error(`Installation incomplete — ${failures.length} package(s) failed`)
      return 1
    }
  }

  outro('Installation complete')
  return 0
}

main()
  .then(process.exit)
  .catch((err) => {
    log.error(err.message)
    process.exit(1)
  })
