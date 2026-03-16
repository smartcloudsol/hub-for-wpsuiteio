import { getWpSuite } from "@smart-cloud/wpsuite-core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";

function onDomReady(fn: () => void) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

onDomReady(async () => {
  const wpSuite = getWpSuite();
  if (
    wpSuite?.siteSettings?.reCaptchaPublicKey &&
    !document.querySelector(
      `[smartcloud-wpsuite-recaptcha-provider-${wpSuite.siteSettings.reCaptchaPublicKey}]`,
    )
  ) {
    const el = document.createElement("div");
    el.id = "smartcloud-wpsuite-recaptcha-provider";
    el.setAttribute(
      `smartcloud-wpsuite-recaptcha-provider-${wpSuite.siteSettings.reCaptchaPublicKey}`,
      "true",
    );
    document.body.appendChild(el);
    const observer = new MutationObserver(() => {
      const badge = document.querySelector(".grecaptcha-badge");
      if (badge) {
        (badge as HTMLElement).style.visibility = "hidden";
        (badge as HTMLElement).style.display = "none";
        //observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    createRoot(el).render(
      <StrictMode>
        <GoogleReCaptchaProvider
          reCaptchaKey={wpSuite.siteSettings.reCaptchaPublicKey}
          useEnterprise={wpSuite.siteSettings.useRecaptchaEnterprise}
          useRecaptchaNet={wpSuite.siteSettings.useRecaptchaNet}
          scriptProps={{ async: true, defer: true }}
        >
          <></>
        </GoogleReCaptchaProvider>
      </StrictMode>,
    );
  }
});
