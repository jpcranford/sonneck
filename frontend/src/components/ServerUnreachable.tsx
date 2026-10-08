import { useCallback, useEffect, useRef, useState } from 'react'
import { IconCloudOff, IconLoader2, IconRefresh } from '@tabler/icons-react'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { afterMinDuration } from '../lib/minDuration'

// Seconds to wait before each automatic try. After the last one fails the
// screen stops trying on its own and waits for Try again (or a pull).
const RETRY_DELAYS_S = [5, 10, 20, 30, 30]

/**
 * Shown when the app starts but the server doesn't answer (App.tsx's
 * AuthGate). Picked from a side-by-side (D falling back to B): it first
 * retries by itself, counting down, so a server that's only restarting
 * comes back untouched; "Try now" or pulling down skips the wait. After
 * RETRY_DELAYS_S runs out it settles on a plain "check the server" message
 * with a green Try again. Every try, automatic or not, calls `onRetry`; if
 * the server answers, the parent renders the app and this unmounts, so
 * still being here afterwards means the try failed.
 */
export function ServerUnreachable({ onRetry }: { onRetry: () => Promise<unknown> }) {
  const [tries, setTries] = useState(0)
  const [trying, setTrying] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(RETRY_DELAYS_S[0])
  const triesRef = useRef(0)
  const tryingRef = useRef(false)
  const gaveUp = tries >= RETRY_DELAYS_S.length

  const tryAgain = useCallback((): Promise<void> => {
    if (tryingRef.current) return Promise.resolve()
    tryingRef.current = true
    setTrying(true)
    const startedAt = Date.now()
    return onRetry()
      .catch(() => {})
      .then(
        () =>
          new Promise<void>((resolve) =>
            afterMinDuration(startedAt, () => {
              const done = triesRef.current + 1
              triesRef.current = done
              setTries(done)
              if (done < RETRY_DELAYS_S.length) setSecondsLeft(RETRY_DELAYS_S[done])
              tryingRef.current = false
              setTrying(false)
              resolve()
            }),
          ),
      )
  }, [onRetry])

  // The countdown: one tick a second, and the automatic try when it ends.
  useEffect(() => {
    if (gaveUp || trying) return
    const id = setTimeout(() => {
      if (secondsLeft <= 1) void tryAgain()
      else setSecondsLeft(secondsLeft - 1)
    }, 1000)
    return () => clearTimeout(id)
  }, [gaveUp, trying, secondsLeft, tryAgain])

  const containerRef = useRef<HTMLDivElement>(null)
  const { pullDistance, phase, threshold } = usePullToRefresh({
    containerRef,
    onRefresh: tryAgain,
    enabled: true,
  })

  let message: string
  if (gaveUp) message = "The server didn't answer. Check that it's running, then try again."
  else if (trying) message = 'Trying again…'
  else message = `Trying again in ${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'}…`

  return (
    <div
      ref={containerRef}
      className="flex h-dvh flex-col overflow-y-auto overscroll-y-contain bg-paper"
    >
      {/* Pull-to-refresh indicator — same as AppShell's. */}
      <div
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center overflow-hidden ${
          phase === 'pulling' || phase === 'ready' ? '' : 'transition-[height] duration-200'
        }`}
        style={{ height: pullDistance }}
      >
        <IconLoader2
          size={22}
          className={
            phase === 'refreshing'
              ? 'animate-spin text-accent'
              : phase === 'ready'
                ? 'text-accent'
                : 'text-ink-soft'
          }
          style={
            phase === 'refreshing'
              ? undefined
              : { transform: `rotate(${Math.min((pullDistance / threshold) * 180, 180)}deg)` }
          }
        />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <IconCloudOff size={48} stroke={1.5} className="text-ink-soft" />
        <h1 className="font-display text-xl font-medium text-ink">Can't reach Sonneck</h1>
        <p className="max-w-xs text-ink-soft" aria-live="polite">
          {message}
        </p>
        <button
          type="button"
          onClick={() => void tryAgain()}
          disabled={trying}
          className={`mt-2 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 font-display font-medium disabled:opacity-50 ${
            gaveUp
              ? 'bg-accent-fill text-white hover:bg-accent-fill/90'
              : 'border border-border bg-paper-raised text-ink hover:border-accent'
          }`}
        >
          {trying ? <IconLoader2 size={16} className="animate-spin" /> : <IconRefresh size={16} />}
          {gaveUp ? (trying ? 'Trying…' : 'Try again') : 'Try now'}
        </button>
      </div>
    </div>
  )
}
