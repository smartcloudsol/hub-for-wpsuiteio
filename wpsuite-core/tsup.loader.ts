export interface Constants {
  __OB_KEY_EXPR__?: number;
  __X_EXPR__?: string;
  __Y_EXPR__?: string;
}

export async function loadConstants(): Promise<Constants> {
  const c: { constants: Constants } = await import("./scripts/constants").catch(
    () => {
      console.warn("scripts/constants not found, using default constants");
      return {
        constants: {},
      };
    }
  );
  return c.constants;
}
