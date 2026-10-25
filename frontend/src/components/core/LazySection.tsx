import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Defers mounting a below-the-fold section until it is about to enter the
 * viewport. The placeholder stays in the document before that point, so the
 * surrounding layout keeps its height and loading the section never shifts the
 * page. The observer is disconnected after the first intersection; a section
 * that was already rendered is not hidden again when it scrolls out of view.
 */
const LazySection = ({
  children,
  placeholder,
  rootMargin = "400px",
  minHeight,
  className,
  id,
  testId,
  busy = false,
}: {
  children: ReactNode;
  placeholder: ReactNode;
  rootMargin?: string;
  minHeight?: number | string;
  className?: string;
  id?: string;
  testId?: string;
  busy?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        // A fast jump (End key, anchor, restored scroll) can leave the element
        // above the viewport without ever reporting an intersection. Mount it
        // in that case too instead of leaving the placeholder behind.
        if (!entry.isIntersecting && entry.boundingClientRect.top >= 0) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <div
      ref={ref}
      id={id}
      className={className}
      data-testid={testId}
      aria-busy={busy || undefined}
      style={minHeight === undefined ? undefined : { minHeight }}
    >
      {isVisible ? children : placeholder}
    </div>
  );
};

export default LazySection;
