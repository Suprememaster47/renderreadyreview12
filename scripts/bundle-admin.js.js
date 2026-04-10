import AdminJS from 'adminjs'
import { bundle } from '@adminjs/bundler'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// IMPORTANT: match your component path exactly
const componentPath = path.resolve(__dirname, '../components/Dashboard.jsx')

await bundle({
  componentPaths: [componentPath],
  destinationDir: path.resolve(__dirname, '../.adminjs'),
})

console.log('✅ AdminJS components bundled')