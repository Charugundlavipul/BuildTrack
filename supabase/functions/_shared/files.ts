const signatures = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pdf: [0x25, 0x50, 0x44, 0x46]
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value)
}

export function detectMime(bytes: Uint8Array) {
  if (startsWith(bytes, signatures.jpeg)) return 'image/jpeg'
  if (startsWith(bytes, signatures.png)) return 'image/png'
  if (startsWith(bytes, signatures.pdf)) return 'application/pdf'
  const box = new TextDecoder().decode(bytes.slice(4, 12))
  if (box.startsWith('ftyp') && /(heic|heix|hevc|hevx|mif1|msf1)/.test(box)) return 'image/heic'
  return null
}

export async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function csvCell(value: unknown) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
