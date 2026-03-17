import type { NodeViewRendererProps } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Markdown as MarkdownExt } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

const MIN_IMAGE_SIZE = 48;
const RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];

function parsePositiveIntAttr(
  element: HTMLElement,
  name: string,
): number | null {
  const value = element.getAttribute(name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => parsePositiveIntAttr(element, "width"),
      },
      height: {
        default: null,
        parseHTML: (element) => parsePositiveIntAttr(element, "height"),
      },
      dataSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-src"),
        renderHTML: (attributes) => {
          if (!attributes.dataSrc) return {};
          return { "data-src": attributes.dataSrc };
        },
      },
      uploading: {
        default: false,
        parseHTML: (element) => element.hasAttribute("data-uploading"),
        renderHTML: (attributes) => {
          if (!attributes.uploading) return {};
          return { "data-uploading": "" };
        },
      },
    };
  },
  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const wrapper = document.createElement("span");
      wrapper.className = "image-node-view";
      wrapper.contentEditable = "false";

      const image = document.createElement("img");
      image.draggable = false;
      wrapper.appendChild(image);

      const resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "image-size-reset";
      resetButton.setAttribute("aria-label", "Reset image size");

      const resetIcon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      resetIcon.setAttribute("viewBox", "0 0 24 24");
      resetIcon.setAttribute("aria-hidden", "true");
      resetIcon.classList.add("image-size-reset-icon");

      const resetPath = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      resetPath.setAttribute("d", "M3 12a9 9 0 1 0 3-6.708M3 4v5h5");
      resetPath.setAttribute("fill", "none");
      resetPath.setAttribute("stroke", "currentColor");
      resetPath.setAttribute("stroke-width", "2");
      resetPath.setAttribute("stroke-linecap", "round");
      resetPath.setAttribute("stroke-linejoin", "round");
      resetIcon.appendChild(resetPath);
      resetButton.appendChild(resetIcon);
      wrapper.appendChild(resetButton);

      for (const direction of RESIZE_DIRECTIONS) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "image-resize-handle";
        handle.dataset.direction = direction;
        handle.setAttribute("aria-label", `Resize image ${direction}`);
        wrapper.appendChild(handle);
      }

      let currentNode = props.node;
      let originalSize: { width: number; height: number } | null = null;
      let originalSizeFetchSource = "";
      type DragState = {
        direction: ResizeDirection;
        pointerId: number;
        startX: number;
        startY: number;
        startWidth: number;
        startHeight: number;
        aspectRatio: number;
        originalWidth: number;
        originalHeight: number;
      };
      let drag: DragState | null = null;
      let draftSize: { width: number; height: number } | null = null;

      const dispatchSize = (width: number, height: number) => {
        const pos = props.getPos();
        if (typeof pos !== "number") return;
        const nodeAtPos = props.view.state.doc.nodeAt(pos);
        if (!nodeAtPos || nodeAtPos.type.name !== "image") return;

        props.view.dispatch(
          props.view.state.tr.setNodeMarkup(pos, undefined, {
            ...nodeAtPos.attrs,
            width,
            height,
          }),
        );
      };

      const applyNodeToElement = () => {
        const attrs = currentNode.attrs as Record<string, unknown>;
        image.className =
          typeof props.HTMLAttributes.class === "string"
            ? props.HTMLAttributes.class
            : "";

        image.src = typeof attrs.src === "string" ? attrs.src : "";
        image.alt = typeof attrs.alt === "string" ? attrs.alt : "";
        if (typeof attrs.title === "string" && attrs.title.length > 0) {
          image.title = attrs.title;
        } else {
          image.removeAttribute("title");
        }

        const width = positiveNumber(attrs.width);
        const height = positiveNumber(attrs.height);
        const source =
          (typeof attrs.dataSrc === "string" && attrs.dataSrc) ||
          (typeof attrs.src === "string" && attrs.src) ||
          "";
        const placeholderSrc = typeof attrs.src === "string" ? attrs.src : "";
        const dataSrc =
          typeof attrs.dataSrc === "string" && attrs.dataSrc.length > 0
            ? attrs.dataSrc
            : null;

        if (width && height) {
          image.style.width = `${width}px`;
          image.style.height = "auto";
        } else {
          image.style.removeProperty("width");
          image.style.removeProperty("height");
        }

        // Keep real image src if lazy-loading already swapped to data-src.
        const currentSrc = image.getAttribute("src");
        if (
          !(dataSrc && currentSrc === dataSrc && placeholderSrc !== dataSrc)
        ) {
          image.src = placeholderSrc;
        }

        if (dataSrc) {
          image.setAttribute("data-src", dataSrc);
        } else {
          image.removeAttribute("data-src");
        }

        if (attrs.uploading) {
          image.setAttribute("data-uploading", "");
        } else {
          image.removeAttribute("data-uploading");
        }

        const hasManualSize =
          !!width &&
          !!height &&
          !!originalSize &&
          (width !== originalSize.width || height !== originalSize.height);
        resetButton.disabled = !hasManualSize;
        resetButton.hidden = !hasManualSize;

        if (originalSizeFetchSource !== source) {
          originalSizeFetchSource = source;
          originalSize = null;
        }

        if (!attrs.uploading && source && !originalSize) {
          const imageData = new window.Image();
          imageData.onload = () => {
            const naturalWidth = imageData.naturalWidth;
            const naturalHeight = imageData.naturalHeight;
            if (!naturalWidth || !naturalHeight) return;
            if (originalSizeFetchSource !== source) return;
            originalSize = { width: naturalWidth, height: naturalHeight };
          };
          imageData.src = source;
        }
      };

      const stopDragging = () => {
        if (drag && draftSize) {
          dispatchSize(draftSize.width, draftSize.height);
        }
        drag = null;
        draftSize = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointerId) return;

        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        const signedDx = drag.direction.includes("w") ? -dx : dx;
        const signedDy = drag.direction.includes("n") ? -dy : dy;

        const widthScale = (drag.startWidth + signedDx) / drag.startWidth;
        const heightScale = (drag.startHeight + signedDy) / drag.startHeight;
        const scale =
          drag.direction === "e" || drag.direction === "w"
            ? widthScale
            : drag.direction === "n" || drag.direction === "s"
              ? heightScale
              : Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
                ? widthScale
                : heightScale;

        const minScale = Math.max(
          MIN_IMAGE_SIZE / drag.startWidth,
          MIN_IMAGE_SIZE / drag.startHeight,
        );
        const containerWidth =
          props.view.dom instanceof HTMLElement
            ? props.view.dom.clientWidth
            : 0;
        const maxScale =
          containerWidth > 0
            ? containerWidth / drag.startWidth
            : Number.POSITIVE_INFINITY;
        const clampedScale = Math.min(Math.max(scale, minScale), maxScale);

        const width = Math.max(
          MIN_IMAGE_SIZE,
          Math.round(drag.startWidth * clampedScale),
        );
        const height = Math.max(
          MIN_IMAGE_SIZE,
          Math.round(width / drag.aspectRatio),
        );

        image.style.width = `${width}px`;
        image.style.height = "auto";
        draftSize = { width, height };
        resetButton.disabled = false;
        resetButton.hidden = false;
      };

      const onPointerUp = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        stopDragging();
      };

      for (const handle of wrapper.querySelectorAll<HTMLElement>(
        ".image-resize-handle",
      )) {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
          if (!props.editor.isEditable || currentNode.attrs.uploading) return;
          event.preventDefault();
          event.stopPropagation();

          const attrs = currentNode.attrs as Record<string, unknown>;
          const width =
            positiveNumber(attrs.width) ||
            image.clientWidth ||
            image.naturalWidth ||
            MIN_IMAGE_SIZE;
          const height =
            positiveNumber(attrs.height) ||
            image.clientHeight ||
            image.naturalHeight ||
            MIN_IMAGE_SIZE;
          const originalWidth = originalSize?.width || width;
          const originalHeight = originalSize?.height || height;
          const direction = handle.getAttribute(
            "data-direction",
          ) as ResizeDirection;

          drag = {
            direction,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: width,
            startHeight: height,
            aspectRatio: width / height,
            originalWidth,
            originalHeight,
          };
          draftSize = null;
          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", onPointerUp);
          window.addEventListener("pointercancel", onPointerUp);
        });
      }

      resetButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!props.editor.isEditable) return;
        if (!originalSize) return;
        dispatchSize(originalSize.width, originalSize.height);
      });

      applyNodeToElement();

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "image") return false;
          currentNode = updatedNode;
          applyNodeToElement();
          return true;
        },
        selectNode: () => {
          wrapper.classList.add("ProseMirror-selectednode");
        },
        deselectNode: () => {
          wrapper.classList.remove("ProseMirror-selectednode");
          stopDragging();
        },
        stopEvent: (event) => {
          const target = event.target;
          return (
            target instanceof HTMLElement &&
            !!target.closest(".image-resize-handle, .image-size-reset")
          );
        },
        ignoreMutation: () => true,
        destroy: () => {
          stopDragging();
        },
      };
    };
  },
}).configure({
  inline: true,
  allowBase64: false,
  HTMLAttributes: {
    class: "not-prose",
  },
});

export const baseExtensions = [
  StarterKit.configure({ undoRedo: false }),
  MarkdownExt,
  CustomImage,
];
