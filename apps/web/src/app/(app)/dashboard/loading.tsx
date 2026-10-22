export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy>
      <div className="h-10 w-64 rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="h-80 rounded-xl bg-muted lg:col-span-2" />
        <div className="h-80 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
