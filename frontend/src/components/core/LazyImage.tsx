import { ImgHTMLAttributes, useState } from "react";

/**
 * A native lazy-loaded image with a lightweight animated placeholder. The
 * shimmer lives on the image element itself, so callers keep their existing
 * layout and absolute-positioning styles.
 */
const LazyImage = ({
  className,
  onLoad,
  onError,
  alt = "",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) => {
  const [loaded, setLoaded] = useState(false);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt}
      className={["lazy-image", loaded ? "lazy-image-loaded" : "", className]
        .filter(Boolean)
        .join(" ")}
      loading={props.loading ?? "lazy"}
      decoding={props.decoding ?? "async"}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        setLoaded(true);
        onError?.(event);
      }}
    />
  );
};

export default LazyImage;
