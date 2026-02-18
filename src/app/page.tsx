"use client";

import { useState } from "react";
import Navbar from "@/src/components/Navbar";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  return (
    <>
      <Navbar
        isLoggedIn={isLoggedIn}
        onAuthAction={() => setIsLoggedIn((prev) => !prev)}
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Welcome to Clearline
        </h1>
        <p className="text-lg text-gray-500 mb-8 max-w-xl mx-auto">
          Real-time market intelligence, wallet tracking, and predictive analytics — all in one place.
        </p>
        <p className="text-sm text-gray-400">
          Auth state: <span className="font-semibold text-blue-600">{isLoggedIn ? "Logged in" : "Logged out"}</span>
          {" "}— click <strong>Sign in / Sign out</strong> in the navbar to toggle.
        </p>
      </main>
    </>
  );
}
