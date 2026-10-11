import "@fontsource-variable/figtree";
import "@fontsource-variable/bricolage-grotesque";
import "./globals.css";

import Script from "next/script";

export const metadata = {
  title: {
    default: "Campus Partner Finder",
    template: "%s · Campus Partner Finder",
  },
  description: "Find a partner or a team for events at your college.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b2fb8",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>

        {children}

        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-W9TXQ99V9X"
          strategy="afterInteractive"
        />

        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag() {
              window.dataLayer.push(arguments);
            }
            gtag('js', new Date());
            gtag('config', 'G-W9TXQ99V9X');
          `}
        </Script>
      </body>
    </html>
  );
}
