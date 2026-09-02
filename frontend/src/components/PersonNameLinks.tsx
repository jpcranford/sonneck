import { Link } from 'react-router-dom'
import type { Tag } from '../api/types'

// Renders an ordered composer/arranger credit list as real links to each
// Person's own Person Details page, joined with the same convention as
// lib/joinNames.ts's plain-text joinNames (2 -> "X and Y"; 3+ ->
// Oxford-comma "X, Y, and Z") — this is that helper's JSX-capable sibling,
// used wherever a credit list needs to stay clickable rather than collapse
// to one string. `people` is `Tag[]` (id/name), the same reused shape
// composer/arranger's EffectiveTagRefs already carries.
//
// Wrapped in one outer <span>, not a bare Fragment — real bug found live
// (2026-09-02, direct report + a downloaded PDF's own filename as the
// second clue): PiecePage.tsx's composer row passes this component's output
// straight into EffectiveValue's `value` prop, which renders inside an
// `inline-flex ... gap-1.5` wrapper. A Fragment has no DOM node of its own,
// so its children (one <span> per person, from the map below) flattened
// into becoming *direct* flex children of that gap-1.5 row — meaning the
// gap applied between every person's own <span>, not just once between the
// whole name list and the "inherited" badge as intended. That put a stray
// ~6px gap right before each comma separator, rendering as "Jimmy Page ,
// John Paul Jones , and John Bonham" instead of "Jimmy Page, John Paul
// Jones, and John Bonham". A single wrapping <span> here means this
// component is always exactly one flex child, regardless of what flex
// context a future caller renders it inside.
export function PersonNameLinks({ people, className }: { people: Tag[]; className?: string }) {
  return (
    <span>
      {people.map((person, i) => (
        <span key={person.id}>
          {i > 0 && (i === people.length - 1 ? (people.length > 2 ? ', and ' : ' and ') : ', ')}
          <Link to={`/people/${person.id}`} className={className ?? 'hover:text-accent hover:underline'}>
            {person.name}
          </Link>
        </span>
      ))}
    </span>
  )
}
