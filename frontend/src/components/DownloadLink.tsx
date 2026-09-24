import type { MouseEvent, ReactNode } from 'react'
import { isHomeScreenApp } from '../lib/homeScreenApp'

interface DownloadLinkProps {
  // A same-origin file endpoint, e.g. getPieceFileUrl(id).
  href: string
  className: string
  children: ReactNode
}

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
async function downloadViaBlob(href: string) {
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

// A file-download link. In a normal browser tab it's a plain
// `<a href download>`, unchanged. In a home-screen web app (lib/
// homeScreenApp.ts) every plain link form — `download`, `target="_blank"`,
// even `Content-Disposition: attachment` — just shows the PDF inside the
// chrome-less app window with no way back, so the tap fetches the file
// itself and hands it over as a blob download instead: iOS opens its own
// PDF viewer (close/back, plus share and open-in-browser), other platforms
// save it normally.
export function DownloadLink({ href, className, children }: DownloadLinkProps) {
  if (!isHomeScreenApp()) {
    return (
      <a href={href} download className={className}>
        {children}
      </a>
    )
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    downloadViaBlob(href).catch(() => window.alert('Could not download the file.'))
  }

  return (
    <a href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}
