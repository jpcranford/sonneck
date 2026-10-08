// Ellipsized text (`truncate`, `line-clamp-*`) shows its full text in the
// system's own tooltip on hover — a plain `title`, never InfoTooltip — but
// only while it's actually cut off. One document-level listener, installed
// once in main.tsx, so every truncated title app-wide gets it with nothing
// to add per element. A `title` a component set itself is left alone.

const TRUNCATED = '.truncate, [class*="line-clamp-"]'
const OWN_TITLE = 'truncationTitle'

function syncTitle(el: HTMLElement) {
  if (el.hasAttribute('title') && !(OWN_TITLE in el.dataset)) return
  const cut = el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
  const text = el.innerText.replace(/\s+/g, ' ').trim()
  if (cut && text) {
    el.title = text
    el.dataset[OWN_TITLE] = ''
  } else if (OWN_TITLE in el.dataset) {
    el.removeAttribute('title')
    delete el.dataset[OWN_TITLE]
  }
}

export function installTruncationTitles() {
  document.addEventListener('mouseover', (event) => {
    if (!(event.target instanceof Element)) return
    // Every truncated box under the pointer, innermost first — a cut-off
    // title can sit inside another truncated box.
    for (
      let el = event.target.closest(TRUNCATED);
      el;
      el = el.parentElement?.closest(TRUNCATED) ?? null
    ) {
      if (el instanceof HTMLElement) syncTitle(el)
    }
  })
}
