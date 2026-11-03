# Open Historia as a Nix package: the local server and the game it serves.
#
# Built from this checkout, so nothing here names a commit. The npm packages
# come from package-lock.json (importNpmLock: every entry carries its own
# integrity hash, so there is no npmDepsHash to keep up to date), and the map
# files from scripts/map-assets.json, the same list and checksums the desktop
# app downloads. The one hash kept here is the Fantasy Map Generator's zip,
# pinned by commit in scripts/fmg-vendor.mjs.
#
#   nix build              ./result/bin/open-historia
#   nix run                serves the game at http://localhost:3000
#
# The Nix store is read-only, so the launcher keeps the player's games,
# scenarios and settings in $OH_DATA_DIR (default
# $XDG_DATA_HOME/open-historia, else ~/.local/share/open-historia), and points
# the server at the map files in the store.
{
  lib,
  buildNpmPackage,
  importNpmLock,
  fetchurl,
  nodejs_22,
  makeWrapper,
  version ? "unstable",
}:

let
  root = ./.;
  # The checkout without what is built, installed or kept by a running server.
  src = lib.cleanSourceWith {
    src = lib.cleanSource root;
    filter =
      path: type:
      let
        relative = lib.removePrefix "${toString root}/" (toString path);
      in
      !(lib.elem relative [
        "node_modules"
        "dist"
        "dist-web"
        "dist-android"
        "dist-site"
        "release"
        "result"
        "fmg"
        "map-cache"
        "server/data"
      ]);
  };

  manifest = lib.importJSON ./scripts/map-assets.json;
  mapAssets = map (asset: {
    inherit (asset) path;
    file = fetchurl {
      name = asset.asset;
      url = "https://github.com/${manifest.owner}/${manifest.repo}/releases/download/${manifest.release}/${asset.asset}";
      sha256 = asset.sha256;
    };
  }) manifest.assets;
  # The files the browser reads from /assets: they go into the build, which copies public/ into dist/.
  servedAssets = lib.filter (asset: lib.hasPrefix "public/assets/" asset.path && !(lib.hasSuffix ".pmtiles" asset.path)) mapAssets;
  # The ones the server reads itself: kept once, in $out/share, never copied into dist/.
  serverAssets = lib.filter (asset: !(lib.elem asset servedAssets)) mapAssets;

  # scripts/fmg-vendor.mjs FMG_ZIP_URL (v1.109); change both together.
  fmgZip = fetchurl {
    name = "fantasy-map-generator-v1.109.zip";
    url = "https://codeload.github.com/Azgaar/Fantasy-Map-Generator/zip/50f51bd8380a7fddc27977f96fa9c1db4b7cdd1e";
    sha256 = "4062933ba6713b361f74d973819d05effded5f7674a37a628e2e5e722b295047";
  };

  share = "share/open-historia";
in
buildNpmPackage {
  pname = "open-historia";
  inherit version src;

  nodejs = nodejs_22;
  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  env = {
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    OH_FMG_ZIP = "${fmgZip}";
  };

  nativeBuildInputs = [ makeWrapper ];

  postPatch = lib.concatMapStrings (asset: ''
    install -Dm644 ${asset.file} ${asset.path}
  '') servedAssets;

  # The game (vite build into dist/) and the map generator's prepared copy (fmg/dist).
  npmBuildScript = "build";
  postBuild = ''
    node scripts/fetch-fmg.mjs --required
  '';

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --no-audit --no-fund

    app=$out/lib/open-historia
    mkdir -p $app $out/bin $out/${share}
    cp -r dist fmg server src scripts node_modules package.json $app/
    ${lib.concatMapStrings (asset: ''
      install -Dm444 ${asset.file} $out/${share}/${asset.path}
    '') serverAssets}

    # The stock world map every scenario without a map of its own is drawn on:
    # the server looks for it in its data folder, so each start links the
    # store's copy there (a newer package's copy replaces an older one's).
    makeWrapper ${lib.getExe nodejs_22} $out/bin/open-historia \
      --run 'export OH_DATA_DIR="''${OH_DATA_DIR:-''${XDG_DATA_HOME:-$HOME/.local/share}/open-historia}"' \
      --run 'mkdir -p "$OH_DATA_DIR/stock"' \
      --run "ln -sfn $out/${share}/server/data/stock/regions.geojson \"\$OH_DATA_DIR/stock/regions.geojson\"" \
      --set-default OH_ASSETS_DIR $out/${share}/public/assets \
      --add-flags $app/server/server.js

    runHook postInstall
  '';

  meta = {
    description = "Free, open source alternative to Pax Historia: an AI-driven grand strategy game served from your own machine";
    homepage = "https://github.com/Open-Historia/open-historia";
    license = lib.licenses.agpl3Plus;
    mainProgram = "open-historia";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
