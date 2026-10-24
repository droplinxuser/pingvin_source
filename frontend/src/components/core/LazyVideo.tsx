import { VideoHTMLAttributes, useEffect, useRef, useState } from "react";

/**
 * Defers video metadata/first-frame requests until the element is near the
 * viewport. This prevents hidden galleries and trending cards from downloading
 * media that the visitor may never see.
 */
const LazyVideo = ({
  src,
  rootMargin = "300px",
  ...videoProps
}: VideoHTMLAttributes<HTMLVideoElement> & {
  src: string;
  rootMargin?: string;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [rootMargin]);

  return (
    <video
      ref={videoRef}
      {...videoProps}
      src={shouldLoad ? src : undefined}
      preload={shouldLoad ? "metadata" : "none"}
    />
  );
};

export default LazyVideo;
