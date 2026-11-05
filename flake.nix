{
  description = "Open Historia: a free, open source alternative to Pax Historia";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # The day of the commit built (or "dirty" for a checkout with changes), as the package's version.
      version = "0-unstable-${
        if self ? lastModifiedDate then builtins.substring 0 8 self.lastModifiedDate else "dirty"
      }";
      package = pkgs: pkgs.callPackage ./default.nix { inherit version; };
    in
    {
      packages = forAllSystems (pkgs: rec {
        open-historia = package pkgs;
        default = open-historia;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          program = nixpkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          meta.description = "Serve Open Historia at http://localhost:3000";
        };
      });

      # Node and git for working on the game: `nix develop`, then `npm ci` and `npm run dev`.
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.git
          ];
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
        };
      });

      overlays.default = final: _prev: { open-historia = package final; };

      # services.open-historia: the server as a system service (nix/module.nix).
      nixosModules.default = import ./nix/module.nix self;

      checks = forAllSystems (pkgs: {
        package = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt);
    };
}
