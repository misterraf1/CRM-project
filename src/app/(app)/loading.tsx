import { PageSkeleton } from "@/components/ui/PageSkeleton";

// Navigation paints this at once; the page streams in when its data is ready
export default function Loading() {
  return <PageSkeleton />;
}
