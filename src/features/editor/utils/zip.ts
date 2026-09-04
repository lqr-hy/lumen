export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function createZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/^\/+/, ''))
    const checksum = crc32(entry.data)
    const local = concatBytes(
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(entry.data.length),
      uint32(entry.data.length),
      uint16(name.length),
      uint16(0),
      name,
      entry.data,
    )
    const central = concatBytes(
      uint32(0x02014b50),
      uint16(20),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(entry.data.length),
      uint32(entry.data.length),
      uint16(name.length),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(0),
      uint32(offset),
      name,
    )
    localParts.push(local)
    centralParts.push(central)
    offset += local.length
  }

  const centralDirectory = concatBytes(...centralParts)
  return concatBytes(
    ...localParts,
    centralDirectory,
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0),
  )
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(value: number) {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff)
}

function uint32(value: number) {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  )
}

function concatBytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
