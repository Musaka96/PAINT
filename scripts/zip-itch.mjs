// Packs dist-itch/ into ants-paints-itch.zip for upload to itch.io.
//
// Why a hand-rolled zip writer instead of a shell tool: on Windows, PowerShell's
// Compress-Archive writes entry names with BACKSLASHES, which itch's unzipper reads as literal
// filenames (every asset 404s -> blank page); and GNU tar can't produce a real ZIP container at
// all (`tar -acf x.zip` just makes a tar named .zip -> "not a valid zip file"). This uses Node's
// built-in zlib to emit a spec-correct ZIP with forward-slash entries and DEFLATE compression,
// with no dependency on whatever archive tools happen to be installed.

import { createWriteStream, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'dist-itch')
const OUT = join(ROOT, 'ants-paints-itch.zip')

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

const files = await walk(SRC)
const central = []
const chunks = []
let offset = 0

for (const file of files) {
  // Forward-slash entry name relative to dist-itch — this is the whole point.
  const name = relative(SRC, file).split(sep).join('/')
  const data = await readFile(file)
  const compressed = deflateRawSync(data)
  const crc = crc32(data)
  const { time, day } = dosDateTime(statSync(file).mtime)
  const nameBuf = Buffer.from(name, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // local file header signature
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(8, 8) // method: deflate
  local.writeUInt16LE(time, 10)
  local.writeUInt16LE(day, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28) // extra length

  chunks.push(local, nameBuf, compressed)

  const cen = Buffer.alloc(46)
  cen.writeUInt32LE(0x02014b50, 0) // central directory signature
  cen.writeUInt16LE(20, 4) // version made by
  cen.writeUInt16LE(20, 6) // version needed
  cen.writeUInt16LE(0, 8)
  cen.writeUInt16LE(8, 10)
  cen.writeUInt16LE(time, 12)
  cen.writeUInt16LE(day, 14)
  cen.writeUInt32LE(crc, 16)
  cen.writeUInt32LE(compressed.length, 20)
  cen.writeUInt32LE(data.length, 24)
  cen.writeUInt16LE(nameBuf.length, 28)
  cen.writeUInt32LE(offset, 42) // local header offset
  central.push(Buffer.concat([cen, nameBuf]))

  offset += local.length + nameBuf.length + compressed.length
}

const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0) // end of central directory
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)

await new Promise((resolve, reject) => {
  const stream = createWriteStream(OUT)
  stream.on('error', reject)
  stream.on('finish', resolve)
  for (const c of chunks) stream.write(c)
  stream.write(centralBuf)
  stream.write(end)
  stream.end()
})

console.log(`Wrote ${OUT} — ${files.length} files, ${offset + centralBuf.length + 22} bytes`)
