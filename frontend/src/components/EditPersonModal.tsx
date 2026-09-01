import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  IconAlertTriangle,
  IconBrandWikipedia,
  IconCheck,
  IconCloudDownload,
  IconCloudOff,
  IconExternalLink,
  IconLoader2,
  IconXFilled,
} from '@tabler/icons-react'
import { updatePerson } from '../api/people'
import { searchWikipedia, type WikipediaSearchResult } from '../api/wikipedia'
import { ApiError } from '../api/client'
import { afterMinDuration } from '../lib/minDuration'
import type { Person, PersonWriteRequest } from '../api/types'
import { Modal } from './Modal'

// The real Edit Person modal (composer/arranger overhaul, Phase 5's
// approved mockup: EditPersonModalMockup.tsx, /mockup/edit-person-modal,
// left intact as a standing reference). Deliberately minimal — "should be
// very minimal" per the original brief — Name/Biography/Birth year/Death
// year only; portrait editing stays on Person Details' own camera badge
// (its only edit trigger, per that phase's own locked decision), same "no
// redundant triggers" principle EditBookModal.tsx already follows for
// Book's cover image.
//
// Wikipedia search-and-pick autofill (added once GET /api/wikipedia/search
// existed) mirrors the mockup's own interaction exactly — NOT a single-
// click instant fill like ImslpAutofillButton: an IMSLP number is a
// precise identifier resolving to exactly one work/file, but a person's
// *name* searched against Wikipedia is inherently ambiguous (the same
// ambiguity Upload Portrait's own Wikipedia search has to solve for the
// portrait image itself — "Chopin (crater)"/"Chopin Airport" alongside
// the real composer). Clicking the cloud icon opens a real disambiguation
// results panel; the human still has to confirm which article is the
// right person before anything gets filled.

interface EditPersonModalProps {
  person: Person
  open: boolean
  onClose: () => void
}

interface FormValues {
  name: string
  bio: string
  birthYear: string
  deathYear: string
}

function personToFormValues(person: Person): FormValues {
  return {
    name: person.name,
    bio: person.bio ?? '',
    birthYear: person.birthYear != null ? String(person.birthYear) : '',
    deathYear: person.deathYear != null ? String(person.deathYear) : '',
  }
}

function toIntOrNull(value: string): number | null {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formValuesToWriteRequest(data: FormValues): PersonWriteRequest {
  return {
    name: data.name,
    bio: data.bio || null,
    birthYear: toIntOrNull(data.birthYear),
    deathYear: toIntOrNull(data.deathYear),
  }
}

type SaveState = 'idle' | 'saving' | 'saved'
// Same fixed "Saved" display window as EditBookModal.tsx's own version of
// this — the PATCH itself isn't on a timer, just this confirmation beat.
const SAVED_DISPLAY_MS = 900
// How long a just-autofilled field's ring stays visible — matches the
// real ImslpAutofillButton callers' own ~2.4s clear.
const HIGHLIGHT_MS = 2400

// Same faint pre-blended tones as the real ImslpAutofillButton.tsx
// (#9d9892/#c9c2b6, never a translucent opacity utility). Sits inside the
// Name field itself — the thing that actually drives the search, since a
// person has no separate numeric identifier the way IMSLP does — same
// right-aligned/vertically-centered placement convention as a password
// field's show/hide toggle. Both the Wikipedia brand mark and the cloud/
// status icon live inside ONE button, a single click target, not a
// decorative icon beside a separate clickable one (locked in the
// mockup's own review).
function WikipediaAutofillButton({
  state,
  valid,
  onClick,
}: {
  state: 'idle' | 'searching' | 'open'
  valid: boolean
  onClick: () => void
}) {
  const disabled = !valid || state === 'searching'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={valid ? 'Search Wikipedia to autofill blank fields' : 'Type a name to search Wikipedia'}
      title={valid ? 'Search Wikipedia to autofill blank fields' : 'Type a name to search Wikipedia'}
      className={`absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1 disabled:cursor-default ${
        valid ? 'cursor-pointer text-[#9d9892] hover:text-accent' : 'text-[#c9c2b6]'
      }`}
    >
      <IconBrandWikipedia size={15} className="shrink-0" aria-hidden="true" />
      {!valid && <IconCloudOff size={16} />}
      {valid && state !== 'searching' && <IconCloudDownload size={16} />}
      {valid && state === 'searching' && <IconLoader2 size={16} className="animate-spin text-ink-soft" />}
    </button>
  )
}

export function EditPersonModal({ person, open, onClose }: EditPersonModalProps) {
  const queryClient = useQueryClient()
  const [saveState, setSaveState] = useState<SaveState>('idle')
  // Captured right before mutate() fires, read in onSuccess — see
  // lib/minDuration.ts: this app's mutations round-trip in ~1-15ms against
  // the local SQLite backend, faster than a browser paint, so without this
  // the stripe animation below would never actually be seen.
  const saveStartedAtRef = useRef(0)
  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: personToFormValues(person) })

  useEffect(() => {
    if (open) {
      reset(personToFormValues(person))
      // Guards a narrow but real edge case, same as EditBookModal.tsx's
      // own identical effect: closing the modal while a save is genuinely
      // in flight leaves saveState at 'saving', and this component stays
      // mounted across that close — without this, reopening before that
      // earlier request resolves would show a stale "Saving…" animation
      // for a session that hasn't submitted anything yet. This is a real
      // external-trigger sync (the `open` prop toggling), not a same-
      // render feedback loop — see Modal.tsx/EditBookModal.tsx for the
      // same reasoning and precedent. No eslint-disable needed here:
      // adding watch()/getValues()/setValue() above (for the Wikipedia
      // autofill) already puts this component on react-hooks/
      // incompatible-library's bail-out path, which also stops
      // react-hooks/set-state-in-effect from analyzing it — same gotcha
      // already documented for EditBookModal.tsx/EditPieceModal.tsx
      // (CLAUDE.md's own "React lint gotchas" entry).
      setSaveState('idle')
    }
  }, [open, person, reset])

  const name = watch('name')
  const isValidName = name.trim() !== ''

  // Anchors the results panel (see the portal below) — the Name field's
  // own wrapper, not the input itself, same reasoning TagComboBox.tsx's
  // own wrapperRef uses.
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [wikiState, setWikiState] = useState<'idle' | 'searching' | 'open'>('idle')
  const [wikiResults, setWikiResults] = useState<WikipediaSearchResult[]>([])
  const [wikiFilledFields, setWikiFilledFields] = useState<Set<string>>(new Set())

  const wikiSearchMutation = useMutation({
    mutationFn: (query: string) => searchWikipedia(query),
    onSuccess: (results) => {
      setWikiResults(results)
      setWikiState('open')
    },
    onError: () => setWikiState('idle'),
  })

  // The results panel renders through a portal to document.body with
  // JS-computed position: fixed coordinates — not position: absolute
  // inside the field's own wrapper — for the exact same reason
  // TagComboBox.tsx's own dropdown needed this fix: this modal's dialog
  // has overflow-hidden for its rounded corners, which clips ANY
  // absolutely-positioned descendant regardless of that descendant's own
  // `position` value, unless it's moved out of that DOM subtree
  // entirely. z-[60] for the same reason too — higher than Modal's own
  // z-50, so the results panel isn't painted underneath the dialog's
  // footer.
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (wikiState !== 'open') return
    function updatePosition() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPanelRect({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [wikiState])

  // Close on outside click / Escape — same dismiss conventions
  // ContextMenu.tsx and TagComboBox.tsx's own dropdown already use
  // app-wide.
  useLayoutEffect(() => {
    if (wikiState !== 'open') return
    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      setWikiState('idle')
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setWikiState('idle')
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [wikiState])

  function handleSearchClick() {
    if (!isValidName) return
    if (wikiState === 'open') {
      setWikiState('idle')
      return
    }
    setWikiState('searching')
    wikiSearchMutation.mutate(name.trim())
  }

  function pickResult(result: WikipediaSearchResult) {
    const current = getValues()
    const filled = new Set<string>()
    // Only fields currently blank — same "save typing, never silently
    // overwrite something already entered" rule the real IMSLP autofill
    // follows. Picking a noise result (no birthYear/deathYear on record)
    // simply fills nothing — a normal outcome, not an error.
    if (!current.birthYear && result.birthYear) {
      setValue('birthYear', String(result.birthYear))
      filled.add('birthYear')
    }
    if (!current.deathYear && result.deathYear) {
      setValue('deathYear', String(result.deathYear))
      filled.add('deathYear')
    }
    setWikiFilledFields(filled)
    setWikiState('idle')
    window.setTimeout(() => setWikiFilledFields(new Set()), HIGHLIGHT_MS)
  }

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => {
      saveStartedAtRef.current = Date.now()
      return updatePerson(person.id, formValuesToWriteRequest(data))
    },
    onSuccess: () => {
      // Broad invalidation — a name change ripples into every piece/book
      // crediting this person (their credit resolves live, no
      // denormalization, same reasoning as a Book field edit fanning out
      // to its pieces).
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['person'] })
      queryClient.invalidateQueries({ queryKey: ['pieces'] })
      queryClient.invalidateQueries({ queryKey: ['piece'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      afterMinDuration(saveStartedAtRef.current, () => {
        setSaveState('saved')
        setTimeout(() => {
          setSaveState('idle')
          onClose()
        }, SAVED_DISPLAY_MS)
      })
    },
    onError: () => setSaveState('idle'),
  })

  function onSubmit(data: FormValues) {
    setSaveState('saving')
    saveMutation.mutate(data)
  }

  // Shift+Enter saves from anywhere in the form — same convention as every
  // other edit modal in this app.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  const saving = saveState !== 'idle'

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="edit-person-title"
      header={
        <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
          <div>
            <h2 id="edit-person-title" className="font-display text-2xl font-medium text-ink">
              Edit person
            </h2>
            <p className="text-sm text-ink-soft">{person.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
          >
            <IconXFilled size={22} />
          </button>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2">
          {saveMutation.isError && (
            <p className="flex items-center gap-2 text-sm text-red-700">
              <IconAlertTriangle size={16} />
              {saveMutation.error instanceof ApiError
                ? saveMutation.error.message
                : 'Could not save. Please try again.'}
            </p>
          )}
          {person.pieceCount > 0 && (
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {person.pieceCount} {person.pieceCount === 1 ? 'work' : 'works'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent disabled:cursor-default disabled:opacity-45"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-person-form"
              disabled={saving}
              className="relative flex min-w-[130px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-accent px-4 py-2 font-display whitespace-nowrap text-white disabled:cursor-default"
            >
              {saveState === 'saving' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] motion-reduce:animate-none motion-reduce:opacity-60"
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {saveState === 'idle' && 'Save'}
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && (
                  <>
                    <IconCheck size={15} />
                    Saved
                  </>
                )}
              </span>
            </button>
          </div>
        </div>
      }
    >
      <form
        id="edit-person-form"
        onSubmit={handleSubmit(onSubmit)}
        onKeyDown={handleFormKeyDown}
        className="flex flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="f-name" className="text-sm text-ink-soft">
            Name <span className="text-ink-soft/60 italic">(Required)</span>
          </label>
          {/* relative + pr-12 reserves room for the button — wider than a
              single-icon autofill button, since this one renders two
              icons (Wikipedia brand mark + cloud/status) side by side. */}
          <div ref={anchorRef} className="relative">
            <input
              id="f-name"
              className="w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 pr-12 text-ink"
              {...register('name', { required: 'Name is required.', maxLength: 255 })}
            />
            <WikipediaAutofillButton state={wikiState} valid={isValidName} onClick={handleSearchClick} />
          </div>
          {errors.name && <p className="text-sm text-red-700">{errors.name.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="f-bio" className="text-sm text-ink-soft">
            Biography <span className="text-ink-soft/60 italic">(Markdown supported)</span>
          </label>
          <textarea
            id="f-bio"
            rows={5}
            className="rounded-md border border-border bg-paper-raised px-3 py-2 text-ink"
            {...register('bio')}
          />
        </div>

        <div className="flex flex-col gap-3 min-[400px]:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-birth-year" className="text-sm text-ink-soft">
              Birth year
            </label>
            <input
              id="f-birth-year"
              inputMode="numeric"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${
                wikiFilledFields.has('birthYear') ? 'ring-2 ring-accent-on-dark' : ''
              }`}
              {...register('birthYear')}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="f-death-year" className="text-sm text-ink-soft">
              Death year
            </label>
            <input
              id="f-death-year"
              inputMode="numeric"
              className={`w-full min-w-0 rounded-md border border-border bg-paper-raised px-3 py-2 text-ink transition-shadow duration-700 ${
                wikiFilledFields.has('deathYear') ? 'ring-2 ring-accent-on-dark' : ''
              }`}
              {...register('deathYear')}
            />
          </div>
        </div>
      </form>

      {wikiState === 'open' &&
        panelRect &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: panelRect.top, left: panelRect.left, width: panelRect.width }}
            className="z-[60] max-h-72 overflow-y-auto rounded-md border border-border bg-paper-raised py-1 shadow-lg"
          >
            {wikiResults.length === 0 && (
              <p className="px-3 py-2.5 text-sm text-ink-soft italic">No Wikipedia results found.</p>
            )}
            {/* No "not this one" hint on a result missing birth/death years
                (removed 2026-09-01, direct report) — the mockup's own
                fixture data (crater/airport noise) made that a reliable
                signal by construction, but it isn't one against real
                Wikipedia search results: confirmed live (query "Miles
                Davis") that a real, legitimate, possibly-correct person —
                "Randy Hall," a real musician/producer — comes back with
                birthYear/deathYear both null, since his own lead paragraph
                just doesn't state a year in the parseable format
                internal/wikipedia's heuristic looks for. Flagging a real
                candidate as "not this one" on a parsing miss is actively
                misleading, not merely unhelpful. `result.description` (the
                actual disambiguator, always shown) still does the real
                work here — this hint was always a bonus nudge on top of
                it, never load-bearing. */}
            {wikiResults.map((result) => (
              <button
                key={result.title}
                type="button"
                onClick={() => pickResult(result)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-paper-sunken"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#6b6560] text-white">
                  <IconExternalLink size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-medium text-ink">
                    {result.title}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">{result.description}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </Modal>
  )
}
