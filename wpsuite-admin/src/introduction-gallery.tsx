import { Image, Modal, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __, sprintf } from "@wordpress/i18n";
import { useEffect, useState } from "react";

type Illustration = { src: string; title: string };
type IllustratedProduct = "answers" | "forms-workflows";

declare global {
  interface Window {
    smartcloudWpSuiteIllustrations?: Partial<Record<IllustratedProduct, Illustration[]>>;
  }
}

/** Images remain owned by each plugin; the shared introduction only presents them. */
export default function IntroductionGallery({ id }: { id: string }) {
  const product = id === "answers" || id === "forms-workflows" ? id : undefined;
  const readImages = () => product ? window.smartcloudWpSuiteIllustrations?.[product] ?? [] : [];
  const [images, setImages] = useState<Illustration[]>(readImages);
  const [active, setActive] = useState<Illustration | null>(null);

  useEffect(() => {
    const refresh = () => setImages(product ? window.smartcloudWpSuiteIllustrations?.[product] ?? [] : []);
    refresh();
    window.addEventListener("smartcloud-wpsuite-illustrations-ready", refresh);
    return () => window.removeEventListener("smartcloud-wpsuite-illustrations-ready", refresh);
  }, [product]);

  if (!images.length) return null;

  return <>
    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm" mt="md" style={{ maxWidth: "42rem" }}>
      {images.map(image => <UnstyledButton key={image.src} type="button"
        aria-label={sprintf(__("Enlarge screenshot: %s", TEXT_DOMAIN), image.title)}
        onClick={() => setActive(image)}
        style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: "var(--mantine-radius-sm)", padding: "0.5rem", background: "var(--mantine-color-body)" }}>
        <Stack gap="xs">
          <Image src={image.src} alt="" h={120} fit="contain" loading="lazy" />
          <Text size="xs" fw={600}>{image.title}</Text>
        </Stack>
      </UnstyledButton>)}
    </SimpleGrid>
    <Modal opened={active !== null} onClose={() => setActive(null)} title={active?.title}
      centered size="70rem" zIndex={100001}
      closeButtonProps={{ "aria-label": __("Close screenshot", TEXT_DOMAIN) }}>
      {active && <Image src={active.src} alt={active.title} style={{ width: "100%", height: "auto" }} />}
    </Modal>
  </>;
}
