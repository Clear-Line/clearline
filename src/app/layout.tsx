"use client";

import "./globals.css";
import Navbar from "@/src/components/Navbar";
import { useState } from "react";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <>
      <html lang="en">
        <body>
          <Navbar
            isLoggedIn={isLoggedIn}
            onAuthAction={() => setIsLoggedIn((prev) => !prev)}
          />
          <main>{children}</main>
        </body>
      </html>
    </>
  );
}
