import { describe, expect, it } from 'vitest'
import { practiceHeading, type PracticeHeadingInput } from './practiceHeading'

// Wednesday 2026-11-25; a Monday-start week, Monday the 23rd to Sunday the 29th.
const today = '2026-11-25'
const weekDays = [
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
  '2026-11-28',
  '2026-11-29',
]
const gig = { name: 'Advent Lessons and Carols', gigDate: '2026-12-02' }

function input(over: Partial<PracticeHeadingInput>): PracticeHeadingInput {
  return {
    today,
    practicedDays: [],
    weekDays,
    weekMode: 'target',
    weekTarget: 4,
    nextGig: null,
    listLength: 5,
    trackPractice: true,
    ...over,
  }
}

describe('practiceHeading', () => {
  it('asks to choose when never practiced, whatever else applies', () => {
    expect(practiceHeading(input({ nextGig: gig })).kind).toBe('choose')
  })

  it('asks to choose after more than 30 days without practice, unless a gig is coming', () => {
    expect(practiceHeading(input({ practicedDays: ['2026-10-25'] })).kind).toBe('choose') // 31 days
    expect(practiceHeading(input({ practicedDays: ['2026-10-26'] })).kind).toBe('resume') // 30 days
    expect(practiceHeading(input({ practicedDays: ['2026-10-25'], nextGig: gig })).kind).toBe('gig')
  })

  it('goes by the gig and the list alone with Track practice off', () => {
    const off = { trackPractice: false }
    expect(practiceHeading(input({ ...off, nextGig: gig })).kind).toBe('gig')
    const resume = practiceHeading(input({ ...off, practicedDays: [today] }))
    expect(resume.kind).toBe('resume')
    expect(resume.help).toBe('Your Practice List is ready to play from the top.')
    expect(practiceHeading(input({ ...off, listLength: 0 })).kind).toBe('choose')
  })

  it('keeps the week going over a gig once a day this week is practiced', () => {
    const h = practiceHeading(input({ practicedDays: ['2026-11-23'], nextGig: gig }))
    expect(h.kind).toBe('week')
    expect(h.help).toBe(
      'You’ve practiced 1 of 4 days this week. Practice today to stay on track for Sunday.',
    )
  })

  it('words the week by mode, today and the target', () => {
    const today_ = practiceHeading(input({ practicedDays: ['2026-11-23', today] }))
    expect(today_.help).toBe('You’ve practiced 2 of 4 days this week, today included.')
    const met = practiceHeading(
      input({ practicedDays: weekDays.slice(0, 3).concat('2026-11-20'), weekTarget: 3 }),
    )
    expect(met.help).toBe('You’ve practiced 3 days this week, meeting your target of 3.')
    const daily = practiceHeading(input({ weekMode: 'daily', practicedDays: ['2026-11-24'] }))
    expect(daily.help).toBe(
      'You’ve practiced 1 day of the last 7. Practice today to keep it going.',
    )
  })

  it('points to the gig when this week has no practice yet', () => {
    const h = practiceHeading(input({ practicedDays: ['2026-11-20'], nextGig: gig }))
    expect(h.kind).toBe('gig')
    expect(h.help).toBe(
      'Advent Lessons and Carols is in 7 days. Add its pieces to your Practice List, or press Practice on its card to run through the setlist.',
    )
    expect(
      practiceHeading(
        input({ practicedDays: ['2026-11-20'], nextGig: { ...gig, gigDate: '2026-11-26' } }),
      ).help,
    ).toMatch(/is tomorrow\./)
  })

  it('picks up where you left off, or asks to choose with an empty list', () => {
    expect(practiceHeading(input({ practicedDays: ['2026-11-20'] })).kind).toBe('resume')
    expect(practiceHeading(input({ practicedDays: ['2026-11-20'], listLength: 0 })).kind).toBe(
      'choose',
    )
  })

  it('ignores days after today', () => {
    expect(practiceHeading(input({ practicedDays: ['2026-11-27'] })).kind).toBe('choose')
  })
})
