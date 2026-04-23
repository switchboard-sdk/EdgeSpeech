#!/usr/bin/env node
/**
 * Postinstall script for edgespeech
 * Downloads Switchboard SDK frameworks from S3
 */

const https = require('https')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

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
          // Follow redirect
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
        fs.unlink(dest, () => {}) // Delete partial file
        reject(err)
      })
  })
}

async function downloadAndExtract(packageName) {
  const packageDir = path.join(FRAMEWORKS_DIR, packageName, 'ios')
  const zipPath = path.join(packageDir, `${packageName}.zip`)
  const url = `${SDK_BASE_URL}/${SDK_VERSION}/ios/${packageName}.zip`

  // Create directory
  fs.mkdirSync(packageDir, { recursive: true })

  console.log(`  Downloading ${packageName}...`)

  try {
    await downloadFile(url, zipPath)
  } catch (err) {
    console.error(`  ERROR downloading ${packageName}: ${err.message}`)
    return false
  }

  console.log(`  Extracting ${packageName}...`)

  try {
    execSync(`unzip -o -q "${zipPath}" -d "${packageDir}"`, { stdio: 'pipe' })
  } catch (err) {
    console.error(`  ERROR extracting ${packageName}: ${err.message}`)
    return false
  }

  // Clean up zip file
  fs.unlinkSync(zipPath)

  console.log(`  ✓ ${packageName}`)
  return true
}

function setupExampleEnv() {
  const exampleDir = path.join(PACKAGE_ROOT, 'example')
  const envExample = path.join(exampleDir, '.env.example')
  const envFile = path.join(exampleDir, '.env')

  // Only run if example directory exists (i.e., we're in the repo, not installed as a dep)
  if (!fs.existsSync(exampleDir)) {
    return
  }

  if (!fs.existsSync(envExample)) {
    return
  }

  if (fs.existsSync(envFile)) {
    console.log('example/.env already exists, skipping...')
    return
  }

  console.log('Creating example/.env from .env.example...')
  fs.copyFileSync(envExample, envFile)
  console.log('')
  console.log('============================================================')
  console.log('ACTION REQUIRED: Update example/.env with your credentials')
  console.log('Get credentials at https://console.switchboard.audio/register')
  console.log('============================================================')
  console.log('')
}

async function main() {
  // Set up example .env file
  setupExampleEnv()

  // Check if frameworks already exist
  const sdkPath = path.join(FRAMEWORKS_DIR, 'SwitchboardSDK', 'ios', 'SwitchboardSDK.xcframework')
  if (fs.existsSync(sdkPath)) {
    console.log('Switchboard SDK frameworks already downloaded, skipping...')
    return 0
  }

  console.log('')
  console.log('============================================================')
  console.log('Downloading Switchboard SDK Frameworks')
  console.log('============================================================')
  console.log(`SDK Version: ${SDK_VERSION}`)
  console.log(`Output: ${FRAMEWORKS_DIR}`)
  console.log('============================================================')
  console.log('')

  // Clean existing frameworks directory
  if (fs.existsSync(FRAMEWORKS_DIR)) {
    fs.rmSync(FRAMEWORKS_DIR, { recursive: true })
  }
  fs.mkdirSync(FRAMEWORKS_DIR, { recursive: true })

  let successCount = 0
  for (const packageName of PACKAGES) {
    if (await downloadAndExtract(packageName)) {
      successCount++
    }
  }

  console.log('')
  console.log('============================================================')
  console.log(`Download Complete: ${successCount}/${PACKAGES.length} packages`)
  console.log('============================================================')
  console.log('')

  if (successCount < PACKAGES.length) {
    console.error('ERROR: Some packages failed to download')
    return 1
  }

  return 0
}

main()
  .then(process.exit)
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
