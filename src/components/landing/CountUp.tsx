"use client";

import { useEffect, useRef, useState } from "react";

/** A number that glides to its new value (instantly under reduced motion). */
export function CountUp({ value, format, ms = 600 }: { value: number; format: (v: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      from.current = value;
    };
  }, [value, ms]);
  return <>{format(shown)}</>;
}
