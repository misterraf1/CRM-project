import { redirect } from "next/navigation";

// Settings sections arrive one by one; members is the first one that is live.
export default function SettingsPage() {
  redirect("/settings/members");
}
