import { bundle } from '@adminjs/bundler'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function run() {
  try {
    await bundle({
      componentLoader: path.join(__dirname, 'node_modules/adminjs'),
      destinationDir: path.join(__dirname, '.adminjs'),
    })

    console.log('✅ AdminJS bundle built successfully')
  } catch (err) {
    console.error('❌ AdminJS bundling failed:', err)
    process.exit(1)
  }
}

run()
