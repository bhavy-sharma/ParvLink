"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 15000;

export function DashboardRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
