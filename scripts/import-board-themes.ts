/**
 * Imports Chess.com boards and piece sets from a checkout of
 * https://github.com/GiorgioMegrelli/chess.com-boards-and-pieces
 *
 *   npx tsx scripts/import-board-themes.ts /path/to/chess.com-boards-and-pieces
 *
 * Writes resized WebP files to public/themes and metadata to src/board-themes.json.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = process.argv[2]
if (!source || !existsSync(join(source, 'default-config.json'))) {
  console.error('Pass the path to a chess.com-boards-and-pieces checkout.')
  process.exit(1)
}

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'public/themes')
const config = JSON.parse(await readFile(join(source, 'default-config.json'), 'utf8')) as {
  boards: { collections: Record<string, { readable_name: string }> }
  pieces: { collections: Record<string, { readable_name: string }> }
}
const PIECES = ['wk', 'wq', 'wr', 'wb', 'wn', 'wp', 'bk', 'bq', 'br', 'bb', 'bn', 'bp']
// Limited-time event and promo themes that clutter the picker.
const SKIP = new Set(['bju81', 'z4m3d', 'my2xa', 'ohdxn', 'ca09k'])

await rm(out, { recursive: true, force: true })
await mkdir(join(out, 'boards'), { recursive: true })

/** Average colour of the middle of one square, as #rrggbb. */
async function squareColor(file: string, column: number, row: number): Promise<string> {
  const image = sharp(file)
  const { width = 0 } = await image.metadata()
  const square = width / 8
  const inset = Math.round(square * 0.3)
  const { data } = await sharp(file)
    .extract({
      left: Math.round(column * square) + inset,
      top: Math.round(row * square) + inset,
      width: Math.round(square) - inset * 2,
      height: Math.round(square) - inset * 2,
    })
    .removeAlpha()
    .resize(1, 1, { kernel: 'cubic' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return `#${[...data.subarray(0, 3)].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

const boards = []
for (const [id, { readable_name: name }] of Object.entries(config.boards.collections)) {
  const file = join(source, 'boards', `${id}.png`)
  if (SKIP.has(id) || !existsSync(file)) continue
  await sharp(file).resize(1024, 1024).webp({ quality: 82 }).toFile(join(out, 'boards', `${id}.webp`))
  await sharp(file).resize(128, 128).webp({ quality: 80 }).toFile(join(out, 'boards', `${id}-thumb.webp`))
  // a8 is a light square and b8 a dark one.
  boards.push({ id, name, light: await squareColor(file, 0, 0), dark: await squareColor(file, 1, 0) })
}

const pieces = []
for (const [id, { readable_name: name }] of Object.entries(config.pieces.collections)) {
  const directory = join(source, 'pieces', id)
  if (SKIP.has(id) || !PIECES.every(piece => existsSync(join(directory, `${piece}.png`)))) continue
  await mkdir(join(out, 'pieces', id), { recursive: true })
  for (const piece of PIECES) {
    await sharp(join(directory, `${piece}.png`)).webp({ quality: 90, alphaQuality: 100 }).toFile(join(out, 'pieces', id, `${piece}.webp`))
  }
  pieces.push({ id, name })
}

await writeFile(join(root, 'src/board-themes.json'), `${JSON.stringify({ boards, pieces }, null, 2)}\n`)
console.log(`${boards.length} boards, ${pieces.length} piece sets`)
