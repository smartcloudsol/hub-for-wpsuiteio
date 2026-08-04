import {
  InnerBlocks,
  useBlockProps,
  useInnerBlocksProps,
} from "@wordpress/block-editor";
import {
  getBlockType,
  registerBlockType,
  type BlockAttribute,
} from "@wordpress/blocks";
import { __ } from "@wordpress/i18n";
import type { ReactNode } from "react";

import metadata from "./fallback/block.json";
import { REACT_FALLBACK_BLOCK_NAME } from "./runtime";

const TEXT_DOMAIN = "wpsuite";

function Edit() {
  const blockProps = useBlockProps();
  const innerBlocksProps = useInnerBlocksProps(blockProps, {
    renderAppender: InnerBlocks.ButtonBlockAppender,
  });

  return (
    <div
      {...innerBlocksProps}
      data-wpsuite-react-fallback=""
      aria-label={__("React fallback content", TEXT_DOMAIN)}
    />
  );
}

function Save() {
  const blockProps = useBlockProps.save();
  const { children, ...innerBlocksProps } =
    useInnerBlocksProps.save(blockProps);

  return (
    <div {...innerBlocksProps} data-wpsuite-react-fallback="">
      {children as ReactNode}
    </div>
  );
}

export function registerReactFallbackBlock(): void {
  if (getBlockType(REACT_FALLBACK_BLOCK_NAME)) {
    return;
  }

  registerBlockType(REACT_FALLBACK_BLOCK_NAME, {
    apiVersion: metadata.apiVersion,
    attributes: {} as Record<string, BlockAttribute>,
    title: __(metadata.title, TEXT_DOMAIN),
    category: metadata.category,
    description: __(metadata.description, TEXT_DOMAIN),
    parent: metadata.parent,
    supports: metadata.supports,
    textdomain: TEXT_DOMAIN,
    icon: "welcome-widgets-menus",
    edit: Edit,
    save: Save,
  });
}

export { REACT_FALLBACK_BLOCK_NAME };
