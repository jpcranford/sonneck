import { ApiError } from '../api/client'
import { openNativeFile, saveNativeFile } from '../api/native'
import { showAlert } from './dialogs'

// The desktop app (Wails) shows Sonneck in a bare web view with no browser
// around it, so links that rely on the browser do nothing there:
//
//   - A link to another site (the footer's GitHub link, Admin's "version X
//     available" pill, IMSLP and Wikipedia links, a link in a Markdown
//     description) opens in the system's default browser instead (Wails'
//     BrowserOpenURL).
//   - A download link to Sonneck's own files (`<a download>`: Download PDF,
//     Download Set PDF) shows a native Save dialog instead, and a link that
//     opens one of Sonneck's own files in a new window (`target="_blank"`
//     to /api/: Book Details' Open PDF) opens it in the system's default
//     app instead — both through the server (api/native.ts), which fetches
//     the file as the signed-in user.
//
// Every other link is left alone, and in a browser none of this is
// installed.
export function installNativeExternalLinks() {
  const openExternal = window.runtime?.BrowserOpenURL
  if (!openExternal) return

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

    if (url.origin !== window.location.origin) {
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return
      event.preventDefault()
      openExternal(url.href)
      return
    }

    const path = url.pathname + url.search
    if (!url.pathname.startsWith('/api/')) return
    if (link.hasAttribute('download')) {
      event.preventDefault()
      saveNativeFile(path).catch((error) => showAlert(fileErrorMessage(error, 'save')))
    } else if (link.target === '_blank') {
      event.preventDefault()
      openNativeFile(path).catch((error) => showAlert(fileErrorMessage(error, 'open')))
    }
  }
  document.addEventListener('click', handle)
  document.addEventListener('auxclick', handle)
}

function fileErrorMessage(error: unknown, action: 'save' | 'open'): string {
  return error instanceof ApiError ? error.message : `Could not ${action} the file.`
}
