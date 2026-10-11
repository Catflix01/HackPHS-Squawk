"use client";

import { useEffect, useState } from "react";

const message = "Welcome back, pilot";

export function TypingGreeting() {
  const [visible, setVisible] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      Promise.resolve(message).then(setVisible);
      return;
    }
    const reset = window.setTimeout(() => setVisible(""), 0);
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(message.slice(0, index));
      if (index === message.length) window.clearInterval(timer);
    }, 60);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(timer);
    };
  }, [reducedMotion]);

  return (
    <h1 aria-label={message} className="font-display text-4xl font-semibold tracking-tight text-[#E6EDF5] sm:text-6xl">
      {visible}
      <span aria-hidden="true" className="ml-1 inline-block h-[0.8em] w-[0.55em] animate-pulse bg-[#F5B83D] align-[-0.08em]" />
    </h1>
  );
}
