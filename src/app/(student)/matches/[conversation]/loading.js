import { LoadingRegion, Skeleton } from "@/components/ui/misc";

export default function ChatLoading() {
  return (
    <LoadingRegion label="Loading conversation" className="space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-12 w-1/2" />
      <Skeleton className="h-12 w-3/5" />
    </LoadingRegion>
  );
}
