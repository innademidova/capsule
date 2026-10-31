// Генерує PNG-іконки з public/favicon.svg (sharp береться з perfume-diary, щоб не качати)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const sharp = createRequire(process.env.HOME + '/projects/perfume-diary/')('sharp')
const svg = readFileSync('public/favicon.svg')
for (const [f, s] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]])
  await sharp(svg).resize(s, s).png().toFile('public/' + f)
