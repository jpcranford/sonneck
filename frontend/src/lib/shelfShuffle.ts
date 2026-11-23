import { useCallback, useState } from 'react'

// The Practice Dashboard's per-shelf "random order". Off by default. A
// shelf turned on gets a seed, which fixes its order until it's turned off
// and on again (a new seed, so a new order). Kept per device in browser
// storage: { [shelf key]: seed }; a shelf that's off has no entry.

const STORAGE_KEY = 'sonneck-shelf-shuffle'

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    const out: Record<string, number> = {}
    if (raw && typeof raw === 'object')
      for (const [k, v] of Object.entries(raw))
        if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[k] = v
    return out
  } catch {
    return {}
  }
}

function write(seeds: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeds))
  } catch {
    // Storage unavailable: the order still holds until the page reloads.
  }
}

/** A new seed: a positive 31-bit integer (the server takes it as one). */
export function newShuffleSeed(): number {
  return 1 + Math.floor(Math.random() * 0x7ffffffe)
}

/** Each shelf's seed (undefined while it's off), and a toggle. */
export function useShelfShuffles() {
  const [seeds, setSeeds] = useState(read)
  // The new seed is drawn here, not in a state updater: React may run an
  // updater twice, which would show one seed and store another.
  const toggle = useCallback(
    (key: string) => {
      const next = { ...seeds }
      if (next[key]) delete next[key]
      else next[key] = newShuffleSeed()
      write(next)
      setSeeds(next)
    },
    [seeds],
  )
  return { seeds, seedOf: (key: string): number | undefined => seeds[key], toggle }
}

/** `items` in a random order fixed by `seed` (Fisher–Yates, mulberry32). */
export function shuffledBy<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
