import { AuthFrame } from "@/components/auth/AuthFrame";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
