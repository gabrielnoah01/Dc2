/**
 * Gera `build/icon.ico` (e um `icon.png` de brinde) sem depender de nenhuma
 * ferramenta externa: rasteriza o logo do Only à mão e escreve PNG + ICO
 * usando só `node:zlib`.
 *
 * Rode com: npm run icon
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const SIZES = [256, 128, 64, 48, 32, 16];
const SS = 4; // supersampling: 4x4 amostras por pixel = bordas suaves

// Paleta (mesma do tailwind.config.mjs)
const ACCENT_TOP = [0x7a, 0xa2, 0xff];
const ACCENT_BOTTOM = [0x3b, 0x62, 0xe0];
const INK = [0x0d, 0x0e, 0x12];

/** Desenha o logo em RGBA para um lado `size`. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const s = size * SS;
  const radius = s * 0.22; // canto arredondado do "squircle"
  const ringOuter = s * 0.33;
  const ringInner = s * 0.19;
  const cx = s / 2;
  const cy = s / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;

          if (!insideRoundedRect(px, py, s, radius)) continue;

          const dist = Math.hypot(px - cx, py - cy);
          const inRing = dist <= ringOuter && dist >= ringInner;

          if (inRing) {
            // O miolo do "O" é vazado até a cor de fundo do app.
            r += INK[0];
            g += INK[1];
            b += INK[2];
          } else {
            // Gradiente vertical do fundo.
            const t = py / s;
            r += ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * t;
            g += ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * t;
            b += ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * t;
          }
          a += 255;
        }
      }

      const samples = SS * SS;
      const offset = (y * size + x) * 4;
      const cover = a / samples;
      if (cover > 0) {
        // Média só entre as amostras cobertas — evita halo escuro na borda.
        const covered = a / 255;
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
      }
      pixels[offset + 3] = Math.round(cover);
    }
  }

  return pixels;
}

/** Retângulo com cantos arredondados, em coordenadas do supersample. */
function insideRoundedRect(x, y, size, radius) {
  const margin = size * 0.03;
  const min = margin;
  const max = size - margin;
  if (x < min || x > max || y < min || y > max) return false;

  const left = min + radius;
  const right = max - radius;
  const top = min + radius;
  const bottom = max - radius;

  const dx = x < left ? left - x : x > right ? x - right : 0;
  const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
  return dx * dx + dy * dy <= radius * radius;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // 10..12 = compressão/filtro/entrelaçamento padrão (0)

  // Cada linha leva um byte de filtro na frente (0 = nenhum).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const target = y * (size * 4 + 1);
    raw[target] = 0;
    pixels.copy(raw, target + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ICO

/** ICO com PNG embutido em cada tamanho (suportado do Windows Vista pra cima). */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;

  entries.forEach((entry, index) => {
    const at = index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size; // 0 significa 256
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // paleta
    directory[at + 3] = 0; // reservado
    directory.writeUInt16LE(1, at + 4); // planos
    directory.writeUInt16LE(32, at + 6); // bits por pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

// ---------------------------------------------------------------- main

mkdirSync(OUT_DIR, { recursive: true });

const entries = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }));
const ico = encodeIco([...entries].sort((a, b) => b.size - a.size));

writeFileSync(join(OUT_DIR, 'icon.ico'), ico);
writeFileSync(join(OUT_DIR, 'icon.png'), entries[0].png);

console.log(`icon.ico  ${(ico.length / 1024).toFixed(1)} KB  (${SIZES.join(', ')})`);
console.log(`icon.png  ${(entries[0].png.length / 1024).toFixed(1)} KB  (256x256)`);
