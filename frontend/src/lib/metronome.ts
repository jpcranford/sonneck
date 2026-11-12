// The Sheet Viewer's metronome: its numbers, the beat levels, tap tempo and
// the click engine. No markup, so the viewer and its mockup share it.
// Designed on https://claude.ai/artifact/FqYsh6YjuaqHNeFBzmuqZD (option A5).

export const METRONOME_MIN_BPM = 30
export const METRONOME_MAX_BPM = 300
export const METRONOME_MIN_BEATS = 1
export const METRONOME_MAX_BEATS = 12
/** A piece with no tempo of its own starts here. */
export const METRONOME_DEFAULT_BPM = 100
export const METRONOME_DEFAULT_BEATS = 4
/** Holding − or + steps by this much. */
export const METRONOME_HOLD_STEP = 5

/** 0 silent (no click, still counted), 1 played, 2 accented. */
export type BeatLevel = 0 | 1 | 2

/** Clicks per beat: every beat, every half beat (eighths), triplets, or
 * every quarter beat (sixteenths). */
export type Subdivision = 1 | 2 | 3 | 4

export interface MetronomeSettings {
  bpm: number
  levels: BeatLevel[]
  subdivision: Subdivision
}

/** The subdivisions the panel's note menu offers, in that order. */
export const SUBDIVISIONS: { value: Subdivision; label: string }[] = [
  { value: 1, label: 'Every beat' },
  { value: 2, label: 'Every half beat' },
  { value: 3, label: 'Triplets' },
  { value: 4, label: 'Every quarter beat' },
]

/** What one click sounds like: a beat's first click follows its tile, the
 * clicks between beats are quieter and lower, and a silent beat silences
 * all of its clicks. */
export type ClickSound = 'accent' | 'beat' | 'between' | null

export function clickSound(level: BeatLevel, click: number): ClickSound {
  if (level === 0) return null
  if (click > 0) return 'between'
  return level === 2 ? 'accent' : 'beat'
}

/** The Italian markings the panel offers, each with the tempo it jumps to. */
export const TEMPO_MARKINGS: { name: string; bpm: number }[] = [
  { name: 'Largo', bpm: 50 },
  { name: 'Adagio', bpm: 70 },
  { name: 'Andante', bpm: 90 },
  { name: 'Moderato', bpm: 110 },
  { name: 'Allegro', bpm: 130 },
  { name: 'Vivace', bpm: 156 },
  { name: 'Presto', bpm: 180 },
]

/** The marking a tempo falls under: the last one whose tempo it is within 10
 * below or above. */
export function markingFor(bpm: number): string {
  let name = TEMPO_MARKINGS[0].name
  for (const mark of TEMPO_MARKINGS) if (bpm >= mark.bpm - 10) name = mark.name
  return name
}

export function clampBpm(bpm: number): number {
  return Math.min(METRONOME_MAX_BPM, Math.max(METRONOME_MIN_BPM, Math.round(bpm)))
}

/** A typed tempo: digits only, clamped; null when there are none. */
export function parseBpm(text: string): number | null {
  const digits = text.replace(/\D/g, '')
  return digits ? clampBpm(Number(digits)) : null
}

/** A tap on a tile: played → accented → silent → played. */
export function nextLevel(level: BeatLevel): BeatLevel {
  return ((level + 1) % 3) as BeatLevel
}

/** Changes the number of beats, keeping the levels already set; a new beat
 * is played. */
export function resizeBeats(levels: BeatLevel[], count: number): BeatLevel[] {
  const n = Math.min(METRONOME_MAX_BEATS, Math.max(METRONOME_MIN_BEATS, count))
  return Array.from({ length: n }, (_, i) => levels[i] ?? 1)
}

/** Where a piece starts the first time: its own BPM and beats per measure,
 * else 100 and 4. Beat 1 is accented. */
export function seedMetronome(piece: {
  bpm?: number | null
  beatsPerMeasure?: number | null
}): MetronomeSettings {
  const beats = Math.min(
    METRONOME_MAX_BEATS,
    Math.max(METRONOME_MIN_BEATS, piece.beatsPerMeasure ?? METRONOME_DEFAULT_BEATS),
  )
  const levels: BeatLevel[] = Array.from({ length: beats }, (_, i) => (i === 0 ? 2 : 1))
  return { bpm: clampBpm(piece.bpm ?? METRONOME_DEFAULT_BPM), levels, subdivision: 1 }
}

/** Tap tempo keeps taps this close together; a longer pause starts over. */
export const TAP_RESET_MS = 2000
/** The tempo is the average of up to this many of the latest gaps. */
export const TAP_AVERAGE_GAPS = 6

/** Adds a tap (a timestamp in ms) and works out the tempo from the average
 * of the latest gaps between taps — several, so one uneven tap barely moves
 * it. Returns the taps to keep and the tempo, or null after a single tap. */
export function tapTempo(taps: number[], now: number): { taps: number[]; bpm: number | null } {
  const last = taps[taps.length - 1]
  const kept = last !== undefined && now - last <= TAP_RESET_MS ? [...taps, now] : [now]
  const recent = kept.slice(-(TAP_AVERAGE_GAPS + 1))
  if (recent.length < 2) return { taps: recent, bpm: null }
  const average = (recent[recent.length - 1] - recent[0]) / (recent.length - 1)
  return { taps: recent, bpm: clampBpm(60000 / average) }
}

type AudioContextConstructor = typeof AudioContext

/** The clicks: a short woodblock-like tone drawn by the browser, higher for
 * an accent and lower for the clicks between beats, scheduled a little ahead
 * with Web Audio so they stay on time however busy the page is. The settings
 * are read on every click, so a change while it plays applies at the next
 * one. */
export class MetronomeEngine {
  private context: AudioContext | null = null
  private timer: number | null = null
  private next = 0
  private beat = 0
  private click = 0
  private settings: MetronomeSettings = {
    bpm: METRONOME_DEFAULT_BPM,
    levels: [2, 1, 1, 1],
    subdivision: 1,
  }
  private onClick: (beat: number, click: number) => void = () => {}

  get playing(): boolean {
    return this.timer !== null
  }

  /** Starts from beat 1. Call it from a tap or key press: browsers only let
   * sound start from one. `onClick` hears each click as it sounds, with its
   * beat and its place in the beat (0 for the beat itself). */
  start(settings: MetronomeSettings, onClick: (beat: number, click: number) => void) {
    this.stop()
    if (!this.context) {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: AudioContextConstructor }).webkitAudioContext
      this.context = new Context()
    }
    void this.context.resume()
    this.settings = settings
    this.onClick = onClick
    this.beat = 0
    this.click = 0
    this.next = this.context.currentTime + 0.06
    this.schedule()
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  update(settings: MetronomeSettings) {
    this.settings = settings
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  private schedule() {
    const context = this.context
    if (!context) return
    while (this.next < context.currentTime + 0.12) {
      const { levels, subdivision, bpm } = this.settings
      const beat = this.beat % levels.length
      // A subdivision made smaller while it plays starts the next beat.
      const click = this.click < subdivision ? this.click : 0
      const sound = clickSound(levels[beat] ?? 1, click)
      if (sound) this.sound(this.next, sound)
      const delay = Math.max(0, (this.next - context.currentTime) * 1000)
      window.setTimeout(() => {
        if (this.timer !== null) this.onClick(beat, click)
      }, delay)
      this.next += 60 / bpm / subdivision
      if (click + 1 < subdivision) {
        this.beat = beat
        this.click = click + 1
      } else {
        this.beat = beat + 1
        this.click = 0
      }
    }
  }

  private sound(time: number, sound: Exclude<ClickSound, null>) {
    const context = this.context
    if (!context) return
    const tone = context.createOscillator()
    const gain = context.createGain()
    tone.type = 'triangle'
    tone.frequency.value = { accent: 1760, beat: 1175, between: 880 }[sound]
    const peak = { accent: 0.9, beat: 0.55, between: 0.28 }[sound]
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(peak, time + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06)
    tone.connect(gain).connect(context.destination)
    tone.start(time)
    tone.stop(time + 0.07)
  }
}
