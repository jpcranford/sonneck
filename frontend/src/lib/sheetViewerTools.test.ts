import { describe, expect, it } from 'vitest'
import { LAYER_COLORS, layerLabelColor, type PageLook } from './sheetViewerTools'

describe('layerLabelColor', () => {
  const dark = LAYER_COLORS[5].light
  it('puts a dark letter on Yellow, and on Ink once the page is inverted', () => {
    for (const look of ['light', 'dim', 'dark'] as PageLook[]) {
      expect(layerLabelColor(1, look)).toBe(dark)
    }
    expect(layerLabelColor(5, 'dark')).toBe(dark)
  })
  it('puts a white letter on every other dot', () => {
    for (const look of ['light', 'dim', 'dark'] as PageLook[]) {
      for (const layer of [0, 2, 3, 4]) expect(layerLabelColor(layer, look)).toBe('#ffffff')
    }
    expect(layerLabelColor(5, 'light')).toBe('#ffffff')
    expect(layerLabelColor(5, 'dim')).toBe('#ffffff')
  })
})
