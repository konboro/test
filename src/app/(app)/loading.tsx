/**
 * The panel's loading state.
 *
 * Its absence was the single biggest cause of the navigation feeling slow, and
 * not because rendering a skeleton is fast. Next refuses to prefetch a route
 * that has no loading boundary — it sends the router state and nothing else —
 * so every click performed the whole dynamic render from scratch, and with no
 * boundary to paint the browser sat on the previous page showing nothing at all
 * until the last query returned.
 *
 * With this file the data is prefetched on hover and the click has something to
 * show immediately.
 */
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-ink-100" />

      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-ink-200 bg-white" />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        <div className="h-12 animate-pulse border-b border-ink-100 bg-ink-50" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 animate-pulse border-b border-ink-100 last:border-0" />
        ))}
      </div>
    </div>
  );
}
