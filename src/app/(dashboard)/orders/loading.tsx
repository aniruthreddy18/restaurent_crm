export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-8 w-56 rounded-lg" />
      <div className="skeleton h-10 w-full rounded-lg" />
      <div className="skeleton h-96 w-full rounded-xl" />
    </div>
  );
}
