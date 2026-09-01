import { Link } from 'react-router-dom'
import type { Tag } from '../api/types'

// Renders an ordered composer/arranger credit list as real links to each
// Person's own Person Details page, joined with the same convention as
// lib/joinNames.ts's plain-text joinNames (2 -> "X and Y"; 3+ ->
// Oxford-comma "X, Y, and Z") — this is that helper's JSX-capable sibling,
// used wherever a credit list needs to stay clickable rather than collapse
// to one string. `people` is `Tag[]` (id/name), the same reused shape
// composer/arranger's EffectiveTagRefs already carries.
export function PersonNameLinks({ people, className }: { people: Tag[]; className?: string }) {
  return (
    <>
      {people.map((person, i) => (
        <span key={person.id}>
          {i > 0 && (i === people.length - 1 ? (people.length > 2 ? ', and ' : ' and ') : ', ')}
          <Link to={`/people/${person.id}`} className={className ?? 'hover:text-accent hover:underline'}>
            {person.name}
          </Link>
        </span>
      ))}
    </>
  )
}
