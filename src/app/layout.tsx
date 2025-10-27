import type { Metadata } from "next";

// NOTE: Styling
import { Geist, Geist_Mono } from "next/font/google";
import '@mantine/core/styles.css';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import MantineRegistry from './mantine-registry';

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
  title: "J&G's CMS",
  description: "Jimmy & Gloria's Content Management System",
};

// NOTE: Main
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <MantineRegistry>{children}</MantineRegistry>
      </body>
    </html>
  );
}
