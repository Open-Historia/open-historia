import os from "node:os";
import path from "node:path";

export const NATIVE_DATA_NAME = "Open Historia Native";
export const STABLE_DATA_NAME = "open-historia";

export const appDataDir = ({ env = process.env, platform = process.platform, home = os.homedir() } = {}) => {
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  if (platform === "win32") return env.APPDATA || join(home, "AppData", "Roaming");
  if (platform === "darwin") return join(home, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || join(home, ".config");
};

export const nativeDataPaths = (options = {}) => {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  const appData = appDataDir(options);
  const dataRoot = env.OH_NATIVE_ROOT || join(appData, NATIVE_DATA_NAME);
  return {
    appData,
    dataRoot,
    dataDir: join(dataRoot, "server", "data"),
    nativeDir: join(dataRoot, "native"),
    cacheDir: join(dataRoot, "native-cache"),
    ownAssets: join(dataRoot, "public", "assets"),
    stableAssets: join(appData, STABLE_DATA_NAME, "public", "assets"),
    stablePublic: join(appData, STABLE_DATA_NAME, "public"),
  };
};
