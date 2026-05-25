"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasStoredAuthToken } from "./auth";

export function useRequireAuth(): boolean {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!hasStoredAuthToken()) {
      router.replace("/login");
      return;
    }

    setChecking(false);
  }, [router]);

  return checking;
}

export function useRedirectIfAuthenticated(path = "/cases"): boolean {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (hasStoredAuthToken()) {
      router.replace(path);
      return;
    }

    setChecking(false);
  }, [path, router]);

  return checking;
}
