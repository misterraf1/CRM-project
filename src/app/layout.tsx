import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";
import { APP_NAME } from "@/lib/config";
import { themeInitScript } from "@/lib/theme/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await getI18n();
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans">
        <I18nProvider locale={locale} t={t}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
