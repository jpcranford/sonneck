import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import {
  IconBrandWikipedia,
  IconCameraFilled,
  IconCloudDownload,
  IconCloudOff,
  IconCheck,
  IconExternalLink,
  IconLoader2,
  IconXFilled,
} from '@tabler/icons-react'
import { Modal } from '../components/Modal'
import { PALETTE } from '../lib/pieceSplitLogic'
import { useMockupTitle } from '../lib/useMockupTitle'

// ---------------------------------------------------------------------
// DESIGN MOCKUP — Edit Person modal (composer/arranger overhaul, Phase 5
// of 6 — see the approved Phase 1/2 Artifacts and the built Phase 3/4
// mockups: /mockup/people-library, /mockup/person-details). Not wired to
// real data — Save replays the same idle→saving→saved stripe-animation
// sequence EditBookModalMockup.tsx already established, and the
// Wikipedia autofill mimics real Wikipedia-search behavior via a local
// mock lookup — there's no real endpoint yet, that's Phase 6.
//
// Deliberately minimal — "should be very minimal" was the original brief
// for Person — Name, Bio, Birth Year, Death Year, same 4 fields as before.
//
// Portrait now has an edit trigger here too (added 2026-09-01, direct
// request: "incorporate the thumb edit field into the modal... similar to
// how upload book step 3 is laid out with the page thumb small and off to
// the side") — reversing Phase 2's original "camera badge is the ONLY
// trigger" decision, the same way this modal's own field list has grown
// past "very minimal" in spirit if not in field count. Layout mirrors
// BookUploadAboutStep.tsx's own cover-preview column exactly: a small
// portrait box pinned to the left (fixed `w-[150px]` at every breakpoint,
// not just `sm:` — an oval avatar stretched to a mobile viewport's full
// width looked oversized/orphaned in testing, unlike a book page thumb at
// the same width; centered via `mx-auto`/`sm:mx-0` when stacked, matching
// PersonDetailsPage.tsx's own header avatar width), a plain trigger button
// underneath it, fields flowing in the wider right column — `size="lg"`
// on Modal (revised from `xl`, which left zero side margin at iPad
// portrait's 768px viewport — see Modal.tsx's own size doc comment). The
// button here is a stub
// (`lastAction`, PersonDetailsSample.tsx's own established stub-message
// pattern, adopted here too) — the real component nests the already-built
// UploadPortraitModal (crop/zoom, real Wikipedia image search) the same
// way PersonDetailsPage.tsx already triggers it, just from this modal
// instead of only the avatar's own camera badge.
//
// Wikipedia autofill is a search-and-pick flow, NOT a single-click
// instant fill — a real, direct correction after the first pass shipped
// with an IMSLP-style one-click "cloud download" button. IMSLP's own
// autofill can do that because an IMSLP number is a precise identifier
// that resolves to exactly one work/file; a person's *name* searched
// against Wikipedia is inherently ambiguous (the same ambiguity Upload
// Portrait's own Wikipedia search already had to solve for the portrait
// image — "Chopin (crater)"/"Chopin Airport" alongside the real
// composer). So clicking the cloud icon here opens a results list (same
// noise-inclusion fixture as Upload Portrait, for continuity) rather than
// silently picking a "best" match — the human still has to confirm which
// article is actually the right person before anything gets filled.
// ---------------------------------------------------------------------

interface FormValues {
  name: string
  bio: string
  birthYear: string
  deathYear: string
}

const MOCK_PERSON_NAME = 'Frédéric Chopin'
const MOCK_WORK_COUNT = 7
const MOCK_BOOK_CREDIT_COUNT = 2

// deathYear starts blank on purpose, unlike every other field — the whole
// point of this mockup is to demonstrate the autofill actually filling a
// blank field (and leaving birthYear, already typed, untouched), not just
// existing decoratively next to the button.
const defaultValues: FormValues = {
  name: MOCK_PERSON_NAME,
  bio: 'Polish composer and virtuoso pianist of the Romantic era, known almost exclusively for solo piano works.',
  birthYear: '1810',
  deathYear: '',
}

interface WikiSearchResult {
  title: string
  description: string
  thumbColor: string
  birthYear: string | null
  deathYear: string | null
}

// A name-keyed mock search — stands in for a real Wikipedia search/parse
// call (Phase 6). Same noise-inclusion fixture as
// PersonDetailsSample.tsx's own Upload Portrait flow (continuity across
// this project's mockups): the real composer alongside two irrelevant
// articles that also match "Chopin," each with no birth/death year of its
// own, so picking one deliberately fills nothing. Any name not in this
// table returns an empty result list — handled gracefully (a "No results"
// row, not an error), same "a normal empty result" posture the real
// IMSLP lookup already has for an unrecognized number.
const MOCK_WIKI_SEARCH: Record<string, WikiSearchResult[]> = {
  'frédéric chopin': [
    {
      title: 'Frédéric Chopin',
      // Two real sentences, not one — matches the real backend's own
      // exsentences=2 (changed 2026-09-01, "just one often isn't enough"),
      // and actually demonstrates the results panel's line-clamp-2
      // treatment wrapping to a real second line, not just a CSS change
      // with nothing in this fixture long enough to show it.
      description:
        'Polish composer and virtuoso pianist (1810–1849). Widely regarded as one of the greatest composers for the piano, celebrated for his mazurkas, nocturnes, and études.',
      thumbColor: '#5c8a8a',
      birthYear: '1810',
      deathYear: '1849',
    },
    {
      title: 'Chopin (crater)',
      description: 'Impact crater on Mercury named after the composer',
      thumbColor: '#6b6560',
      birthYear: null,
      deathYear: null,
    },
    {
      title: 'Chopin Airport',
      description: 'Warsaw Chopin Airport, the main international airport of Warsaw, Poland',
      thumbColor: '#6b6560',
      birthYear: null,
      deathYear: null,
    },
  ],
}

// Same faint pre-blended tones as the real ImslpAutofillButton.tsx
// (#9d9892/#c9c2b6, never a translucent opacity utility), kept as a local
// mockup-only duplicate rather than a shared component, since there's no
// real Wikipedia lookup to wire it to yet. Sits inside the Name field
// itself — the thing that actually drives the search, since a person has
// no separate numeric identifier the way IMSLP does — same right-aligned/
// vertically-centered placement convention as a password field's
// show/hide toggle. 'open' (results panel showing) reads the same as
// 'idle' visually — the panel itself is what signals state, not the
// button — but is tracked separately so a second click on the button
// while results are already open toggles them closed instead of
// re-searching.
// Both the Wikipedia brand mark and the cloud/status icon live inside
// ONE button, not a decorative icon beside a separate clickable one — a
// single target, direct correction after a first pass split them into
// two adjacent elements. Tight gap-1 (closer than the field-level icon
// spacing elsewhere in this app) since they're one composite affordance
// now, not two independent icons that happen to sit near each other.
// Self-positioning again (absolute top-1/2 right-2.5 -translate-y-1/2) —
// same placement convention as a password field's show/hide toggle, and
// the real ImslpAutofillButton.tsx's own single-icon version of this.
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

type SaveState = 'idle' | 'saving' | 'saved'
// Same timings as EditBookModalMockup.tsx's own locked "Save Animation."
const SAVING_MS = 1400
const SAVED_MS = 1100
// How long a just-autofilled field's ring stays visible — matches the
// real ImslpAutofillButton callers' own ~2.4s clear.
const HIGHLIGHT_MS = 2400

// Same illustrative fixture image PersonDetailsSample.tsx's own avatar
// uses in place of a real uploaded photo — duplicated locally, per this
// codebase's usual "no shared components between a mockup and the real
// thing" convention (PALETTE above is the one exception, since it's pure
// data/logic, not a component).
function CameoPortrait() {
  return (
    <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
      <rect width="100" height="130" fill="#3a3430" />
      <circle cx="50" cy="48" r="22" fill="#cbb89a" />
      <path d="M14 130c0-28 18-46 36-46s36 18 36 46" fill="#cbb89a" />
      <path
        d="M28 40c2-14 12-22 22-22s20 8 22 22c-4-6-12-10-22-10s-18 4-22 10z"
        fill="#1f1b18"
      />
    </svg>
  )
}

// Mirrors the real PersonAvatar (PersonDetailsPage.tsx)'s box treatment —
// oval 3:4, palette color behind the portrait. This mockup's own
// MOCK_PERSON always "has" a portrait (CameoPortrait), same as
// PersonDetailsSample.tsx's own default, so there's no initials-fallback
// branch here — that state is already covered on the Person Details
// mockup, not this screen's own concern.
function PersonAvatar({ className }: { className: string }) {
  return (
    <div
      className={`relative aspect-[3/4] overflow-hidden rounded-[50%] border border-border ${className}`}
      style={{ backgroundColor: PALETTE[1 % PALETTE.length] }}
    >
      <CameoPortrait />
    </div>
  )
}

export function EditPersonModalMockup() {
  useMockupTitle('Edit Person Modal')

  const [open, setOpen] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [wikiState, setWikiState] = useState<'idle' | 'searching' | 'open'>('idle')
  const [wikiResults, setWikiResults] = useState<WikiSearchResult[]>([])
  const [wikiFilledFields, setWikiFilledFields] = useState<Set<string>>(new Set())
  const [lastAction, setLastAction] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues })

  const name = watch('name')
  const isValidName = name.trim() !== ''

  // Anchors the results panel (see the portal below) — the Name field's
  // own wrapper, not the input itself, same reasoning TagComboBox.tsx's
  // own wrapperRef uses.
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The results panel renders through a portal to document.body with
  // JS-computed position: fixed coordinates — not position: absolute
  // inside the field's own wrapper — for the exact same reason
  // TagComboBox.tsx's own dropdown needed this fix (2026-08-30, see that
  // file's own comment and CLAUDE.md's gotcha log): this modal's dialog
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
    setTimeout(() => {
      setWikiResults(MOCK_WIKI_SEARCH[name.trim().toLowerCase()] ?? [])
      setWikiState('open')
    }, 700)
  }

  function pickResult(result: WikiSearchResult) {
    const current = getValues()
    const filled = new Set<string>()
    // Only fields currently blank — same "save typing, never silently
    // overwrite something already entered" rule the real IMSLP autofill
    // follows. Picking a noise result (no birthYear/deathYear on record)
    // simply fills nothing — a normal outcome, not an error.
    if (!current.birthYear && result.birthYear) {
      setValue('birthYear', result.birthYear)
      filled.add('birthYear')
    }
    if (!current.deathYear && result.deathYear) {
      setValue('deathYear', result.deathYear)
      filled.add('deathYear')
    }
    setWikiFilledFields(filled)
    setWikiState('idle')
    setTimeout(() => setWikiFilledFields(new Set()), HIGHLIGHT_MS)
  }

  // No real PATCH here (mockup) — just the same perceived-progress
  // sequence EditBookModalMockup.tsx's own Save button already replays.
  function onSubmit() {
    if (saveState !== 'idle') return
    setSaveState('saving')
    setTimeout(() => setSaveState('saved'), SAVING_MS)
    setTimeout(() => setSaveState('idle'), SAVING_MS + SAVED_MS)
  }

  // Shift+Enter saves from anywhere in the form — kept consistent with
  // every other real/mockup edit modal in this app.
  function handleFormKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      handleSubmit(onSubmit)()
    }
  }

  const saving = saveState !== 'idle'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 md:p-8">
      <div className="rounded-md border border-dashed border-accent/40 bg-accent-soft/40 px-4 py-2 text-sm text-ink-soft">
        Design mockup — <span className="font-medium text-ink">Edit Person modal</span>. Not wired to real
        data — Save replays the approved progress animation. Click the cloud icon next to Name (already
        "Frédéric Chopin", with Death year blank) to see the Wikipedia search-and-pick flow — including the
        same irrelevant-result noise Upload Portrait's own search already demonstrates. "Change Portrait" in
        the left column is a stub — see the banner it produces.
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit cursor-pointer rounded-md border border-border bg-paper-raised px-4 py-2 font-display text-ink hover:border-accent"
        >
          Reopen mockup
        </button>
      )}

      {lastAction && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-paper-sunken px-4 py-2.5 text-sm text-ink-soft">
          {lastAction}
          <button
            type="button"
            onClick={() => setLastAction(null)}
            aria-label="Dismiss"
            className="shrink-0 cursor-pointer text-ink-soft hover:text-ink"
          >
            <IconXFilled size={16} />
          </button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="edit-person-mockup-title"
        // lg, not xl — mockup-parity with the real EditPersonModal.tsx's
        // own size change (2026-09-05): matches EditPieceModal.tsx, fixes
        // zero side-margin at iPad-portrait's 768px viewport.
        size="lg"
        header={
          <div className="-mx-6 flex items-start justify-between gap-4 border-b border-border px-6 pb-4">
            <div>
              <h2 id="edit-person-mockup-title" className="font-display text-2xl font-medium text-ink">
                Edit person
              </h2>
              <p className="text-sm text-ink-soft">{MOCK_PERSON_NAME}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="mt-1 shrink-0 cursor-pointer text-ink-soft hover:text-accent"
            >
              <IconXFilled size={22} />
            </button>
          </div>
        }
        footer={
          <div className="flex flex-col gap-2">
            <p
              className={`text-right text-xs text-ink-soft transition-opacity ${saving ? 'opacity-0' : 'opacity-100'}`}
            >
              Saving will update {MOCK_WORK_COUNT} pieces and {MOCK_BOOK_CREDIT_COUNT} books
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
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
                    className="absolute inset-y-0 -left-14 w-[calc(100%+56px)] animate-stripe-move bg-[length:56px_56px] [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.3)_0,rgba(255,255,255,0.3)_10px,transparent_10px,transparent_20px)] will-change-transform motion-reduce:animate-none motion-reduce:opacity-60"
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
          className="flex flex-col gap-7 sm:flex-row sm:items-start"
        >
          {/* Portrait column — same "small thumb pinned to the side, plain
              trigger button underneath" shape as BookUploadAboutStep.tsx's
              own cover-preview column, just an oval 3:4 box instead of a
              2:3 page. Not sticky (unlike that wizard screen) — this
              modal's own field list is short enough it rarely scrolls, so
              there's no long-scroll case for a pinned thumb to solve. */}
          <div className="mx-auto flex w-[150px] shrink-0 flex-col gap-2.5 sm:mx-0">
            <PersonAvatar className="w-full shadow-sm" />
            <button
              type="button"
              onClick={() =>
                setLastAction(
                  'Mock action: this opens the Upload Portrait flow (device upload or Wikipedia search, then crop/zoom) — same modal Person Details’ own camera badge already opens.',
                )
              }
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-paper-raised px-3 py-2 text-sm text-ink hover:border-accent"
            >
              <IconCameraFilled size={14} />
              Change Portrait
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="f-name" className="text-sm text-ink-soft">
                Name <span className="text-ink-soft/60 italic">(Required)</span>
              </label>
              {/* relative + pr-12 reserves room for the button — wider than
                  EditPieceModal.tsx's own single-icon IMSLP field, since
                  this one button now renders two icons (Wikipedia brand
                  mark + cloud/status) side by side. */}
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
          </div>
        </form>
      </Modal>

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
            {/* No "not this one" hint (removed 2026-09-01, mockup-parity —
                see EditPersonModal.tsx's own comment on this exact block):
                real Wikipedia data proved the birthYear/deathYear-missing
                heuristic unreliable — a real, legitimate person can come
                back with no parseable year — so it's gone from the real
                component; kept in sync here even though this file's own
                fixture data (MOCK_WIKI_SEARCH) was curated so the heuristic
                happened to work by construction, since the underlying
                design idea is retired, not just its real-data
                reliability. */}
            {wikiResults.map((result) => (
              <button
                key={result.title}
                type="button"
                onClick={() => pickResult(result)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-paper-sunken"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: result.thumbColor }}
                >
                  <IconExternalLink size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-medium text-ink">
                    {result.title}
                  </span>
                  {/* line-clamp-2, not truncate — mockup-parity with
                      EditPersonModal.tsx's own fix (2026-09-01, "just one
                      [line] often isn't enough"). */}
                  <span className="line-clamp-2 text-xs text-ink-soft">{result.description}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
