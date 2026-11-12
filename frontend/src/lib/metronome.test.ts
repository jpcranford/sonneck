import { describe, expect, it } from 'vitest'
import {
  clickSound,
  clampBpm,
  markingFor,
  nextLevel,
  parseBpm,
  resizeBeats,
  seedMetronome,
  tapTempo,
  TAP_AVERAGE_GAPS,
  TAP_RESET_MS,
} from './metronome'

describe('markingFor', () => {
  it('names the marking a tempo falls under', () => {
    expect(markingFor(30)).toBe('Largo')
    expect(markingFor(60)).toBe('Adagio')
    expect(markingFor(80)).toBe('Andante')
    expect(markingFor(130)).toBe('Allegro')
    expect(markingFor(300)).toBe('Presto')
  })
  it('gives each marking its own tempo back', () => {
    for (const [name, bpm] of [
      ['Largo', 50],
      ['Moderato', 110],
      ['Vivace', 156],
    ] as const)
      expect(markingFor(bpm)).toBe(name)
  })
})

describe('clampBpm and parseBpm', () => {
  it('keeps a tempo in range, whole', () => {
    expect(clampBpm(10)).toBe(30)
    expect(clampBpm(999)).toBe(300)
    expect(clampBpm(80.6)).toBe(81)
  })
  it('reads digits only, or nothing', () => {
    expect(parseBpm('132')).toBe(132)
    expect(parseBpm(' 9a9 ')).toBe(99)
    expect(parseBpm('5')).toBe(30)
    expect(parseBpm('')).toBeNull()
    expect(parseBpm('abc')).toBeNull()
  })
})

describe('nextLevel', () => {
  it('goes played → accented → silent → played', () => {
    expect(nextLevel(1)).toBe(2)
    expect(nextLevel(2)).toBe(0)
    expect(nextLevel(0)).toBe(1)
  })
})

describe('resizeBeats', () => {
  it('keeps the levels already set and adds played beats', () => {
    expect(resizeBeats([2, 0, 1], 5)).toEqual([2, 0, 1, 1, 1])
    expect(resizeBeats([2, 0, 1], 2)).toEqual([2, 0])
  })
  it('stays between 1 and 12 beats', () => {
    expect(resizeBeats([2], 0)).toEqual([2])
    expect(resizeBeats([2], 20)).toHaveLength(12)
  })
})

describe('seedMetronome', () => {
  it('starts from the piece’s own tempo and beats, beat 1 accented', () => {
    expect(seedMetronome({ bpm: 80, beatsPerMeasure: 3 })).toEqual({
      bpm: 80,
      levels: [2, 1, 1],
      subdivision: 1,
    })
  })
  it('falls back to 100 BPM and 4 beats', () => {
    expect(seedMetronome({ bpm: null, beatsPerMeasure: null })).toEqual({
      bpm: 100,
      levels: [2, 1, 1, 1],
      subdivision: 1,
    })
  })
  it('keeps a stored tempo or beat count in range', () => {
    expect(seedMetronome({ bpm: 400, beatsPerMeasure: 16 }).bpm).toBe(300)
    expect(seedMetronome({ bpm: 400, beatsPerMeasure: 16 }).levels).toHaveLength(12)
  })
})

describe('tapTempo', () => {
  const tapAt = (times: number[]) =>
    times.reduce<{ taps: number[]; bpm: number | null }>((s, t) => tapTempo(s.taps, t), {
      taps: [],
      bpm: null,
    })

  it('needs two taps', () => {
    expect(tapAt([0]).bpm).toBeNull()
    expect(tapAt([0, 500]).bpm).toBe(120)
  })
  it('averages several gaps, so one uneven tap barely moves it', () => {
    // Steady at 600ms (100 BPM) with one tap 120ms late.
    expect(tapAt([0, 600, 1200, 1920, 2400, 3000]).bpm).toBe(100)
  })
  it('uses only the latest gaps', () => {
    const slow = Array.from({ length: 5 }, (_, i) => i * 1000)
    const fast = Array.from({ length: TAP_AVERAGE_GAPS + 1 }, (_, i) => 4500 + i * 500)
    const result = tapAt([...slow, ...fast])
    expect(result.bpm).toBe(120)
    expect(result.taps).toHaveLength(TAP_AVERAGE_GAPS + 1)
  })
  it('starts over after a pause', () => {
    const result = tapAt([0, 500, 1000 + TAP_RESET_MS + 1])
    expect(result.bpm).toBeNull()
    expect(result.taps).toHaveLength(1)
  })
})

describe('clickSound', () => {
  it('gives a beat its tile’s sound and the clicks between beats a quieter one', () => {
    expect(clickSound(2, 0)).toBe('accent')
    expect(clickSound(1, 0)).toBe('beat')
    expect(clickSound(2, 1)).toBe('between')
    expect(clickSound(1, 3)).toBe('between')
  })
  it('silences every click of a silent beat', () => {
    expect(clickSound(0, 0)).toBeNull()
    expect(clickSound(0, 2)).toBeNull()
  })
})
