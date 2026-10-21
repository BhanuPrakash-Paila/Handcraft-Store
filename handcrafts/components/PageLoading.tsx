export function PageLoading({ label = "Loading the collection…" }: { label?: string }) {
  return <div className="page-loading" role="status" aria-live="polite">{label}</div>;
}
