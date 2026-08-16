import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

interface ClickableCardProps {
  to: string
  className: string
  children: ReactNode
}

// Card root for PieceGridCard/PieceListCard. A plain <button> won't work
// here — PageCycleControl and TagPills render their own interactive
// elements inside the card, and nesting a <button> inside a <button> is
// invalid HTML (React warns and it breaks click targeting). This gives the
// same click/keyboard-activatable behavior via a div with role="button".
export function ClickableCard({ to, className, children }: ClickableCardProps) {
  const navigate = useNavigate()

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(to)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') navigate(to)
      }}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </div>
  )
}
