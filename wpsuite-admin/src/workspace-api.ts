import * as Api from "@aws-amplify/api";
import { getWpSuite } from "@smart-cloud/wpsuite-core";
import { record, resolveApiMode, settingsView, workspaceLicenseRequestPath, workspaceRequestPath, workspaceResponseView } from "./workspace-compat";

/** The mode is an explicit operator setting; HTTP errors never switch protocols. */
export function workspacePath(path: string): string {
  return workspaceRequestPath(path, resolveApiMode(getWpSuite()?.siteSettings));
}

export function workspaceLicensePath(path: string): string {
  return workspaceLicenseRequestPath(path, resolveApiMode(getWpSuite()?.siteSettings));
}

type Operation = ReturnType<typeof Api.get>;
type Request = Parameters<typeof Api.get>[0];
function adaptOperation(input: Request, operation: Operation, method: string): Operation {
  const path = workspacePath(input.path);
  if (path === input.path || method === "DELETE") return operation;
  return {
    ...operation,
    response: operation.response.then((response) => ({
      ...response,
      body: {
        ...response.body,
        json: async () => {
          const body = await response.body.json();
          if (method === "GET" && /\/site\/[^/]+\/settings$/.test(path)) {
            return settingsView(body) as Awaited<ReturnType<typeof response.body.json>>;
          }
          return workspaceResponseView(path, body, input.options?.queryParams ? record(input.options.queryParams) : {}) as Awaited<ReturnType<typeof response.body.json>>;
        },
      },
    })),
  };
}
export const get: typeof Api.get = (input) => adaptOperation(input, Api.get({ ...input, path: workspacePath(input.path) }), "GET");
export const patch: typeof Api.patch = (input) => adaptOperation(input, Api.patch({ ...input, path: workspacePath(input.path) }), "PATCH");
export const post: typeof Api.post = (input) => adaptOperation(input, Api.post({ ...input, path: workspacePath(input.path) }), "POST");
export const put: typeof Api.put = (input) => adaptOperation(input, Api.put({ ...input, path: workspacePath(input.path) }), "PUT");
export const del: typeof Api.del = (input) => adaptOperation(input, Api.del({ ...input, path: workspacePath(input.path) }), "DELETE");
