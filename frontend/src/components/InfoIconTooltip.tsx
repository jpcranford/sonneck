import { IconInfoCircle } from '@tabler/icons-react'
import { InfoTooltip } from './InfoTooltip'

interface InfoIconTooltipProps {
  message: string
  ariaLabel: string
}

/**
 * The app's one "circle info icon" tooltip trigger — a small `?`-style
 * hint next to a field label, distinct from `InheritedNote`'s pill shape
 * and the public-domain badge's own bare status icon. Centralizes what
 * used to be copy-pasted at every call site (`EditBookModal.tsx`,
 * `EditPieceModal.tsx` ×4, `SourceBookField.tsx`, `BookUploadAboutStep.tsx`,
 * the Admin Users permission grid): the icon itself, its size (13, no
 * per-caller exceptions — the Admin Users grid used to pass a denser 12,
 * direct instruction removed that variance), and its trigger color — solid
 * pre-blend `#9d9892`, never a translucent opacity utility, since
 * `IconInfoCircle` is multi-path and a translucent color re-blends
 * unevenly at the overlaps (CLAUDE.md's own standing icon-color rule —
 * violated at one of the sites this replaced, `AdminPage.tsx`'s permission
 * grid, before this consolidation caught it).
 */
export function InfoIconTooltip({ message, ariaLabel }: InfoIconTooltipProps) {
  return (
    <InfoTooltip message={message} ariaLabel={ariaLabel} triggerClassName="text-[#9d9892] hover:text-ink-soft">
      <IconInfoCircle size={13} />
    </InfoTooltip>
  )
}
