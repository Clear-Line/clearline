"use client";

import { useState } from "react";
import Navbar from "@/src/components/Navbar";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        Hi
      </main>
    </>
  );
}
