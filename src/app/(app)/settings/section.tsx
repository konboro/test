/**
 * A heading between groups of settings cards.
 *
 * The page grew by accretion — every integration added a card at the bottom —
 * until twelve cards sat in the order they happened to be built. That order
 * asks the reader to hold the whole page in their head to find anything.
 *
 * Grouped, it answers four questions in the order somebody actually has them:
 * who we are, what goes out, how they pay, and where the numbers come from.
 * Deliberately not tabs or an accordion: settings are read far less often than
 * they are searched, and browser find-in-page only works on what is rendered.
 */
export function SettingsSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="pt-4 first:pt-0">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-400">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">{body}</p>
    </div>
  );
}
