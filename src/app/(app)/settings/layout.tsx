import { SettingsTabs } from "@/components/settings/SettingsTabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
