"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Slides a section up as it scrolls into view (movement only, never invisible text). Server HTML is fully visible (no JS,
 * crawlers, reduced motion); only sections still below the fold start hidden.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"static" | "hidden" | "shown">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState("hidden");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={clsx("transition-all duration-700 ease-out", state === "hidden" && "translate-y-10", className)}>
      {children}
    </div>
  );
}
