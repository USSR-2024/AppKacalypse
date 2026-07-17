import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // metadataBase обязателен: без него относительный og:image остаётся относительным,
  // а мессенджеру нужен абсолютный URL — картинка в карточке просто не появится.
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://appka.space"),
  title: "appka.space",
  description: "Задачи, встречи и расшифровки в одном месте",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "appka.space" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    siteName: "appka.space",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "appka.space" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

// Ставит тему из localStorage ДО первой отрисовки (без мигания). Дефолт — тёмная.
const themeScript = `(function(){try{var t=localStorage.getItem('akc_theme');document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
