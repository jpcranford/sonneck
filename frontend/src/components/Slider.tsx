import type { CSSProperties, InputHTMLAttributes } from 'react'

// The app's one slider look (index.css's .slider), picked from a
// side-by-side: drawn rather than the browser's own, which tinted with
// `accent` turns pale sage in the dark theme and looks different in every
// browser. Built like the switch: deep green up to a white knob, here
// ringed in green so it stays visible on a white window. A real range
// input underneath, so the keyboard and screen readers work as usual.
type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'min' | 'max' | 'onChange'
> & {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

export function Slider({
  value,
  min,
  max,
  onChange,
  className = '',
  style,
  ...inputProps
}: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      {...inputProps}
      className={`slider ${className}`}
      style={{ ...style, '--slider-fill': `${fill}%` } as CSSProperties}
    />
  )
}
