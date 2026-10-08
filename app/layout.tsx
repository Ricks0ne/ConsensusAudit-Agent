import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ConsensusAudit V2-PRO",
  description: "GenLayer intelligent contract security and deployment gatekeeper.",
  openGraph: {
    title: "ConsensusAudit V2-PRO",
    description: "An autonomous GenLayer protocol that uses AI consensus to resolve code disputes and natively gate escrow settlement.",
    url: "https://consensusaudit.vercel.app",
    siteName: "ConsensusAudit",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ConsensusAudit V2-PRO",
    description: "An autonomous GenLayer protocol that uses AI consensus to resolve code disputes and natively gate escrow settlement.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}