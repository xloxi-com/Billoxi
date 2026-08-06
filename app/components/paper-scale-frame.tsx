import { memo, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders children at natural paper size, then uniformly scales down to fit
 * the parent so Preview stays layout-identical (esp. A4 landscape).
 *
 * The paper is positioned absolutely while measuring so a full 210mm sheet
 * cannot expand the parent (which made template cards blow up on refresh).
 */
export const PaperScaleFrame = memo(function PaperScaleFrame({
  children,
  className,
  fit = "width",
}: {
  children: ReactNode;
  className?: string;
  /** `width` = fit parent width (may crop height). `contain` = fit both axes, no crop. */
  fit?: "width" | "contain";
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  // useEffect (not useLayoutEffect) — safe on SSR; avoids hydration warnings.
  useEffect(() => {
    const outer = outerRef.current;
    const measure = measureRef.current;
    if (!outer || !measure) return;

    const update = () => {
      // offsetWidth/Height ignore CSS transform — natural paper size
      const width = measure.offsetWidth;
      const height = measure.offsetHeight;
      if (width <= 0 || height <= 0) return;

      const availableW = Math.max(0, outer.clientWidth - 2);
      const availableH = Math.max(0, outer.clientHeight - 2);

      // Parent not laid out yet — wait for the next ResizeObserver pass
      // instead of falling back to scale=1 (full A4 blows up cards).
      if (fit === "contain" && (availableW <= 0 || availableH <= 0)) return;
      if (fit === "width" && availableW <= 0) return;

      const scaleW = availableW / width;
      const scaleH = availableH > 0 ? availableH / height : Number.POSITIVE_INFINITY;
      const next =
        fit === "contain"
          ? Math.min(1, scaleW, scaleH)
          : Math.min(1, scaleW);

      if (!Number.isFinite(next) || next <= 0) return;

      setScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
      setNatural((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      );
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(outer);
    ro.observe(measure);
    // One more pass after paint — grid/aspect-ratio often settles late on refresh.
    const raf = requestAnimationFrame(() => update());
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [fit]);

  const ready = natural.width > 0 && scale > 0;
  const scaledWidth = ready ? natural.width * scale : undefined;
  const scaledHeight = ready ? natural.height * scale : undefined;

  return (
    <div
      ref={outerRef}
      className={`paper-scale-frame${className ? ` ${className}` : ""}`}
      style={{
        width: "100%",
        maxWidth: "100%",
        height: fit === "contain" ? "100%" : undefined,
        display: "flex",
        justifyContent: "center",
        alignItems: fit === "contain" ? "center" : "flex-start",
        overflow: fit === "contain" ? "hidden" : "auto",
        minWidth: 0,
        minHeight: fit === "contain" ? 0 : undefined,
      }}
    >
      <div
        className="paper-scale-frame__viewport"
        style={{
          width: scaledWidth ?? (fit === "contain" ? "100%" : undefined),
          height: scaledHeight ?? (fit === "contain" ? "100%" : undefined),
          maxWidth: "100%",
          position: "relative",
          flex: "0 0 auto",
          overflow: "hidden",
          // Reserve space only after measure — avoids 210mm layout thrash.
          visibility: ready ? "visible" : "hidden",
        }}
      >
        <div
          ref={measureRef}
          className="paper-scale-frame__inner"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "fit-content",
            transform: `scale(${ready ? scale : 0.001})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
});
