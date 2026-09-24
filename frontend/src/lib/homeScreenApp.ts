// Whether the app is running as an installed home-screen web app ("Add to
// Home Screen" — manifest.webmanifest's `display: standalone`): a
// chrome-less window with no browser UI, where an in-place file download
// either does nothing or strands the user on the file with no way back.
// `navigator.standalone` is iOS Safari's own older flag for the same thing.
export function isHomeScreenApp(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

