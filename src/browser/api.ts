type ExtensionApi = typeof chrome & {
  sidebarAction?: { open(): Promise<void> };
};
function nativeApi(): ExtensionApi {
  const globals = globalThis as typeof globalThis & { browser?: ExtensionApi };
  return globals.browser ?? globals.chrome;
}
// Firefox's browser namespace provides Promise APIs; Chromium provides them on
// chrome. Resolve lazily so content/view/worker contexts share the same boundary.
export const extension = new Proxy({} as ExtensionApi, {
  get: (_target, property: keyof ExtensionApi) => nativeApi()?.[property],
});
export const isExtensionContext = () => !!nativeApi()?.runtime?.id;
