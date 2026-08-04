# `@smart-cloud/wpsuite-blocks`

Shared Gutenberg blocks and React fallback lifecycle helpers for WP Suite plugins.

The package provides the `wpsuite/react-fallback` block. Its nested core blocks are saved as ordinary Gutenberg HTML, so WordPress can return useful content before JavaScript, authentication, or a plugin store is ready. A consuming React root keeps that fallback visible until its mount target receives the rendered interface.

## Editor integration

Register the block once from the consuming block editor entry point:

```ts
import { registerReactFallbackBlock } from "@smart-cloud/wpsuite-blocks/editor";

registerReactFallbackBlock();
```

Allow `REACT_FALLBACK_BLOCK_NAME` in the parent block's `InnerBlocks` configuration. The fallback block is restricted to the supported WP Suite React parent blocks in its metadata.

## Runtime integration

Render the saved fallback beside an initially empty React mount target. Keep it visible during asynchronous initialization, then hand it off when React commits content:

```ts
import {
  dismissReactFallbackWhenMounted,
  showReactFallback,
} from "@smart-cloud/wpsuite-blocks";

showReactFallback(host);
const handoff = dismissReactFallbackWhenMounted(host, mountTarget);

try {
  root.render(<App />);
} catch (error) {
  handoff.cancel();
  showReactFallback(host);
  throw error;
}
```

The runtime helper hides fallback elements only after the mount target contains rendered content. If initialization fails before that point, the server-rendered fallback remains available.

## Exports

- `@smart-cloud/wpsuite-blocks`: block constants and fallback lifecycle helpers
- `@smart-cloud/wpsuite-blocks/editor`: idempotent Gutenberg block registration
