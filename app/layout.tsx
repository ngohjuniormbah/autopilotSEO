import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AutopilotSEO — Get Found on Google. Get Recommended by AI.",
    template: "%s | AutopilotSEO",
  },
  description:
    "Audit, improve, and monitor your search visibility across Google and supported AI-powered search platforms.",
  openGraph: {
    title: "AutopilotSEO — Search visibility, on autopilot",
    description:
      "Get found on Google and observed across AI-powered search. Audit, improve, and monitor your visibility.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
