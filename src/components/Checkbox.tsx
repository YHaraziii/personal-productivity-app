import { useEffect, useState, type InputHTMLAttributes } from 'react'

/**
 * A checkbox whose new state shows immediately while the local write runs.
 * The value written to IndexedDB then flows back as `checked`; if the write
 * fails, the box returns to the stored value.
 */
export function OptimisticCheckbox({
  checked,
  onCheckedChange,
  ...rest
}: { checked: boolean; onCheckedChange: (next: boolean) => Promise<void> } & Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'type' | 'onToggle'>) {
  const [shown, setShown] = useState(checked)
  useEffect(() => setShown(checked), [checked])
  return (
    <input
      {...rest}
      type="checkbox"
      checked={shown}
      onChange={(e) => {
        const next = e.target.checked
        setShown(next)
        void onCheckedChange(next).catch(() => setShown(checked))
      }}
    />
  )
}
