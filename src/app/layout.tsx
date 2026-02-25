import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { Navbar } from "./components/Navbar";
import { AppFooter } from "./components/AppFooter";

export const metadata: Metadata = {
  title: "Clearline",
  description: "The intelligence layer for prediction markets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider signInUrl="/sign-in">
      <html lang="en">
        <body className="min-h-screen bg-gray-50">
          <Navbar />
          <main>{children}</main>
          <AppFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
