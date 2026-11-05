export type View = { zoom: number; panX: number; panY: number }
export type Img = { png: string; width: number; height: number; label: string; path?: string }

declare module 'claude-code' {
  interface PluginState {
    'show-image': { image: Shaped<Img | null>; view: Shaped<View> }
  }
}
