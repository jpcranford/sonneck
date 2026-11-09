/** Ref callback for a list's thumbnail `<img>`: when the image leaves the
 * page (navigating away, a filter change) before it has loaded, its
 * download is dropped. A browser keeps loading a removed image, and with
 * only about six connections to one server over plain HTTP, a page of cold
 * thumbnails (each drawn by the server on first request) otherwise holds
 * them all and the next page's own data waits seconds behind it. The
 * server keeps drawing a dropped thumbnail and caches it anyway.
 *
 * Checked a moment later, and only if the image is really off the page:
 * React's StrictMode (in development) runs this cleanup once on a
 * still-mounted image, and React doesn't set `src` again afterward. */
export function cancelImageOnUnmount(img: HTMLImageElement | null) {
  if (!img) return
  return () => {
    setTimeout(() => {
      if (!img.isConnected && !img.complete) img.removeAttribute('src')
    }, 0)
  }
}
