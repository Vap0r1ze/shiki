import { join, dirpathparts } from './utils'
import type { IOnigLib, IRawGrammar, IRawTheme } from 'vscode-textmate'
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma'
import { parse, ParseError } from 'jsonc-parser'
import type { IShikiTheme } from './types'

// to be replaced by rollup
let CDN_ROOT = '__CDN_ROOT__'
let WASM: ArrayBuffer = new ArrayBuffer(0)

export function isURL(string: string) {
  try {
    new URL(string)
    return true
  } catch {
    return false
  }
}
export function joinURL(urlStr, path) {
  const url = new URL(urlStr)
  url.pathname = join(dirpathparts(url.pathname).join('/'), path)
  return url.toString()
}

/**
 * Set the route for loading the assets
 * URL should end with `/`
 *
 * For example:
 * ```ts
 * setCDN('https://unpkg.com/shiki/') // use unpkg
 * setCDN('/assets/shiki/') // serve by yourself
 * ```
 */
export function setCDN(root: string) {
  CDN_ROOT = root
}

/**
 * Explicitly set the source for loading the oniguruma web assembly module.
 *
 * Accepts Url or ArrayBuffer
 */
export function setWasm(path: ArrayBuffer) {
  WASM = path
}

let _onigurumaPromise: Promise<IOnigLib> = null

export async function getOniguruma(): Promise<IOnigLib> {
  if (!_onigurumaPromise) {
    const loader: Promise<void> = loadWASM(WASM)

    _onigurumaPromise = loader.then(() => {
      return {
        createOnigScanner(patterns: string[]) {
          return createOnigScanner(patterns)
        },
        createOnigString(s: string) {
          return createOnigString(s)
        }
      }
    })
  }
  return _onigurumaPromise
}

function _resolvePath(filepath: string) {
  if (!CDN_ROOT) {
    console.warn(
      '[Shiki] no CDN provider found, use `setCDN()` to specify the CDN for loading the resources before calling `getHighlighter()`'
    )
  }
  return `${CDN_ROOT}${filepath}`
}

/**
 * @param filepath assert path related to ./packages/shiki
 */
async function _fetchAssets(filepath: string): Promise<string> {
  if (isURL(filepath)) {
    return await fetch(filepath).then(r => r.text())
  }

  const path = _resolvePath(filepath)
  return await fetch(path).then(r => r.text())
}

async function _fetchJSONAssets(filepath: string) {
  const errors: ParseError[] = []
  const rawTheme = parse(await _fetchAssets(filepath), errors, {
    allowTrailingComma: true
  })

  if (errors.length) {
    throw errors[0]
  }

  return rawTheme
}

/**
 * @param themePath related path to theme.json
 */
export async function fetchTheme(themePath: string): Promise<IShikiTheme> {
  let theme: IRawTheme = await _fetchJSONAssets(themePath)

  const shikiTheme = toShikiTheme(theme)

  if (shikiTheme.include) {
    const includedThemePath = isURL(themePath)
      ? joinURL(themePath, shikiTheme.include)
      : join(dirpathparts(themePath).join('/'), shikiTheme.include)
    const includedTheme = await fetchTheme(includedThemePath)

    if (includedTheme.settings) {
      shikiTheme.settings = includedTheme.settings.concat(shikiTheme.settings)
    }

    if (includedTheme.bg && !shikiTheme.bg) {
      shikiTheme.bg = includedTheme.bg
    }

    if (includedTheme.colors) {
      shikiTheme.colors = { ...includedTheme.colors, ...shikiTheme.colors }
    }

    delete shikiTheme.include
  }

  return shikiTheme
}

export async function fetchGrammar(filepath: string): Promise<IRawGrammar> {
  return await _fetchJSONAssets(filepath)
}

export function repairTheme(theme: IShikiTheme) {
  // Has the default no-scope setting with fallback colors
  if (!theme.settings) theme.settings = []

  if (theme.settings[0] && theme.settings[0].settings && !theme.settings[0].scope) {
    return
  }

  // Push a no-scope setting with fallback colors
  theme.settings.unshift({
    settings: {
      foreground: theme.fg,
      background: theme.bg
    }
  })
}

export function toShikiTheme(rawTheme: IRawTheme): IShikiTheme {
  const type = (<any>rawTheme).type || 'dark'

  const shikiTheme: IShikiTheme = {
    name: rawTheme.name!,
    type,
    ...rawTheme,
    ...getThemeDefaultColors(rawTheme)
  }

  if ((<any>rawTheme).include) {
    shikiTheme.include = (<any>rawTheme).include
  }
  if ((<any>rawTheme).tokenColors) {
    shikiTheme.settings = (<any>rawTheme).tokenColors
    delete (<any>shikiTheme).tokenColors
  }

  repairTheme(shikiTheme)

  return shikiTheme
}

/**
 * https://github.com/microsoft/vscode/blob/f7f05dee53fb33fe023db2e06e30a89d3094488f/src/vs/platform/theme/common/colorRegistry.ts#L258-L268
 */
const VSCODE_FALLBACK_EDITOR_FG = { light: '#333333', dark: '#bbbbbb' }
const VSCODE_FALLBACK_EDITOR_BG = { light: '#fffffe', dark: '#1e1e1e' }

function getThemeDefaultColors(theme: IRawTheme & { type?: string }): { fg: string; bg: string } {
  let fg, bg

  /**
   * First try:
   * Theme might contain a global `tokenColor` without `name` or `scope`
   * Used as default value for foreground/background
   */
  let settings = theme.settings ? theme.settings : (<any>theme).tokenColors
  const globalSetting = settings
    ? settings.find(s => {
        return !s.name && !s.scope
      })
    : undefined

  if (globalSetting?.settings?.foreground) {
    fg = globalSetting.settings.foreground
  }
  if (globalSetting?.settings?.background) {
    bg = globalSetting.settings.background
  }

  /**
   * Second try:
   * If there's no global `tokenColor` without `name` or `scope`
   * Use `editor.foreground` and `editor.background`
   */
  if (!fg && (<any>theme)?.colors?.['editor.foreground']) {
    fg = (<any>theme).colors['editor.foreground']
  }
  if (!bg && (<any>theme)?.colors?.['editor.background']) {
    bg = (<any>theme).colors['editor.background']
  }

  /**
   * Last try:
   * If there's no fg/bg color specified in theme, use default
   */
  if (!fg) {
    fg = theme.type === 'light' ? VSCODE_FALLBACK_EDITOR_FG.light : VSCODE_FALLBACK_EDITOR_FG.dark
  }
  if (!bg) {
    bg = theme.type === 'light' ? VSCODE_FALLBACK_EDITOR_BG.light : VSCODE_FALLBACK_EDITOR_BG.dark
  }

  return {
    fg,
    bg
  }
}
