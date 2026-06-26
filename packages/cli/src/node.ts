import {
  loadOpenTrayRuntimeBinding,
  type OpenTrayVisibleRuntimeHostOptions,
  type ResolveRuntimeBindingOptions,
} from "./native-runtime";

export interface RunVisibleRuntimeHostOptions
  extends ResolveRuntimeBindingOptions,
    OpenTrayVisibleRuntimeHostOptions {}

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
