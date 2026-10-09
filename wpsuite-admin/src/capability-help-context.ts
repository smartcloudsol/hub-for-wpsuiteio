import { createContext, useContext } from "react";
import type { SurfaceHelpTopic } from "./navigation";

export const HelpContext = createContext<{ topics: SurfaceHelpTopic[]; open: (id: string) => void }>({ topics: [], open: () => undefined });
export const useSurfaceHelp = () => useContext(HelpContext);
