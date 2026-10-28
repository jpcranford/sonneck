import { isHomeScreenApp } from './homeScreenApp'
import { showAlert } from './dialogs'

// Downloading a same-origin file (components/DownloadLink.tsx is the link
// form): a home-screen web app can't follow a download link, so it fetches
// the file and saves it through a blob URL instead.

// The file's own suggested name (Content-Disposition), else a fallback.
function filenameFrom(response: Response): string {
  const header = response.headers.get('Content-Disposition') ?? ''
  const star = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) return decodeURIComponent(star[1])
  const plain = header.match(/filename="?([^";]+)"?/i)
  return plain ? plain[1] : 'download.pdf'
}

// Fetches the file (same-origin, so the app's own session cookie applies)
// and saves it through a blob URL + `download` attribute.
export async function downloadViaBlob(href: string) {
  const response = await fetch(href, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Could not load the file.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filenameFrom(response)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // The OS viewer/download may still be reading it after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Starts a download from code (a button that has to do something first, like
// the Sheet Viewer saving marks), the way a DownloadLink tap would: a blob
// download in a home-screen web app, else a click on a real `<a download>`,
// which the desktop app's link handler (lib/nativeLinks.ts) also catches.
export function startDownload(href: string) {
  if (isHomeScreenApp()) {
    downloadViaBlob(href).catch(() => showAlert('Could not download the file.'))
    return
  }
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = ''
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
