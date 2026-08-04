export const REACT_FALLBACK_BLOCK_NAME = "wpsuite/react-fallback";
export const REACT_FALLBACK_ATTRIBUTE = "data-wpsuite-react-fallback";
export const REACT_FALLBACK_SELECTOR = `[${REACT_FALLBACK_ATTRIBUTE}]`;

export interface ReactFallbackHandoff {
  cancel: () => void;
}

function getFallbackElements(host: ParentNode): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(REACT_FALLBACK_SELECTOR));
}

export function showReactFallback(host: ParentNode): void {
  getFallbackElements(host).forEach((fallback) => {
    fallback.hidden = false;
    fallback.removeAttribute("aria-hidden");
  });
}

export function dismissReactFallback(host: ParentNode): void {
  getFallbackElements(host).forEach((fallback) => {
    fallback.hidden = true;
    fallback.setAttribute("aria-hidden", "true");
  });
}

export function dismissReactFallbackWhenMounted(
  host: ParentNode,
  mountTarget: HTMLElement,
): ReactFallbackHandoff {
  let observer: MutationObserver | undefined;
  let cancelled = false;

  const dismissWhenReady = () => {
    if (cancelled || !mountTarget.hasChildNodes()) {
      return;
    }

    dismissReactFallback(host);
    observer?.disconnect();
    observer = undefined;
  };

  observer = new MutationObserver(dismissWhenReady);
  observer.observe(mountTarget, { childList: true });
  queueMicrotask(dismissWhenReady);

  return {
    cancel: () => {
      cancelled = true;
      observer?.disconnect();
      observer = undefined;
    },
  };
}
