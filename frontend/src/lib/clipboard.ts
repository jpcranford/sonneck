// Shared by every click-to-copy affordance (Piece Details' citation and
// file-hash copy buttons) — pure logic, no markup, so it's one of the few
// things a mockup is allowed to import directly from the real app rather
// than keeping its own local copy (CLAUDE.md > Frontend's "pure
// presentational data/logic... is shared" exception).
//
// `navigator.clipboard.writeText` alone isn't enough: it only exists in a
// secure context (HTTPS, or localhost) — Firefox and Safari (desktop and
// iOS) enforce this strictly, so on a self-hosted app reached over plain
// HTTP on a LAN (the common case for this app — no reverse proxy/TLS by
// default), `navigator.clipboard` is `undefined` there. Because the old
// code called it as `navigator.clipboard?.writeText(text).catch(...)`,
// that optional chain short-circuited the *entire* expression the moment
// `.clipboard` was undefined — no error, nothing copied, and the caller
// had no way to tell the write never happened, so the "Copied!" toast
// fired regardless. `document.execCommand('copy')` (deprecated, but still
// universally supported, no secure-context requirement) is the fallback
// clipboard.js-style libraries have used for exactly this gap for years.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path below — a real, if rarer, case
      // too: the async Clipboard API can exist but still reject (a
      // permission prompt dismissed, an iframe without the right
      // `allow="clipboard-write"`, etc.).
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  // Off-screen, not just visually hidden — execCommand('copy') needs a
  // real text selection, so the element must actually be focusable/
  // selectable (display:none/visibility:hidden wouldn't work), just kept
  // out of the visible viewport and unable to trigger a scroll jump.
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  document.body.removeChild(textarea)
  return copied
}
