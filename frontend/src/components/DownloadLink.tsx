import type { MouseEvent, ReactNode, Ref } from 'react'
import { isHomeScreenApp } from '../lib/homeScreenApp'
import { showAlert } from '../lib/dialogs'
import { downloadViaBlob } from '../lib/download'

interface DownloadLinkProps {
  // A same-origin file endpoint, e.g. getPieceFileUrl(id).
  href: string
  className: string
  children: ReactNode
  /** The link itself — a keyboard shortcut clicks it, so a shortcut
   * download goes exactly the way a click does. */
  ref?: Ref<HTMLAnchorElement>
}

// A file-download link. In a normal browser tab it's a plain
// `<a href download>`, unchanged. In a home-screen web app (lib/
// homeScreenApp.ts) every plain link form — `download`, `target="_blank"`,
// even `Content-Disposition: attachment` — just shows the PDF inside the
// chrome-less app window with no way back, so the tap fetches the file
// itself and hands it over as a blob download instead: iOS opens its own
// PDF viewer (close/back, plus share and open-in-browser), other platforms
// save it normally.
export function DownloadLink({ href, className, children, ref }: DownloadLinkProps) {
  if (!isHomeScreenApp()) {
    return (
      <a ref={ref} href={href} download className={className}>
        {children}
      </a>
    )
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    downloadViaBlob(href).catch(() => showAlert('Could not download the file.'))
  }

  return (
    <a ref={ref} href={href} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}
