import { describe, expect, it } from 'vitest'
import type { PracticeStatusItem } from '../api/types'
import { sortPracticeStatuses } from './practiceStatusOrder'

const item = (
  id: number,
  name: string,
  iconKey: PracticeStatusItem['iconKey'],
): PracticeStatusItem => ({
  id,
  name,
  iconKey,
})

describe('sortPracticeStatuses', () => {
  it('lists the seeded statuses in practice order, Stalled before Learned', () => {
    const alphabetical = [
      item(1, 'Dropped', 'dropped'),
      item(2, 'Learned', 'learned'),
      item(3, 'Learning', 'learning'),
      item(4, 'Stalled', 'stalled'),
      item(5, 'Want to Learn', 'want_to_learn'),
    ]
    expect(sortPracticeStatuses(alphabetical).map((s) => s.name)).toEqual([
      'Want to Learn',
      'Learning',
      'Stalled',
      'Learned',
      'Dropped',
    ])
  })

  it('keeps a renamed status in its place, and puts statuses without an icon last', () => {
    const statuses = [
      item(6, 'Custom', null),
      item(2, 'Mastered', 'learned'),
      item(4, 'On hold', 'stalled'),
    ]
    expect(sortPracticeStatuses(statuses).map((s) => s.name)).toEqual([
      'On hold',
      'Mastered',
      'Custom',
    ])
  })
})
