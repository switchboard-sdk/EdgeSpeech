#!/usr/bin/env node
/**
 * Download the on-device models into the Android app's assets (Android AARs ship
 * no models; the nodes load them by file path at runtime). Places Whisper models
 * under assets/models/whisper/ and the Sherpa TTS voice zip under
 * assets/models/sherpa/tts/. Idempotent. Re-run after `expo prebuild --clean`.
 *
 * Usage: node scripts/download-android-models.js [assetsRootDir]
 *   (default: example/android/app/src/main/assets)
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const S3 = 'https://switchboard-sdk-public.s3.amazonaws.com/assets/models'

const assetsRoot =
  process.argv[2] ||
  path.join(__dirname, '..', 'example', 'android', 'app', 'src', 'main', 'assets')

// Whisper STT ggml models + the default Sherpa TTS voice (en_GB). de_DE is
// available at ${S3}/sherpa/tts/de_DE.zip — add it here to bundle it too.
const DOWNLOADS = [
  { url: `${S3}/whisper/ggml-base.en.bin`, rel: 'models/whisper/ggml-base.en.bin' },
  { url: `${S3}/whisper/ggml-tiny.en.bin`, rel: 'models/whisper/ggml-tiny.en.bin' },
  { url: `${S3}/sherpa/tts/en_GB.zip`, rel: 'models/sherpa/tts/en_GB.zip' },
]

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
  console.log(`Models → ${assetsRoot}`)
  for (const { url, rel } of DOWNLOADS) {
    const dest = path.join(assetsRoot, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const size = await remoteSize(url)
    if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
      console.log(`  ${rel}: already present (${size} bytes), skipping`)
      continue
    }
    console.log(`Downloading ${rel} (${Math.round((size / 1048576) * 10) / 10} MB)...`)
    await download(url, dest, size)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`)
  process.exit(1)
})
