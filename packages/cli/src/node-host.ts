import {
  loadOpenTrayRuntimeBinding,
  type OpenTrayVisibleRuntimeHostOptions,
  type ResolveRuntimeBindingOptions,
} from "./native-runtime";

/** Options for resolving the native binding and running the visible host loop. */
export interface RunVisibleRuntimeHostOptions
  extends ResolveRuntimeBindingOptions,
    OpenTrayVisibleRuntimeHostOptions {}

/** Run the visible native host loop on the caller-owned Node main thread. */
export const runVisibleRuntimeHost = async ({
  platform,
  arch,
  resolvePackageJson,
  nativeLoader,
  ...hostOptions
}: RunVisibleRuntimeHostOptions = {}): Promise<void> => {
  const binding = await loadOpenTrayRuntimeBinding({
    ...(platform === undefined ? {} : { platform }),
    ...(arch === undefined ? {} : { arch }),
    ...(resolvePackageJson === undefined ? {} : { resolvePackageJson }),
    ...(nativeLoader === undefined ? {} : { nativeLoader }),
  });
  if (binding.runVisibleRuntimeHost === undefined) {
    throw new Error(
      "OpenTray runtime binding does not expose runVisibleRuntimeHost()"
    );
  }
  binding.runVisibleRuntimeHost(hostOptions);
};

export {
  MissingPlatformRuntimeBindingError,
  resolveInstalledRuntimeBindingPath,
  resolveRuntimeNativeTarget,
  loadOpenTrayRuntimeBinding,
  type OpenTrayRuntimeBinding,
  type OpenTrayRuntimeBindingInfo,
  type OpenTrayVisibleRuntimeHostOptions,
  type ResolveRuntimeBindingOptions,
  type RuntimeNativeTarget,
} from "./native-runtime";
export {
  createRuntimeBindingTransport,
  type CreateRuntimeBindingTransportOptions,
} from "./runtime-binding-transport";
