import type { Metadata } from "next";
import { WidgetChat } from "@/components/widget/WidgetChat";

export const metadata: Metadata = { title: "Chat", robots: { index: false } };

type Props = { params: Promise<{ key: string }> };

/** Public page rendered inside the website-chat iframe. */
export default async function WidgetPage({ params }: Props) {
  const { key } = await params;
  return <WidgetChat widgetKey={key} />;
}
