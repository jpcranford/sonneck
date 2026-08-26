import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { toString } from 'mdast-util-to-string'
import { MUSIC_SHORTCODES, remarkMusicEmoji } from './musicEmoji'

function render(markdown: string): string {
  const processor = unified().use(remarkParse).use(remarkMusicEmoji)
  const tree = processor.parse(markdown)
  return toString(processor.runSync(tree))
}

describe('remarkMusicEmoji', () => {
  it('replaces every supported shortcode with its mapped character', () => {
    for (const [code, char] of Object.entries(MUSIC_SHORTCODES)) {
      expect(render(`:${code}:`)).toBe(char)
    }
  })

  it('replaces multiple shortcodes in the same line', () => {
    expect(render('Play :forte: then :flat: down to :piano:')).toBe(
      `Play ${MUSIC_SHORTCODES.forte} then ${MUSIC_SHORTCODES.flat} down to ${MUSIC_SHORTCODES.piano}`,
    )
  })

  it('leaves an unsupported :word: pattern untouched', () => {
    expect(render('See the :shrug: for details')).toBe('See the :shrug: for details')
  })

  it('leaves plain text with a single colon untouched', () => {
    expect(render('Tempo: Allegro')).toBe('Tempo: Allegro')
  })

  it('does not replace a shortcode shown inside an inline code span', () => {
    expect(render('Use `:flat:` to insert a flat symbol')).toBe(
      'Use :flat: to insert a flat symbol',
    )
  })

  it('does not replace a shortcode shown inside a fenced code block', () => {
    const result = render('```\n:forte:\n```')
    expect(result).toBe(':forte:')
  })

  it('resolves overlapping alias lengths correctly (## vs #)', () => {
    expect(render(':##:')).toBe(MUSIC_SHORTCODES.doublesharp)
    expect(render(':#:')).toBe(MUSIC_SHORTCODES.sharp)
  })
})
