import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Navbar } from "../components/Navbar";
import { AppFooter } from "../components/AppFooter";

export const metadata: Metadata = {
  title: "Clearline Terminal",
  description: "Prediction Market Intelligence — The Bloomberg Terminal for Polymarket",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider signInUrl="/sign-in">
      <html lang="en">
        <body suppressHydrationWarning className="min-h-screen bg-[#080b12]">
          <Navbar />
          <main>{children}</main>
          <AppFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
