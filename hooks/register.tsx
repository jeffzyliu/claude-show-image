// show-image: draw PNGs in the Claude Code window.
//
// How a picture reaches the screen: this mod never writes terminal escape codes. It gives the engine an
// `Image` element, and the engine paints it with whatever the terminal supports:
//   - Ghostty, kitty: the kitty graphics protocol, inline, no setup.
//   - iTerm2 3.5+: iTerm2's inline images, but only under Claude Code's fullscreen rendering.
//   - tmux: only with `allow-passthrough` and `focus-events` on, inside one of the terminals above.
//   - anything else (Terminal.app, VS Code's terminal, ...): the element draws its `alt` text instead.
//     The pane then has an "open e" button that hands the file to the system viewer (open / xdg-open).
// The mod cannot ask which terminal it is in, so every picture is always sent and the engine decides.
//
// Where pictures show up:
//   - Inline under any tool row whose result holds PNG image blocks (e.g. dofile graphs), folded or not.
//   - Inline under the `/img` output row and the `show_image` tool row.
//   - In a pane with zoom and pan (/img --pane, or the `openPane` option).
// PNG only, under 2 MiB, up to 5 per row: that is what `Image` accepts.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Img, View } from '../types'

const PANE = 'show-image'
const MAX_IMGS = 5
const MAX_BYTES = 2 * 1024 * 1024 // the most `Image` takes as bytes held by the plugin, on every terminal
const view = atom({ plugin: 'show-image', key: 'view' } as const, { zoom: 1, panX: 0, panY: 0 } as View, {
  shape: 'view-2',
})
// Fallback for terminals that can't draw inline images (see the header): hand the file to the system viewer.
async function openExternally($: any, img: Img) {
  let path = img.path
  if (!path) {
    // no file behind it (tool result, pasted base64): decode to a temp file first
    path = `/tmp/show-image-${img.png.slice(-24).replace(/[^A-Za-z0-9]/g, '')}.png`
    await $.process.run(['sh', '-c', 'base64 -d > "$1"', 'sh', path], { stdin: img.png })
  }
  for (const cmd of ['open', 'xdg-open']) {
    try {
      const r = await $.process.run([cmd, path])
      if (r.exitCode === 0) return
    } catch {} // shortcut: no Windows 'start'; add it when someone asks
  }
  $.ui.toast(`Could not open ${path}`)
}

const image = atom({ plugin: 'show-image', key: 'image' } as const, null, {
  shape: 'image-2',
})

// The inline button: the same as `/img --pane` for a picture that is already loaded.
async function openPane($: any, img: Img) {
  await update($, image, () => img)
  await update($, view, () => ({ zoom: 1, panX: 0, panY: 0 }))
  await $.ui.open({ id: PANE, title: 'Image' })
}

// Reads the PNG's size from its header. shortcut: PNG only (`Image` takes PNG or raw RGBA on every terminal); JPEG/GIF would need a decoder, convert first.
function parsePng(base64: string, label: string): Img {
  const b64 = base64.replace(/^data:image\/png;base64,/, '').replace(/\s+/g, '')
  const head = Uint8Array.fromBase64(b64.slice(0, 64)) // 48 bytes: signature + IHDR
  const sig = [0x89, 0x50, 0x4e, 0x47]
  if (head.length < 24 || sig.some((v, i) => head[i] !== v))
    throw new Error('not a PNG (only PNG is supported)')
  if ((b64.length * 3) / 4 > MAX_BYTES) throw new Error('PNG is over 2 MiB')
  const dv = new DataView(head.buffer, head.byteOffset)
  return { png: b64, width: dv.getUint32(16), height: dv.getUint32(20), label }
}

async function load($: any, input: { path?: string; base64?: string }): Promise<Img> {
  if (input.base64) return parsePng(input.base64, 'base64 image')
  if (!input.path) throw new Error('give a path or base64 PNG data')
  const src = /\.svg$/i.test(input.path) ? await svgToPng($, input.path) : input.path
  const { base64 } = await $.fs.read(src, { as: 'bytes' })
  return { ...parsePng(base64, input.path), path: input.path }
}

// shortcut: SVG is rasterized by an installed converter (rsvg-convert, then ImageMagick); none installed -> error.
// 1600 px wide is plenty for the inline and pane views and stays well under 2 MiB for typical charts.
async function svgToPng($: any, path: string): Promise<string> {
  const tag = path.replace(/[^A-Za-z0-9]/g, '').slice(-40)
  const out = `/tmp/show-image-${tag}.png`
  // rsvg and ImageMagick ignore CSS custom properties (fill: var(--surface)) and paint black: inline the :root values first
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  const text = new TextDecoder().decode(Uint8Array.fromBase64(base64))
  if (text.includes('var(--')) {
    const vars: Record<string, string> = {}
    // shortcut: the first :root block only (the light theme); no @media or per-element overrides
    for (const m of (/:root\s*\{([^}]*)\}/.exec(text)?.[1] ?? '').matchAll(/--([\w-]+)\s*:\s*([^;]+)/g)) vars[m[1]] = m[2].trim()
    const flat = text.replace(/var\(--([\w-]+)(?:\s*,\s*([^)]*))?\)/g, (all, n, fallback) => vars[n] ?? fallback ?? all)
    const flatPath = `/tmp/show-image-${tag}.svg`
    await $.process.run(['sh', '-c', 'base64 -d > "$1"', 'sh', flatPath], { stdin: new TextEncoder().encode(flat).toBase64() })
    path = flatPath
  }
  const attempts = [
    ['rsvg-convert', '-w', '1600', path, '-o', out],
    ['magick', '-background', 'none', '-density', '192', path, '-resize', '1600x>', out],
    ['convert', '-background', 'none', '-density', '192', path, '-resize', '1600x>', out],
  ]
  for (const cmd of attempts) {
    try {
      const r = await $.process.run(cmd)
      if (r.exitCode === 0) return out
    } catch {} // converter not installed: try the next
  }
  throw new Error('cannot read SVG: install rsvg-convert (brew install librsvg) or ImageMagick')
}

async function show($: any, input: { path?: string; base64?: string }, isPane: boolean): Promise<string> {
  const img = await load($, input)
  await update($, image, () => img)
  await update($, view, () => ({ zoom: 1, panX: 0, panY: 0 }))
  if (isPane) await $.ui.open({ id: PANE, title: 'Image' })

  return `Showing ${img.label} (${img.width}x${img.height})${isPane ? ' in the Image pane' : ''}.`
}

// Inline in the conversation: under the show_image tool row and the /img output row.
// Drawn by the terminal's own image protocol where it has one (Ghostty, kitty, iTerm2 3.5+ fullscreen), else alt text.
// Rows are redrawn often, so each picture is read once (shortcut: cache never evicts).
const cache = new Map<string, Img | null>()

async function inlineImg($: any, key: string, input: { path?: string; base64?: string }) {
  if (!cache.has(key))
    cache.set(key, await load($, input).catch(() => null))

  return cache.get(key) ?? null
}

type ToolInput = { path?: string; base64?: string; paths?: string[] }
// The pictures a show_image call names: `paths` if given, else the single path/base64.
const sources = (i: ToolInput) => (i.paths?.length ? i.paths.map(path => ({ path })) : [i])

function under(e: any, $: any, row: any, imgs: Img[]) {
  if (imgs.length === 0) return row
  const { Box, Image, Button } = $.ui.resolve(e)
  const avail = Math.max(10, (e.viewport?.columns ?? 80) - 6)
  // side by side only when each picture still gets 40+ columns (80 max each); else stacked with a blank line between
  const per = Math.min(80, Math.floor((avail - (imgs.length - 1)) / imgs.length))
  const side = imgs.length > 1 && per >= 40
  const maxCols = side ? per : Math.min(80, avail)
  // fit each picture in maxCols x 24 rows, keeping its aspect (a cell is about twice as tall as wide)
  const fit = (img: Img) => {
    let columns = Math.max(1, Math.min(maxCols, img.width)) // never upscale past the pixel width
    let rows = Math.max(1, Math.round((columns * img.height) / img.width / 2))
    if (rows > 24) {
      rows = 24
      columns = Math.max(1, Math.min(columns, Math.round((rows * 2 * img.width) / img.height)))
    }
    return { columns, rows }
  }

  return (
    <Box flexDirection="column">
      {row}
      <Box flexDirection={side ? 'row' : 'column'}>
        {imgs.map((img, i) => (
          <Box key={`img${i}`} flexDirection="column" marginLeft={side && i > 0 ? 1 : 0} marginTop={!side && i > 0 ? 1 : 0}>
            <Image
              source={{ png: img.png }}
              columns={fit(img).columns}
              rows={fit(img).rows}
              alt={`${img.label} (this terminal cannot draw images inline, or the session was started from a different terminal than this one; see the pane's open button or /img --pane)`}
            />
            <Button key={`open${i}`} label="open in tab" onPress={() => openPane($, img)} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// PNG image blocks of any tool's stored result (checked by shape, not by tool name, so any MCP server's graphs work): [{ type: 'image', source: { type: 'base64', media_type, data } }, ...]
function pngBlocks(output: unknown): Img[] {
  if (!Array.isArray(output)) return []
  const found: Img[] = []
  for (const b of output) {
    const src = b?.type === 'image' ? b.source : null
    if (src?.type !== 'base64' || src.media_type !== 'image/png') continue
    try {
      found.push(parsePng(src.data, 'tool image'))
    } catch {} // shortcut: a PNG over 2 MiB or a bad one is skipped; JPEG is not drawn
  }

  return found.slice(0, MAX_IMGS)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'img',
      description: 'Show a PNG inline (add --pane for a zoom/pan pane): /img [--pane] <path|base64>',
      argumentHint: '[--pane] <path|base64>',
    })
    await $.tool.register({
      name: 'show_image',
      description:
        'Show a PNG image to the user, inline under this tool call (or in a pane if the user turned that on). Works in terminals with inline images (Ghostty, kitty, iTerm2 3.5+ fullscreen); elsewhere the user sees only alt text and an open-in-viewer button. Give a file path, or up to 5 in paths (cheap) or base64 PNG data (costly: you would have to write it out).',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'PNG file path' },
          base64: { type: 'string', description: 'base64 PNG data' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: MAX_IMGS,
            description: `Up to ${MAX_IMGS} PNG file paths to show together (instead of path)`,
          },
        },
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('command.run', { command: 'img' }, async ($, e) => {
    const raw = String(e.args ?? '')
    const isPane = options.openPane === true || /(^|\s)--pane(\s|$)/.test(raw)
    const arg = raw.replace(/(^|\s)--pane(\s|$)/g, ' ').trim().replace(/^["'`]+|["'`.,;]+$/g, '')
    try {
      // a PNG's base64 starts "iVBOR"; anything else is a path
      return { text: await show($, arg.startsWith('iVBOR') || arg.startsWith('data:') ? { base64: arg } : { path: arg }, isPane) }
    } catch (err) {
      return { text: `/img: ${(err as Error).message}` }
    }
  })

  on('tool.call', { tool: 'mcp__show-image__show_image' }, async ($, e) => {
    try {
      const input = e as unknown as ToolInput
      const list = sources(input)
      if (list.length > MAX_IMGS) throw new Error(`at most ${MAX_IMGS} images`)
      for (const src of list.slice(1)) await load($, src) // validate the rest; the pane shows the first
      const text = await show($, list[0] ?? {}, options.openPane === true)
      return { result: list.length > 1 ? `${text} (+${list.length - 1} more shown inline)` : text }
    } catch (err) {
      return { deny: (err as Error).message }
    }
  })

  // The body's size as last drawn, so a wheel tick can clamp the pan like a button does.
  let body = { cols: 76, rows: 20 }

  const layout = (img: Img, zoom: number, bodyCols: number, bodyRows: number) => {
    // fit the whole picture in the body less the two rows of header and buttons;
    // a cell is about twice as tall as wide
    const viewRows = Math.max(3, bodyRows - 3)
    let fitCols = Math.max(4, bodyCols)
    let fitRows = Math.round((fitCols * img.height) / img.width / 2)
    if (fitRows > viewRows) {
      fitRows = viewRows
      fitCols = Math.max(1, Math.round((fitRows * 2 * img.width) / img.height))
    }
    const clamp = (n: number) => Math.max(1, Math.min(255, Math.round(n)))
    const columns = clamp(fitCols * zoom)
    const rows = clamp(Math.max(1, fitRows) * zoom)
    return { columns, rows, viewRows, maxX: Math.max(0, columns - bodyCols), maxY: Math.max(0, rows - viewRows) }
  }

  // The wheel or a two-finger vertical swipe pans the picture instead of the pane's rows.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const img = await read($, image)
    if (!img) return {}
    await update($, view, v => {
      const { maxY } = layout(img, v.zoom, body.cols, body.rows)
      return { ...v, panY: Math.max(0, Math.min(maxY, v.panY + e.by * 2)) }
    })

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const img = await read($, image)
    if (!img) return <Text dimColor>No image yet. Use /img --pane &lt;path&gt;.</Text>
    const v = await read($, view)
    const bodyCols = e.props.bodyColumns || (e.viewport?.columns ?? 80) - 4
    const bodyRows = e.props.scroll?.bodyRows || (e.viewport?.rows ?? 24) - 5
    body = { cols: bodyCols, rows: bodyRows }
    const L = layout(img, v.zoom, bodyCols, bodyRows)
    const x = Math.min(v.panX, L.maxX)
    const y = Math.min(v.panY, L.maxY)
    const zoomTo = (z: number) => update($, view, () => ({ zoom: Math.max(0.25, Math.min(8, z)), panX: 0, panY: 0 }))
    const pan = (dx: number, dy: number) =>
      update($, view, s => ({
        ...s,
        panX: Math.max(0, Math.min(L.maxX, s.panX + dx)),
        panY: Math.max(0, Math.min(L.maxY, s.panY + dy)),
      }))

    return (
      <Box flexDirection="column">
        <Text dimColor>{img.label} {img.width}x{img.height}, zoom {Math.round(v.zoom * 100)}%</Text>
        <Box flexWrap="wrap">
          <Button key="zin" label="+ i" hotkey="i" onPress={() => zoomTo(v.zoom * 1.5)} />
          <Button key="zout" label="- o" hotkey="o" onPress={() => zoomTo(v.zoom / 1.5)} />
          <Button key="fit" label="fit 0" hotkey="0" onPress={() => zoomTo(1)} />
          <Button key="left" label="< h" hotkey="h" onPress={() => pan(-10, 0)} />
          <Button key="down" label="v j" hotkey="j" onPress={() => pan(0, 3)} />
          <Button key="up" label="^ k" hotkey="k" onPress={() => pan(0, -3)} />
          <Button key="right" label="> l" hotkey="l" onPress={() => pan(10, 0)} />
          <Button key="open" label="open e" hotkey="e" onPress={() => openExternally($, img)} />
        </Box>
        <Box overflow="hidden" width={bodyCols} height={L.viewRows}>
          <Box marginLeft={-x} marginTop={-y}>
            <Image source={{ png: img.png }} columns={L.columns} rows={L.rows} alt={`${img.label}: this terminal cannot draw images inline (Ghostty, kitty and iTerm2 3.5+ in fullscreen can)${img.path ? '; press e to open it' : ''}`} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.tool !== 'mcp__show-image__show_image') return under(e, $, row, pngBlocks(e.props.output))
    if (options.openPane === true) return row
    const imgs: Img[] = []
    for (const src of sources((e.props.input ?? {}) as ToolInput).slice(0, MAX_IMGS)) {
      const key = src.path ?? (src.base64 ? src.base64.slice(-64) : '')
      const img = key ? await inlineImg($, key, src) : null
      if (img) imgs.push(img)
    }

    return under(e, $, row, imgs)
  })

  // A folded run of tool calls is one line: draw the calls' pictures under it.
  // Expanded, each call is a ToolUse row that draws its own.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.isExpanded) return row

    return under(e, $, row, e.props.calls.flatMap(c => pngBlocks(c.output)).slice(0, MAX_IMGS))
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const row = await next(e)
    if (e.props.command !== 'img') return row
    // args arrive empty for a plugin command; the row's own text names the source
    const arg = /Showing (.+?) \(\d+x\d+\)/.exec(String(e.props.text ?? ''))?.[1] ?? ''
    // the pane shows it: the row's text says so, and --pane means no inline copy
    if (e.props.isErrored || !arg || String(e.props.text).includes('in the Image pane')) return row

    const img = await inlineImg($, arg, arg.startsWith('iVBOR') ? { base64: arg } : { path: arg })

    return under(e, $, row, img ? [img] : [])
  })
}
