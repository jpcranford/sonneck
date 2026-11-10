import { Fragment } from 'react'

/** A duration ("4:25") in the app's time figures (`time-figures`,
 * index.css: Atkinson Hyperlegible Next, tabular, a little letter spacing),
 * at 400. The Sheet Viewer's clock uses the same figures at 500.
 * The font's colons sit on the baseline, so each is raised 0.09em,
 * centering it on the figures (measured from the font's outlines). */
export function TimeText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`time-figures font-normal whitespace-nowrap ${className}`}>
      {text.split(':').map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="relative -top-[0.09em]">:</span>}
          {part}
        </Fragment>
      ))}
    </span>
  )
}
