'use strict'
const sharp = require('sharp')

async function pHash(buffer) {
  const { data } = await sharp(buffer)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixels = Array.from(data)
  const avg = pixels.reduce((s, v) => s + v, 0) / pixels.length
  return pixels.map(v => (v >= avg ? '1' : '0')).join('')
}

async function hashAll(buffers) {
  const results = []
  for (const { url, buffer } of buffers) {
    if (!buffer) { results.push({ url, hash: null }); continue }
    try {
      results.push({ url, hash: await pHash(buffer) })
    } catch {
      results.push({ url, hash: null })
    }
  }
  return results
}

module.exports = { hashAll }
