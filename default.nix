{
 lib,
 buildNpmPackage,
 fetchFromGitHub,
 fetchurl,
 nodejs_22,
 makeWrapper,
}:

let
 ## MAP DATA
 releaseUrl = "https://github.com/Open-Historia/open-historia/releases/download/map-data";

 mapAssets = map (a: a // {
   file = fetchurl {
     url = "${releaseUrl}/${a.name}";
     hash = a.hash;
   };
 }) [
   { name = "regions.pmtiles";         dest = "public/assets/regions.pmtiles";         hash = "sha256-UQtoCL4EOdSuFAUySHgGzd6kfU606vmwssd+IskB4NQ="; }
   { name = "countries.pmtiles";       dest = "public/assets/countries.pmtiles";       hash = "sha256-WW49/7Crpb9vLdEDxEECBzAWHFW2emmT3D4PuST+Fyc="; }
   { name = "cities.pmtiles";          dest = "public/assets/cities.pmtiles";          hash = "sha256-Qe34RxFKDBsEyaEelQH8l+aAoQWy7GGPXK/8o99h6Ho="; }
   { name = "regions-seed.geojson";    dest = "public/assets/regions-seed.geojson";    hash = "sha256-XEaK4fwGB/kNGjDyLqEql6y8Rk9zOzB/wqGtMuxmCso="; }
   { name = "cities-seed.json";        dest = "public/assets/cities-seed.json";        hash = "sha256-IThlCRS4f6cDawZanRi9iMu5fsbGfp7CLyvhqfi/8QE="; }
   { name = "default-regions.geojson"; dest = "server/seed/default/regions.geojson";   hash = "sha256-TpKy+CEDBrhcUaiv/bGpK8Djqo/7Xc4TembAjHHMqoo="; }
 ];
in
buildNpmPackage {
 ## INFO
 pname = "open-historia";
 version = "0-unstable-2026-11-02";

 ## SOURCE
 src = fetchFromGitHub {
   owner = "Open-Historia";
   repo = "open-historia";
   rev = "e546bece80a03d9c3baf3d943fce5149ebd04ed9";
   hash = "sha256-vf/lk/+dEySvux4W516OXaXFDk4ORmpyamMxoUJPC3A=";
 };

 ## NODE
 nodejs = nodejs_22;
 npmDepsHash = "sha256-ZzxZStvdtGLPKIK7PypJwG3xGIlV4pxBrVmGwtHN4Mg=";
 env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

 nativeBuildInputs = [ makeWrapper ];

 ## MAP DATA INSTALL
 postPatch = lib.concatMapStrings (a: ''
   install -Dm644 ${a.file} ${a.dest}
 '') mapAssets;

 ## INSTALL
 ## INSTALL
 installPhase = ''
   runHook preInstall
   mkdir -p $out/lib/open-historia $out/bin
   cp -r . $out/lib/open-historia
   makeWrapper ${lib.getExe nodejs_22} $out/bin/open-historia \
     --run 'export OH_DATA_DIR="''${OH_DATA_DIR:-''${XDG_DATA_HOME:-$HOME/.local/share}/open-historia}"' \
     --run 'mkdir -p "$OH_DATA_DIR"' \
     --add-flags $out/lib/open-historia/server/server.js
   runHook postInstall
 '';

 ## METADATA
 meta = {
   description = "Open source alternative to Pax Historia";
   homepage = "https://github.com/Open-Historia/open-historia";
   license = lib.licenses.agpl3Plus;
   mainProgram = "open-historia";
 };
}
