#!/usr/bin/env node
/**
 * Download the on-device Whisper models into the Android app's assets.
 *
 * Unlike iOS (where the models are bundled inside SwitchboardWhisper.xcframework),
 * the Android Whisper AAR ships no model — the `Whisper.STT` node loads a ggml
 * model from an absolute file path (`modelPath`). So the app must ship the model
 * in its assets; the EdgeSpeech native layer (EdgeSpeechModelsModule) then copies
 * it to filesDir on first run and hands the path to the STT node.
 *
 * This places the models under the app's `assets/models/whisper/` so they are
 * packaged into the APK. Idempotent: skips a file already present at the right
 * size. Re-run after `expo prebuild --clean` (which regenerates android/).
 *
 * Usage:
 *   node scripts/download-android-models.js [targetAssetsDir]
 * Default targetAssetsDir:
 *   example/android/app/src/main/assets/models/whisper
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const BASE_URL = 'https://switchboard-sdk-public.s3.amazonaws.com/assets/models/whisper'
const MODELS = ['ggml-base.en.bin', 'ggml-tiny.en.bin']

const targetDir =
  process.argv[2] ||
  path.join(__dirname, '..', 'example', 'android', 'app', 'src', 'main', 'assets', 'models', 'whisper')

function remoteSize(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HEAD ${url} → HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      resolve(Number(res.headers['content-length']) || 0)
    })
    req.on('error', reject)
    req.end()
  })
}

function download(url, dest, expectedSize) {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.download`
    const file = fs.createWriteStream(tmp)
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → HTTP ${res.statusCode}`))
          res.resume()
          return
        }
        const total = Number(res.headers['content-length']) || expectedSize || 0
        let received = 0
        let lastPct = -1
        res.on('data', (chunk) => {
          received += chunk.length
          if (total) {
            const pct = Math.floor((received / total) * 100)
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`\r  ${path.basename(dest)}: ${pct}%`)
              lastPct = pct
            }
          }
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => {
          fs.renameSync(tmp, dest)
          process.stdout.write(`\r  ${path.basename(dest)}: done (${fs.statSync(dest).size} bytes)\n`)
          resolve()
        }))
      })
      .on('error', (err) => {
        fs.rm(tmp, { force: true }, () => reject(err))
      })
  })
}

async function main() {
  fs.mkdirSync(targetDir, { recursive: true })
  console.log(`Whisper models → ${targetDir}`)
  for (const name of MODELS) {
    const url = `${BASE_URL}/${name}`
    const dest = path.join(targetDir, name)
    const size = await remoteSize(url)
    if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
      console.log(`  ${name}: already present (${size} bytes), skipping`)
      continue
    }
    console.log(`Downloading ${name} (${Math.round((size / 1048576) * 10) / 10} MB)...`)
    await download(url, dest, size)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`)
  process.exit(1)
})
