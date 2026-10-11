"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markMatchesSeenAction } from "@/app/(student)/matches/actions";

export function MatchReadMarker() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    markMatchesSeenAction()
      .then((success) => {
        if (active && success) router.refresh();
      })
      .catch((actionError) => {
        console.error("[matches.mark-seen]", actionError);
      });
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
