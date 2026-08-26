import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { remarkMusicEmoji } from '../lib/musicEmoji'

// Renders free-text Markdown fields (piece/book description, a piece's own
// notes) with the app's own type/color tokens — react-markdown ships no
// styling of its own, so every element it can produce gets an explicit
// mapping here rather than leaking unstyled browser defaults.
//
// No rehype-raw (no raw HTML passthrough): these are plain fields someone
// types into a textarea, not authored documents, so there's no reason to
// widen what's accepted beyond Markdown syntax itself.
//
// remark-breaks turns a single Enter into a line break. Plain CommonMark
// requires a blank line between paragraphs, which reads as "my line break
// got silently eaten" to someone who just typed a note and pressed Enter
// once — this matches what a plain-textarea author actually expects.
//
// Headings render as bold, same-size text rather than real h1-h3 — these
// fields sit inside a page section that already owns its own heading
// hierarchy, so letting user text render a page-title-sized heading would
// be visually out of proportion to where it's embedded.
//
// remarkMusicEmoji (frontend/src/lib/musicEmoji.ts) turns a supported
// `:shortcode:` into a plain Unicode character; font-music on the wrapper
// below (index.css) is what actually renders that character as a music
// symbol via Bravura Text's unicode-range, scoped to just this component's
// output rather than app-wide.
const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent/80"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-paper-sunken px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-ink-soft">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  h1: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h2: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h3: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h4: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h5: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
  h6: ({ children }) => <p className="mb-2 font-semibold last:mb-0">{children}</p>,
}

export function MarkdownText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`font-music ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkMusicEmoji, remarkBreaks]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
