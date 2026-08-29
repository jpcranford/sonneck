import { useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { IconInfoCircle, IconSearch } from '@tabler/icons-react'
import { listBooks } from '../api/books'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { InfoTooltip } from './InfoTooltip'

// Search-as-you-type book picker for the piece's sourceBookId (Book
// Details section, above the page-range fields — design doc §15). Styled
// like a plain text field (Title/Composer) rather than TagComboBox's
// pill-input treatment — there's exactly one value here, not a set, and
// it's picked from an existing catalog rather than typed/created freehand
// the way a tag is, so it reads better as "search" than "tag entry." A
// left-aligned search icon makes that read obvious at a glance.
//
// This field IS the mechanism that sets a piece's sourceBookId — selecting
// a result calls onChange with that book's real id, matching design doc
// §11's existing debounced search-as-you-type convention (BooksPage.tsx
// uses the same useDebouncedValue + listBooks pair for its own search
// bar). No create-new affordance: a source book must already exist (the
// field's own tooltip says so explicitly) — creating one is the Books
// library's separate "New Book" flow, not something to fold in here.
export function SourceBookField({
  value,
  onChange,
  initialTitle,
}: {
  value: number | null
  onChange: (next: number | null) => void
  initialTitle: string | null
}) {
  // Seeded once from the piece's current sourceBookTitle (already present
  // on the GET /api/pieces/:id response — no extra lookup needed just to
  // show the current value). Typing after that is a fresh search, tracked
  // independently of `value` until a suggestion is actually clicked.
  const [query, setQuery] = useState(initialTitle ?? '')
  const [open, setOpen] = useState(false)
  // Which result row Enter would pick — arrow keys move it, typing resets
  // it back to 0 so Enter always defaults to "the top result" without
  // requiring a press of ArrowDown first. Same convention as
  // TagComboBox's own highlightedIndex (the closest fit here, since this
  // is also a text-input-driven search over a filtered list, not
  // SingleSelect's fixed option set) — every dropdown-style field in this
  // app must support ArrowUp/Down/Enter, not just TagComboBox/SingleSelect.
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debouncedQuery = useDebouncedValue(query)

  const { data: results = [] } = useQuery({
    queryKey: ['books', 'search', debouncedQuery],
    queryFn: () => listBooks({ query: debouncedQuery }),
    enabled: open && debouncedQuery.trim() !== '',
  })

  function selectBook(book: { id: number; bookTitle: string }) {
    onChange(book.id)
    setQuery(book.bookTitle)
    setHighlightedIndex(0)
    setOpen(false)
    inputRef.current?.blur()
  }

  // ArrowUp/Down cycles the highlighted result (wrapping both ends);
  // Enter picks whichever row is currently highlighted. No create-new row
  // to fall through to here (unlike TagComboBox) — a source book must
  // already exist, so Enter is simply a no-op when there are no results.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter' && !event.shiftKey) {
      // Shift+Enter excluded — see TagComboBox's matching comment: it's
      // this app's form-save shortcut, even from a field with an open
      // dropdown.
      event.preventDefault()
      selectBook(results[highlightedIndex])
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="f-source-book" className="flex items-center gap-1 text-sm text-ink-soft">
        Source book
        <InfoTooltip
          message="Use this to match with an existing book. If the book hasn't been created yet, go do that and come back here."
          ariaLabel="What Source book means"
          triggerClassName="text-[#9d9892] hover:text-ink-soft"
        >
          <IconInfoCircle size={13} />
        </InfoTooltip>
      </label>
      <div className="relative">
        <IconSearch
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#9d9892]"
        />
        <input
          ref={inputRef}
          id="f-source-book"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setHighlightedIndex(0)
            // Typing always invalidates whatever was previously selected,
            // unconditionally — same "no half-matched state" principle as
            // TagComboBox, just without a create-new fallback (a source
            // book is picked from the existing catalog, not typed into
            // existence here). Deliberately not compared against the
            // current query/value first: selectBook below sets both query
            // and onChange together in one call, so this handler only
            // ever fires from real further typing, at which point the
            // selection is stale by definition regardless of what was
            // selected before.
            onChange(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search books by title…"
          className="w-full rounded-md border border-border bg-paper-raised py-2 pr-3 pl-9 text-ink"
        />
        {open && query.trim() !== '' && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-paper-raised py-1 shadow-lg">
            {results.length > 0 ? (
              results.map((book, index) => (
                <button
                  key={book.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectBook(book)}
                  className={`block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-accent-soft ${
                    book.id === value ? 'text-accent' : 'text-ink'
                  } ${index === highlightedIndex ? 'bg-accent-soft' : ''}`}
                >
                  {book.bookTitle}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-ink-soft/60 italic">No matching books</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
