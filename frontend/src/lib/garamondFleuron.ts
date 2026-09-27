import svgSource from '../assets/ornaments/garamond-fleuron.svg?raw'

// The Garamond fleuron (assets/ornaments/garamond-fleuron.svg, credited in
// the README's Acknowledgements) as path data, read from that one file so
// it can be drawn inline with any fill color: a single even-odd path,
// nearly square.
export const GARAMOND_FLEURON_VIEWBOX = svgSource.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 99.55 100'
export const GARAMOND_FLEURON_PATH = svgSource.match(/ d="([^"]+)"/)?.[1] ?? ''

// Width over height, for sizing it by height.
export const GARAMOND_FLEURON_ASPECT = 99.55 / 100
