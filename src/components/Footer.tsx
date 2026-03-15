"use client";

import { useTranslations } from "next-intl";
import { LogoIcon } from "@/components/Logo";

export default function Footer() {
  const tc = useTranslations("common");

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2 text-sm text-muted">
          <LogoIcon className="h-4 w-4 text-brand" />
          <span>{tc("footer", { year: new Date().getFullYear() })}</span>
        </div>
        <div className="flex gap-4 text-xs text-muted-light">
          <span>v0.1</span>
        </div>
      </div>
    </footer>
  );
}
