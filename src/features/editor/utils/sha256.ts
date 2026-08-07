export function sha256Bytes(bytes: Uint8Array): string {
  const words: number[] = []
  const bitLength = bytes.length * 8
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] = (words[index >> 2] ?? 0) | bytes[index] << (24 - (index % 4) * 8)
  }
  words[bitLength >> 5] = (words[bitLength >> 5] ?? 0) | 0x80 << (24 - bitLength % 32)
  words[((bitLength + 64 >> 9) << 4) + 15] = bitLength

  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  const constants = createConstants()
  const schedule = new Array<number>(64)
  for (let offset = 0; offset < words.length; offset += 16) {
    for (let index = 0; index < 64; index += 1) {
      if (index < 16) schedule[index] = words[offset + index] ?? 0
      else {
        const left = schedule[index - 15]
        const right = schedule[index - 2]
        const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ left >>> 3
        const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ right >>> 10
        schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) | 0
      }
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = e & f ^ ~e & g
      const temp1 = (h + sum1 + choice + constants[index] + schedule[index]) | 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = a & b ^ a & c ^ b & c
      const temp2 = (sum0 + majority) | 0
      h = g
      g = f
      f = e
      e = (d + temp1) | 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) | 0
    }
    hash[0] = (hash[0] + a) | 0
    hash[1] = (hash[1] + b) | 0
    hash[2] = (hash[2] + c) | 0
    hash[3] = (hash[3] + d) | 0
    hash[4] = (hash[4] + e) | 0
    hash[5] = (hash[5] + f) | 0
    hash[6] = (hash[6] + g) | 0
    hash[7] = (hash[7] + h) | 0
  }
  return hash.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

function rotateRight(value: number, amount: number) {
  return value >>> amount | value << 32 - amount
}

function createConstants() {
  const result: number[] = []
  let candidate = 2
  while (result.length < 64) {
    let prime = true
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
      if (candidate % divisor === 0) {
        prime = false
        break
      }
    }
    if (prime) result.push(Math.floor((Math.cbrt(candidate) % 1) * 0x100000000) | 0)
    candidate += 1
  }
  return result
}
