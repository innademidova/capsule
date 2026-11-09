// Test basics: draws illustrations (SVG → WebP with a transparent background) and adds them to the wardrobe.
//   node scripts/seed-basics.mjs            → add
//   node scripts/seed-basics.mjs preview <dir> → only save the images for review
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
const sharp = createRequire(process.env.HOME + '/projects/perfume-diary/')('sharp')

// Colour shade: amt > 0 is lighter, < 0 is darker
const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16)
  const f = c => Math.max(0, Math.min(255, Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt))))
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(c => c.toString(16).padStart(2, '0')).join('')
}
const fabric = (id, c, a = 0.12, b = -0.1) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${shade(c, a)}"/><stop offset="0.55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, b)}"/></linearGradient>`
const svg = (defs, body, w = 800, h = 1000) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}
  <filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-opacity="0.12"/></filter></defs>
  <g filter="url(#soft)">${body}</g></svg>`
const fold = (d, c, o = 0.35, w = 3) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${o}"/>`
const stitch = (d, c = '#c98a3a', w = 2.5) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-dasharray="7 6" stroke-linecap="round"/>`

function tee(c) {
  const s = shade(c, -0.18)
  return svg(fabric('f', c, 0.25, -0.06), `
  <path d="M262 150 L338 122 Q400 168 462 122 L538 150 L690 262 L626 352 L560 312 L566 840 Q400 858 234 840 L240 312 L174 352 L110 262 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M338 122 Q400 186 462 122" fill="none" stroke="${s}" stroke-width="10" opacity="0.5"/>
  ${fold('M240 312 Q246 260 262 210', s, 0.4)}${fold('M560 312 Q554 260 538 210', s, 0.4)}
  ${fold('M300 420 Q330 600 310 800', s, 0.18, 4)}${fold('M500 440 Q470 620 495 810', s, 0.15, 4)}
  ${fold('M174 352 L110 262', s, 0)}${fold('M236 826 Q400 842 564 826', s, 0.3)}`)
}

function longsleeve(c, { turtle = false, rib = false } = {}) {
  const s = shade(c, -0.25), hl = shade(c, 0.25)
  return svg(fabric('f', c, 0.18, -0.12), `
  <path d="M262 170 L340 140 Q400 170 460 140 L538 170 L640 260 L700 820 L612 832 L566 420 L566 850 Q400 868 234 850 L234 420 L188 832 L100 820 L160 260 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  ${turtle ? `<path d="M332 70 L468 70 L470 150 Q400 176 330 150 Z" fill="url(#f)" stroke="${s}" stroke-width="3"/>
    ${[350, 372, 394, 416, 438, 456].map(x => fold(`M${x} 76 L${x} 150`, s, 0.25, 2)).join('')}`
    : `<path d="M340 140 Q400 196 460 140" fill="none" stroke="${s}" stroke-width="12" opacity="0.45"/>`}
  ${rib ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => fold(`M${246 + i * 20} 800 L${246 + i * 20} 852`, s, 0.3, 2)).join('')
    + fold('M234 800 Q400 816 566 800', s, 0.4) + fold('M106 770 L192 780', s, 0.4) + fold('M608 780 L694 770', s, 0.4) : ''}
  ${fold('M234 420 Q240 330 262 250', s, 0.35)}${fold('M566 420 Q560 330 538 250', s, 0.35)}
  ${fold('M300 470 Q326 640 300 820', hl, 0.25, 6)}${fold('M150 400 Q140 600 130 790', s, 0.2)}${fold('M650 400 Q660 600 670 790', s, 0.2)}`)
}

function shirt(c) {
  const s = shade(c, -0.3)
  return svg(fabric('f', c, 0.2, -0.1), `
  <path d="M262 170 L345 140 L400 200 L455 140 L538 170 L640 260 L700 810 L612 822 L566 420 L570 880 Q400 900 230 880 L234 420 L188 822 L100 810 L160 260 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M340 140 Q400 112 460 140 L455 150 Q400 128 345 150 Z" fill="${shade(c, -0.05)}" stroke="${s}" stroke-width="2.5"/>
  <path d="M345 146 L400 200 L366 236 L326 170 Z M455 146 L400 200 L434 236 L474 170 Z" fill="${shade(c, 0.15)}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  ${fold('M400 200 L400 885', s, 0.5, 3)}${fold('M386 210 L386 885', s, 0.3, 2)}
  ${[260, 380, 500, 620, 740, 850].map(y => `<circle cx="412" cy="${y}" r="8" fill="#fff" stroke="${s}" stroke-width="2"/>`).join('')}
  <path d="M460 300 L540 300 L540 390 Q500 404 460 390 Z" fill="none" stroke="${s}" stroke-width="2.5" opacity="0.6"/>
  <path d="M104 760 L194 772 L188 822 L100 810 Z M606 772 L696 760 L700 810 L612 822 Z" fill="${shade(c, 0.12)}" stroke="${s}" stroke-width="3"/>
  ${fold('M300 470 Q320 650 296 860', s, 0.15, 4)}${fold('M150 400 Q140 600 130 760', s, 0.2)}`)
}

function cardigan(c) {
  const s = shade(c, -0.25)
  return svg(fabric('f', c, 0.18, -0.12), `
  <path d="M262 160 L350 130 L400 430 L450 130 L538 160 L640 260 L700 820 L612 832 L566 430 L566 860 L400 860 L234 860 L234 430 L188 832 L100 820 L160 260 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M350 130 L400 430 L450 130" fill="none" stroke="${s}" stroke-width="14" opacity="0.35"/>
  ${fold('M400 430 L400 860', s, 0.6, 3)}
  ${[480, 570, 660, 750].map(y => `<circle cx="384" cy="${y}" r="9" fill="${shade(c, -0.45)}"/>`).join('')}
  ${Array.from({ length: 16 }, (_, i) => fold(`M${246 + i * 20} 810 L${246 + i * 20} 860`, s, 0.3, 2)).join('')}
  ${fold('M234 810 L566 810', s, 0.4)}${fold('M106 770 L192 780', s, 0.4)}${fold('M608 780 L694 770', s, 0.4)}
  ${Array.from({ length: 5 }, (_, i) => fold(`M${280 + i * 22} 300 Q${276 + i * 22} 550 ${282 + i * 22} 790`, s, 0.12, 6)).join('')}
  ${Array.from({ length: 5 }, (_, i) => fold(`M${432 + i * 22} 300 Q${436 + i * 22} 550 ${430 + i * 22} 790`, s, 0.12, 6)).join('')}`)
}

function jeans(c) {
  const s = shade(c, -0.35)
  return svg(fabric('f', c, 0.22, -0.15), `
  <path d="M250 110 L550 110 L566 300 L588 920 L436 920 L402 380 L364 920 L212 920 L234 300 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M250 110 L550 110 L553 158 L247 158 Z" fill="${shade(c, -0.05)}" stroke="${s}" stroke-width="3"/>
  <rect x="392" y="124" width="16" height="22" rx="3" fill="#c9a65a"/>
  ${stitch('M252 150 L548 150')}${stitch('M402 160 L402 380')}${stitch('M402 300 Q440 300 446 160')}
  ${stitch('M250 170 Q300 210 316 160')}${stitch('M550 170 Q500 210 484 160')}
  ${[280, 340, 460, 520].map(x => `<rect x="${x}" y="108" width="12" height="54" rx="3" fill="${shade(c, -0.05)}" stroke="${s}" stroke-width="2"/>`).join('')}
  ${stitch('M226 600 L222 900', '#c98a3a', 2)}${stitch('M574 600 L578 900', '#c98a3a', 2)}
  ${fold('M300 320 Q310 500 290 900', shade(c, 0.35), 0.35, 10)}${fold('M500 320 Q490 500 510 900', shade(c, 0.35), 0.3, 10)}
  ${fold('M370 440 Q330 470 300 470', s, 0.3)}${fold('M434 440 Q470 470 500 470', s, 0.3)}`)
}

function trousers(c) {
  const s = shade(c, -0.5), hl = shade(c, 0.3)
  return svg(fabric('f', c, 0.2, -0.1), `
  <path d="M256 110 L544 110 L566 300 L606 930 L432 930 L400 390 L368 930 L194 930 L234 300 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M256 110 L544 110 L547 160 L253 160 Z" fill="${shade(c, 0.06)}" stroke="${hl}" stroke-width="2" opacity="0.95"/>
  <circle cx="420" cy="135" r="7" fill="${hl}" opacity="0.6"/>
  ${fold('M400 165 L400 390', hl, 0.35, 2)}${fold('M302 180 L282 930', hl, 0.3, 2)}${fold('M498 180 L518 930', hl, 0.3, 2)}
  ${fold('M262 200 Q290 230 320 200', hl, 0.25, 2)}${fold('M538 200 Q510 230 480 200', hl, 0.25, 2)}`)
}

function skirt(c) {
  const s = shade(c, -0.25)
  return svg(fabric('f', c, 0.15, -0.12), `
  <path d="M290 150 L510 150 L640 860 Q400 900 160 860 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M290 150 L510 150 L512 196 L288 196 Z" fill="${shade(c, -0.06)}" stroke="${s}" stroke-width="3"/>
  ${[0, 1, 2, 3, 4, 5, 6].map(i => { const x1 = 315 + i * 28, x2 = 210 + i * 64; return fold(`M${x1} 200 L${x2} 870`, s, 0.3, 2.5) }).join('')}
  ${[0, 1, 2].map(i => fold(`M${250 + i * 140} 500 Q${280 + i * 140} 700 ${240 + i * 140} 870`, shade(c, 0.3), 0.3, 12)).join('')}`)
}

function slipDress(c) {
  const s = shade(c, 0.35)
  return svg(fabric('f', c, 0.3, -0.2), `
  <path d="M318 60 L330 230 M482 60 L470 230" stroke="${shade(c, 0.1)}" stroke-width="5"/>
  <path d="M300 230 Q400 330 500 230 L520 520 L620 940 Q400 980 180 940 L280 520 Z" fill="url(#f)" stroke="${shade(c, -0.3)}" stroke-width="3" stroke-linejoin="round"/>
  ${fold('M300 230 Q400 330 500 230', s, 0.5, 3)}
  ${fold('M350 420 Q330 700 300 940', s, 0.35, 8)}${fold('M450 400 Q480 700 520 945', s, 0.25, 6)}${fold('M400 520 Q400 760 410 960', s, 0.2, 10)}`)
}

function trench(c) {
  const s = shade(c, -0.3), hl = shade(c, 0.2)
  return svg(fabric('f', c, 0.15, -0.12), `
  <path d="M262 120 L350 96 L400 300 L450 96 L538 120 L650 230 L712 880 L622 892 L578 430 L600 960 L200 960 L222 430 L178 892 L88 880 L150 230 Z" fill="url(#f)" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M350 96 L300 70 L262 120 L330 330 L400 300 Z M450 96 L500 70 L538 120 L470 330 L400 300 Z" fill="${hl}" stroke="${s}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M400 300 L440 960" fill="none" stroke="${s}" stroke-width="3" opacity="0.6"/>
  ${[400, 500, 600].flatMap(y => [`<circle cx="362" cy="${y}" r="10" fill="${shade(c, -0.5)}"/>`, `<circle cx="470" cy="${y}" r="10" fill="${shade(c, -0.5)}"/>`]).join('')}
  <path d="M214 520 L586 520 L588 566 L212 566 Z" fill="${shade(c, -0.04)}" stroke="${s}" stroke-width="3"/>
  <rect x="380" y="512" width="44" height="62" rx="6" fill="none" stroke="${shade(c, -0.55)}" stroke-width="5"/>
  <path d="M420 566 Q440 640 410 700 M430 566 Q460 620 452 690" fill="none" stroke="${shade(c, -0.04)}" stroke-width="22" stroke-linecap="round"/>
  <path d="M106 800 L182 810 M618 810 L694 800" stroke="${s}" stroke-width="14" opacity="0.5"/>
  ${fold('M260 600 Q270 780 240 950', s, 0.2, 5)}${fold('M540 600 Q540 780 570 950', s, 0.2, 5)}${stitch('M156 240 L240 160', s, 2)}${stitch('M644 240 L560 160', s, 2)}`)
}

function blazer(c) {
  const s = shade(c, 0.35)
  return svg(fabric('f', c, 0.22, -0.2), `
  <path d="M262 130 L350 106 L400 420 L450 106 L538 130 L650 236 L708 830 L620 842 L578 420 L590 840 L210 840 L222 420 L180 842 L92 830 L150 236 Z" fill="url(#f)" stroke="${shade(c, -0.3)}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M350 106 L304 84 L262 130 L300 250 L340 260 L400 420 Z M450 106 L496 84 L538 130 L500 250 L460 260 L400 420 Z" fill="${shade(c, 0.12)}" stroke="${s}" stroke-width="2.5" stroke-linejoin="round" opacity="0.95"/>
  ${fold('M400 420 L408 840', s, 0.45, 2.5)}
  <circle cx="420" cy="520" r="9" fill="${shade(c, 0.4)}"/><circle cx="420" cy="620" r="9" fill="${shade(c, 0.4)}"/>
  <path d="M250 640 L350 640 M450 640 L550 640 M460 330 L530 324" stroke="${s}" stroke-width="3" opacity="0.5"/>
  ${fold('M180 300 Q170 560 150 800', s, 0.2)}${fold('M620 300 Q630 560 650 800', s, 0.2)}`)
}

function sneakers() {
  const o = '#a9a9a3'
  return svg(fabric('f', '#fbfbf9', 0.5, -0.08) + fabric('g', '#f0efeb', 0.3, -0.08), `
  <path d="M100 584 L100 452 Q104 418 150 416 Q230 420 292 398 L356 330 Q392 314 420 340 L470 382 Q560 440 680 468 Q770 492 770 556 L770 584 Z" fill="url(#f)" stroke="${o}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M620 460 Q700 500 716 584" fill="none" stroke="${o}" stroke-width="3"/>
  <path d="M100 452 Q104 418 150 416 L170 416 L170 584 L100 584 Z" fill="#e9e8e3" stroke="${o}" stroke-width="3"/>
  <path d="M90 584 L776 584 Q782 646 742 654 L124 654 Q84 646 90 584 Z" fill="url(#g)" stroke="${o}" stroke-width="4"/>
  ${fold('M92 614 L778 614', o, 0.7, 2.5)}
  <path d="M300 400 Q360 470 520 452" fill="none" stroke="${o}" stroke-width="3"/>
  ${[0, 1, 2, 3, 4].map(i => `<circle cx="${380 + i * 30}" cy="${364 + i * 18}" r="6" fill="#fff" stroke="${o}" stroke-width="2.5"/>`).join('')}
  ${[0, 1, 2, 3].map(i => `<path d="M${380 + i * 30} ${364 + i * 18} L${410 + i * 30} ${352 + i * 18}" stroke="#ffffff" stroke-width="9" stroke-linecap="round"/><path d="M${380 + i * 30} ${364 + i * 18} L${410 + i * 30} ${352 + i * 18}" stroke="${o}" stroke-width="2" fill="none" opacity="0.6"/>`).join('')}
  ${fold('M210 470 Q300 470 330 520', o, 0.35, 2.5)}${fold('M150 540 L560 540', '#c6c6c0', 0.5, 2)}`, 860, 760)
}

function ankleBoots() {
  const c = '#1c1c1e'
  return svg(fabric('f', c, 0.32, -0.2), `
  <path d="M300 140 L470 140 L480 470 Q500 520 600 560 Q700 590 712 650 L712 690 L290 690 Q280 600 290 470 Q296 300 300 140 Z" fill="url(#f)" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
  <path d="M290 684 L712 684 L712 706 L290 706 Z" fill="#3a3a3e"/>
  <path d="M292 706 L392 706 L386 770 L300 770 Z" fill="#2a2a2c" stroke="#000" stroke-width="2"/>
  <path d="M300 140 L470 140 L471 180 L299 180 Z" fill="#2c2c2f"/>
  <path d="M452 200 Q478 330 460 470" fill="none" stroke="#55555a" stroke-width="12" stroke-linecap="round"/>
  <path d="M452 200 Q478 330 460 470" fill="none" stroke="#1c1c1e" stroke-width="4" stroke-dasharray="10 8"/>
  <rect x="270" y="150" width="34" height="70" rx="10" fill="#2c2c2f" stroke="#000" stroke-width="2"/>
  ${fold('M330 220 Q322 420 320 650', '#7a7a80', 0.35, 8)}${fold('M540 560 Q630 580 690 630', '#7a7a80', 0.45, 6)}`, 860, 860)
}

function shoulderBag() {
  const c = '#1d1d1f'
  return svg(fabric('f', c, 0.3, -0.2), `
  <path d="M290 420 Q300 120 400 110 Q500 120 510 420" fill="none" stroke="${c}" stroke-width="26" stroke-linecap="round"/>
  <path d="M290 420 Q300 120 400 110 Q500 120 510 420" fill="none" stroke="#3c3c40" stroke-width="6" stroke-linecap="round" opacity="0.6"/>
  <path d="M180 420 L620 420 L660 760 Q400 790 140 760 Z" fill="url(#f)" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
  <path d="M176 420 L624 420 L636 560 Q400 620 164 560 Z" fill="#2a2a2d" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
  <rect x="372" y="560" width="56" height="34" rx="8" fill="#d4b062" stroke="#a7863f" stroke-width="2"/>
  <circle cx="276" cy="420" r="12" fill="#d4b062"/><circle cx="524" cy="420" r="12" fill="#d4b062"/>
  ${fold('M200 600 Q400 640 610 600', '#55555a', 0.4, 3)}`, 800, 860)
}

function belt() {
  const c = '#7a4a2a'
  return svg(fabric('f', c, 0.25, -0.2), `
  <ellipse cx="400" cy="420" rx="300" ry="190" fill="none" stroke="url(#f)" stroke-width="70"/>
  <ellipse cx="400" cy="420" rx="300" ry="190" fill="none" stroke="#4e2c15" stroke-width="2" stroke-dasharray="8 7" opacity="0.6" transform="translate(0 -24) scale(1 1)"/>
  <rect x="330" y="560" width="140" height="96" rx="18" fill="none" stroke="#d4b062" stroke-width="16"/>
  <path d="M400 568 L400 646" stroke="#d4b062" stroke-width="10" stroke-linecap="round"/>
  ${[150, 200, 250].map(x => `<circle cx="${x}" cy="${430 + (x - 150) * 0.6}" r="7" fill="#3a2010"/>`).join('')}`, 800, 760)
}

export const BASICS = [
  { file: 'white-tee', svg: tee('#f6f6f3'), category: 'top', kind: 't-shirt', name: 'White crew-neck tee', colors: ['white'], seasons: ['spring', 'summer', 'autumn'], styles: ['casual', 'minimal'], occasions: ['everyday', 'travel', 'home'] },
  { file: 'black-turtleneck', svg: longsleeve('#1d1d1f', { turtle: true }), category: 'top', kind: 'turtleneck', name: 'Black fine-knit turtleneck', colors: ['black'], seasons: ['autumn', 'winter'], styles: ['minimal', 'classic', 'elegant'], occasions: ['everyday', 'work', 'evening'] },
  { file: 'blue-oxford', svg: shirt('#bcd3ee'), category: 'top', kind: 'shirt', name: 'Light blue oxford shirt', colors: ['light-blue'], seasons: ['spring', 'summer', 'autumn'], styles: ['classic', 'business'], occasions: ['work', 'everyday'] },
  { file: 'grey-sweater', svg: longsleeve('#a7a9ad', { rib: true }), category: 'top', kind: 'sweater', name: 'Grey crew-neck sweater', colors: ['grey'], seasons: ['autumn', 'winter'], styles: ['casual', 'minimal'], occasions: ['everyday', 'work'] },
  { file: 'beige-cardigan', svg: cardigan('#e3d3b8'), category: 'top', kind: 'cardigan', name: 'Oatmeal V-neck cardigan', colors: ['beige'], seasons: ['spring', 'autumn'], styles: ['casual', 'romantic'], occasions: ['everyday', 'work'] },
  { file: 'straight-jeans', svg: jeans('#5d7fa8'), category: 'bottom', kind: 'jeans', name: 'Mid-blue straight jeans', colors: ['denim'], seasons: ['spring', 'summer', 'autumn', 'winter'], styles: ['casual'], occasions: ['everyday', 'travel'] },
  { file: 'black-trousers', svg: trousers('#232325'), category: 'bottom', kind: 'trousers', name: 'Black tailored trousers', colors: ['black'], seasons: ['spring', 'autumn', 'winter'], styles: ['classic', 'business', 'minimal'], occasions: ['work', 'evening'] },
  { file: 'beige-skirt', svg: skirt('#cdb594'), category: 'bottom', kind: 'skirt', name: 'Camel pleated midi skirt', colors: ['camel'], seasons: ['spring', 'autumn'], styles: ['elegant', 'romantic'], occasions: ['work', 'date'] },
  { file: 'slip-dress', svg: slipDress('#1e1e22'), category: 'dress', kind: 'midi dress', name: 'Black satin slip dress', colors: ['black'], seasons: ['summer', 'spring'], styles: ['elegant', 'minimal'], occasions: ['evening', 'party', 'date'] },
  { file: 'trench', svg: trench('#cbb08a'), category: 'outerwear', kind: 'trench coat', name: 'Classic beige trench coat', colors: ['beige'], seasons: ['spring', 'autumn'], styles: ['classic', 'elegant'], occasions: ['everyday', 'work', 'travel'] },
  { file: 'black-blazer', svg: blazer('#1f1f22'), category: 'outerwear', kind: 'blazer', name: 'Black single-breasted blazer', colors: ['black'], seasons: ['spring', 'autumn', 'winter'], styles: ['classic', 'business'], occasions: ['work', 'evening'] },
  { file: 'white-sneakers', svg: sneakers(), category: 'shoes', kind: 'sneakers', name: 'White leather sneakers', colors: ['white'], seasons: ['spring', 'summer', 'autumn'], styles: ['casual', 'minimal', 'sporty'], occasions: ['everyday', 'travel'] },
  { file: 'ankle-boots', svg: ankleBoots(), category: 'shoes', kind: 'ankle boots', name: 'Black leather ankle boots', colors: ['black'], seasons: ['autumn', 'winter'], styles: ['classic', 'edgy'], occasions: ['everyday', 'work', 'evening'] },
  { file: 'shoulder-bag', svg: shoulderBag(), category: 'bag', kind: 'shoulder bag', name: 'Black leather shoulder bag', colors: ['black', 'gold'], seasons: ['spring', 'summer', 'autumn', 'winter'], styles: ['classic', 'minimal'], occasions: ['everyday', 'work', 'evening'] },
  { file: 'brown-belt', svg: belt(), category: 'accessory', kind: 'belt', name: 'Brown leather belt', colors: ['brown', 'gold'], seasons: ['spring', 'summer', 'autumn', 'winter'], styles: ['classic', 'casual'], occasions: ['everyday', 'work'] },
]

async function render(item, max) {
  const img = sharp(Buffer.from(item.svg), { density: 216 }).trim()
  const buf = await img.png().toBuffer()
  const { width, height } = await sharp(buf).metadata()
  const pad = Math.round(Math.max(width, height) * 0.04)
  return sharp(buf).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(max, max, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toBuffer()
}

const [cmd, dir] = process.argv.slice(2)
if (cmd === 'preview') {
  mkdirSync(dir, { recursive: true })
  for (const it of BASICS) writeFileSync(`${dir}/${it.file}.webp`, await render(it, 600))
  console.log('saved', BASICS.length)
} else {
  for (const line of existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split('\n') : []) {
    const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2]
  }
  const sb = createClient('https://ajbdkvpyhoyzzzlrlttk.supabase.co', 'sb_publishable_zyycYXIPLQCCxPsccMttlQ_SglhZaMg')
  const { data: s } = await sb.auth.signInWithPassword({ email: process.env.CAPSULE_EMAIL, password: process.env.CAPSULE_PASSWORD })
  const { data: have } = await sb.from('items').select('name')
  for (const it of [...BASICS].reverse()) {
    if (have.some(h => h.name === it.name)) { console.log('skip', it.name); continue }
    const id = crypto.randomUUID()
    const photo_path = `${s.user.id}/${id}.webp`, thumb_path = `${s.user.id}/${id}_thumb.webp`
    await sb.storage.from('photos').upload(photo_path, await render(it, 1600), { contentType: 'image/webp' })
    await sb.storage.from('photos').upload(thumb_path, await render(it, 600), { contentType: 'image/webp' })
    const { file, svg, ...row } = it
    const r = await sb.from('items').insert({ ...row, photo_path, thumb_path, notes: 'Test item (illustration)' })
    console.log(r.error ? 'ERROR ' + r.error.message : 'added', it.name)
  }
}
