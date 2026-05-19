import { useEffect } from "react";
import { router } from "expo-router";
import { NotFoundScreen } from "@/components/NotFoundScreen";

export default function NotFound() {
  // Redirect home once, after mount — never during render, so a bad route
  // can't drive an infinite render loop. The screen shows briefly (or stays
  // if the redirect itself fails), making the real problem visible instead
  // of masking it in a "Maximum update depth exceeded" loop.
  useEffect(() => {
    const t = setTimeout(() => router.replace("/"), 0);
    return () => clearTimeout(t);
  }, []);

  return <NotFoundScreen message="That screen doesn't exist." />;
}
