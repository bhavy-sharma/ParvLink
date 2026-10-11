import { LoadingRegion, Skeleton } from "@/components/ui/misc";

export default function StudentLoading() {
  return (
    <LoadingRegion className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    </LoadingRegion>
  );
}
