// The desktop app (Wails) shows Sonneck in a bare web view with no browser
// around it, so a link to another site — the footer's GitHub link, Admin's
// "version X available" pill, IMSLP and Wikipedia links, a link inside a
// Markdown description — would either do nothing or take over the app's
// own window. In the native app every such click goes to the system's
// default browser instead (Wails' BrowserOpenURL). Links within Sonneck
// itself are left alone, and in a browser none of this is installed.
export function installNativeExternalLinks() {
  const open = window.runtime?.BrowserOpenURL
  if (!open) return

  const handle = (event: MouseEvent) => {
    // A primary or middle click only, and only if nothing else (a card's
    // nested button, a router link) already took it.
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) return
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    let url: URL
    try {
      url = new URL(link.href, window.location.href)
    } catch {
      return
    }
    if (url.origin === window.location.origin) return
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return
    event.preventDefault()
    open(url.href)
  }
  document.addEventListener('click', handle)
  document.addEventListener('auxclick', handle)
}
