export default function Loading() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-8 w-48 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[86px] rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-xl" />
    </div>
  );
}
