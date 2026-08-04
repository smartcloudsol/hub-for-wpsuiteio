export declare const REACT_FALLBACK_BLOCK_NAME = "wpsuite/react-fallback";
export declare const REACT_FALLBACK_ATTRIBUTE = "data-wpsuite-react-fallback";
export declare const REACT_FALLBACK_SELECTOR = "[data-wpsuite-react-fallback]";
export interface ReactFallbackHandoff {
    cancel: () => void;
}
export declare function showReactFallback(host: ParentNode): void;
export declare function dismissReactFallback(host: ParentNode): void;
export declare function dismissReactFallbackWhenMounted(host: ParentNode, mountTarget: HTMLElement): ReactFallbackHandoff;
