export default function DashboardLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="h-4 w-96 bg-muted rounded" />
      <div className="h-32 w-full bg-muted rounded-lg" />
    </div>
  );
}
