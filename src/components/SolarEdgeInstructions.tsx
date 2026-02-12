"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function SolarEdgeInstructions() {
  const t = useTranslations("system");
  const [open, setOpen] = useState(false);

  const steps = [
    {
      title: t("instructionStep1Title"),
      desc: t("instructionStep1Desc", {
        link: "monitoring.solaredge.com",
      }),
      hasLink: true,
    },
    {
      title: t("instructionStep2Title"),
      desc: t("instructionStep2Desc"),
    },
    {
      title: t("instructionStep3Title"),
      desc: t("instructionStep3Desc"),
    },
    {
      title: t("instructionStep4Title"),
      desc: t("instructionStep4Desc"),
    },
  ];

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-blue-700 dark:text-blue-300"
      >
        <span className="flex items-center gap-2">
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
            />
          </svg>
          {t("instructionsTitle")}
        </span>
        <svg
          className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
          />
        </svg>
      </button>

      {/* Expandable content */}
      {open && (
        <div className="border-t border-blue-200 px-4 pb-4 pt-3 dark:border-blue-800">
          <div className="space-y-4">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-200 text-sm font-bold text-blue-700 dark:bg-blue-800 dark:text-blue-300">
                  {i + 1}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {step.title}
                  </h4>
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                    {step.hasLink ? (
                      <>
                        {step.desc.split("monitoring.solaredge.com")[0]}
                        <a
                          href="https://monitoring.solaredge.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 underline hover:text-blue-500 dark:text-blue-400"
                        >
                          monitoring.solaredge.com
                        </a>
                        {step.desc.split("monitoring.solaredge.com")[1]}
                      </>
                    ) : (
                      step.desc
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
            <strong>💡 Tip:</strong>{" "}
            Keep your API key private. It gives access to your system&apos;s monitoring data.
            YieldGuard stores it securely and only uses it to fetch your energy data.
          </div>
        </div>
      )}
    </div>
  );
}

