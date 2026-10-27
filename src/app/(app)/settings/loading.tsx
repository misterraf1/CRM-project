import { PageSkeleton } from "@/components/ui/PageSkeleton";

// Keeps the settings tabs on screen while the next tab loads
export default function Loading() {
  return <PageSkeleton tiles={false} />;
}
