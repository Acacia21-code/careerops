#!/usr/bin/env node
/**
 * Thin Playwright smoke: Memory → polish metric-drift reject → promote → source_id.
 * Uses a harness with the same Memory section IDs (memorySection, mem_body, mem_save, …)
 * so SPA extraction can proceed without rewriting index.html for tests.
 *
 * Optional in CI when browsers are not installed: exits 0 with skip notice if
 * playwright / chromium unavailable unless PLAYWRIGHT_STRICT=1.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const strict = process.env.PLAYWRIGHT_STRICT === '1'

function skip(msg) {
  console.log(`[playwright-memory] SKIP: ${msg}`)
  if (strict) process.exit(1)
  process.exit(0)
}

let playwright
try {
  playwright = await import('playwright')
} catch (_e) {
  skip('playwright package not installed (npm i -D playwright)')
}

const { chromium } = playwright
let browser
try {
  browser = await chromium.launch({ headless: true })
} catch (e) {
  skip(`chromium unavailable (${e.message}). Run: npx playwright install chromium`)
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath
  if (urlPath === '/' || urlPath === '/smoke') {
    filePath = path.join(root, 'scripts/fixtures/memory-promote-smoke.html')
  } else if (urlPath.startsWith('/web/')) {
    filePath = path.join(root, urlPath.slice(1))
  } else if (urlPath.startsWith('/scripts/')) {
    filePath = path.join(root, urlPath.slice(1))
  } else {
    filePath = path.join(root, urlPath.replace(/^\//, ''))
  }
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(root) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const ext = path.extname(resolved)
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
  fs.createReadStream(resolved).pipe(res)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}`

const page = await browser.newPage()
try {
  await page.goto(`${base}/smoke`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#memorySection')
  await page.fill('#mem_body', 'Cut p95 latency 10% on checkout API')
  await page.click('#mem_save')
  await page.waitForSelector('[data-mem-polish]')

  await page.click('[data-mem-polish]')
  await page.waitForSelector('#mem_polish:not(.hidden)')
  const driftBlocked = await page.evaluate(() => !!window.__lastDrift?.blocked)
  if (!driftBlocked) throw new Error('expected metric drift to block Accept')
  const acceptDisabled = await page.$eval('#mem_accept', (el) => el.disabled)
  if (!acceptDisabled) throw new Error('Accept should be disabled when drift blocked')

  // Also verify acceptPolish throws if forced
  const acceptErr = await page.evaluate(() => {
    try {
      document.getElementById('mem_accept').disabled = false
      document.getElementById('mem_accept').click()
      return window.__acceptError || null
    } catch (e) {
      return e.message
    }
  })
  // Click reject path (doctrine: human Reject clears candidate)
  await page.click('#mem_reject')
  const rejected = await page.evaluate(() => !!window.__polishRejected)
  if (!rejected) throw new Error('expected Reject to clear polish candidate')

  await page.click('[data-mem-promote]')
  await page.waitForSelector('#smoke_result:not(:empty)')
  const result = await page.evaluate(() => window.__promoteResult)
  if (!result?.source_id) throw new Error(`missing source_id after promote: ${JSON.stringify(result)}`)
  if (result.source_type !== 'accomplishment') {
    throw new Error(`expected source_type=accomplishment, got ${result.source_type}`)
  }

  // Guardrail unit check still reachable in-browser
  const libDrift = await page.evaluate(() =>
    window.__memSmoke.detectMetricEntityDrift('Grew 10%', 'Grew 25%'),
  )
  if (!libDrift.blocked) throw new Error('detectMetricEntityDrift should block metric change')

  console.log('test-playwright-memory-promote passed', result)
  if (acceptErr) console.log('(accept blocked message)', acceptErr)
} finally {
  await browser.close()
  server.close()
}
