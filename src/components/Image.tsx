import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ImageDimensions {
  width: number;
  height: number;
}

const FALLBACK_DIMENSION = 64;

export type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string;
  dataSrc?: string;
};

export const createGrayPreviewSrc = ({ width, height }: ImageDimensions) =>
  `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'><defs><linearGradient id='g' x1='-1' x2='0'><stop stop-color='%239ca3af' stop-opacity='.28'/><stop offset='.5' stop-color='%239ca3af' stop-opacity='.44'/><stop offset='1' stop-color='%239ca3af' stop-opacity='.28'/><animate attributeName='x1' from='-1' to='1' dur='1.2s' repeatCount='indefinite'/><animate attributeName='x2' from='0' to='2' dur='1.2s' repeatCount='indefinite'/></linearGradient></defs><rect width='100%' height='100%' fill='url(%23g)'/></svg>`;

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function shouldLazyLoadImage({
  src,
  dataSrc,
  alt,
  width,
  height,
}: {
  src?: string;
  dataSrc?: string;
  alt?: string;
  width: unknown;
  height: unknown;
}): boolean {
  if ((alt ?? "").startsWith("uploading:")) return false;

  const resolvedSrc = dataSrc ?? src ?? "";
  if (!resolvedSrc || resolvedSrc.startsWith("data:")) return false;

  const resolvedWidth = toPositiveNumber(width);
  const resolvedHeight = toPositiveNumber(height);
  return !!resolvedWidth && !!resolvedHeight;
}

export function setupLazyLoadingImages(container: HTMLElement): () => void {
  const images = Array.from(container.querySelectorAll("img"));
  const cleanupFunctions: Array<() => void> = [];

  let observer: IntersectionObserver | null = null;
  if (typeof window !== "undefined" && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const image = entry.target as HTMLImageElement;
          const dataSrc = image.getAttribute("data-src");
          if (dataSrc) {
            image.setAttribute("src", dataSrc);
            image.classList.remove("lazy-image-pending");
          }
          observer?.unobserve(image);
        }
      },
      { rootMargin: "600px" },
    );
  }

  for (const image of images) {
    const alt = image.getAttribute("alt") ?? "";
    if (alt.startsWith("uploading:")) continue;

    const dataSrc = image.getAttribute("data-src");
    if (!dataSrc || dataSrc.startsWith("data:")) continue;

    const alreadyPrepared = image.dataset.lazyPrepared === "true";
    const alreadyLoaded = image.getAttribute("src") === dataSrc;
    if (alreadyLoaded) {
      image.dataset.lazyPrepared = "true";
      image.classList.remove("lazy-image-pending");
      continue;
    }
    if (alreadyPrepared && alreadyLoaded) continue;

    image.dataset.lazyPrepared = "true";
    image.classList.add("lazy-image-pending");

    const handleLoad = () => {
      if (image.getAttribute("src") !== image.getAttribute("data-src")) {
        return;
      }
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        image.setAttribute("width", String(image.naturalWidth));
        image.setAttribute("height", String(image.naturalHeight));
      }
    };

    image.addEventListener("load", handleLoad);
    cleanupFunctions.push(() => image.removeEventListener("load", handleLoad));

    if (observer) {
      observer.observe(image);
      cleanupFunctions.push(() => observer.unobserve(image));
    } else {
      image.setAttribute("src", dataSrc);
    }
  }

  return () => {
    for (const cleanup of cleanupFunctions) cleanup();
    observer?.disconnect();
  };
}

export default function Image({
  src,
  dataSrc,
  alt,
  width,
  height,
  className,
  onLoad,
  loading,
  decoding,
  ...props
}: ImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);

  const resolvedDataSrc = dataSrc ?? src;
  const shouldLazyLoad = useMemo(
    () =>
      shouldLazyLoadImage({
        src,
        dataSrc,
        alt,
        width,
        height,
      }),
    [alt, dataSrc, height, src, width],
  );

  const resolvedWidth = toPositiveNumber(width) ?? FALLBACK_DIMENSION;
  const resolvedHeight = toPositiveNumber(height) ?? FALLBACK_DIMENSION;

  const initialSrc = useMemo(() => {
    if (!shouldLazyLoad || !resolvedDataSrc) {
      return src;
    }

    if (src && src !== resolvedDataSrc) {
      return src;
    }

    return createGrayPreviewSrc({
      width: resolvedWidth,
      height: resolvedHeight,
    });
  }, [resolvedDataSrc, resolvedHeight, resolvedWidth, shouldLazyLoad, src]);

  const [currentSrc, setCurrentSrc] = useState(initialSrc);
  const [isPending, setIsPending] = useState(shouldLazyLoad && currentSrc !== resolvedDataSrc);

  useEffect(() => {
    setCurrentSrc(initialSrc);
    setIsPending(shouldLazyLoad && initialSrc !== resolvedDataSrc);
  }, [initialSrc, resolvedDataSrc, shouldLazyLoad]);

  useEffect(() => {
    if (!shouldLazyLoad || !resolvedDataSrc) return;
    if (currentSrc === resolvedDataSrc) return;

    const element = imageRef.current;
    if (!element) return;

    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setCurrentSrc(resolvedDataSrc);
      setIsPending(false);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setCurrentSrc(resolvedDataSrc);
          setIsPending(false);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "600px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [currentSrc, resolvedDataSrc, shouldLazyLoad]);

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const target = event.currentTarget;
      const targetSrc = target.getAttribute("src");
      if (resolvedDataSrc && targetSrc === resolvedDataSrc) {
        if (!toPositiveNumber(width) && target.naturalWidth > 0) {
          target.setAttribute("width", String(target.naturalWidth));
        }
        if (!toPositiveNumber(height) && target.naturalHeight > 0) {
          target.setAttribute("height", String(target.naturalHeight));
        }
      }
      onLoad?.(event);
    },
    [height, onLoad, resolvedDataSrc, width],
  );

  return (
    <img
      {...props}
      ref={imageRef}
      src={currentSrc}
      data-src={resolvedDataSrc}
      alt={alt}
      width={width}
      height={height}
      loading={shouldLazyLoad ? "lazy" : loading}
      decoding={shouldLazyLoad ? "async" : decoding}
      onLoad={handleLoad}
      className={cn(className, isPending && "lazy-image-pending")}
    />
  );
}
