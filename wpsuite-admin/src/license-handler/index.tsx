import "@aws-amplify/ui-react/styles.css";
import { Skeleton } from "@mantine/core";
import {
  useEffect,
  type Dispatch,
  type FunctionComponent,
  type PropsWithChildren,
  type SetStateAction,
} from "react";
import { Settings } from "./settings";

export interface LicenseHandlerProps extends PropsWithChildren {
  amplifyConfigured: boolean;
  apiUrl: string;
  stripePublicKey: string;
  pricingTable: string;
  ownAccountId?: string;
  accountId?: string;
  siteId?: string;
  siteKey?: string;
  nonce: string;
  setAccountId: Dispatch<SetStateAction<string | undefined>>;
  setSiteId: Dispatch<SetStateAction<string | undefined>>;
  setSiteKey: Dispatch<SetStateAction<string | undefined>>;
}

export const LicenseHandler: FunctionComponent<LicenseHandlerProps> = (
  props: LicenseHandlerProps
) => {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/pricing-table.js";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return (
    <Skeleton
      visible={props.amplifyConfigured === undefined}
      width="100%"
      mt="md"
    >
      <Settings {...props} />
    </Skeleton>
  );
};
