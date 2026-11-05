# services.open-historia: the Open Historia server as a NixOS service.
#
#   imports = [ open-historia.nixosModules.default ];
#   services.open-historia.enable = true;
#
# It listens on localhost only unless `host` says otherwise (the server's own
# OH_HOST); the players' games live in `dataDir`.
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.open-historia;
in
{
  options.services.open-historia = {
    enable = lib.mkEnableOption "the Open Historia game server";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "open-historia.packages.\${system}.default";
      description = "The Open Historia package to run.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "The port the game is served on.";
    };

    host = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "0.0.0.0";
      description = ''
        The address to listen on (OH_HOST). Null keeps the server's own
        choice: this machine only, until the game's "Let other devices
        connect" setting opens it.
      '';
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/open-historia";
      description = "Where the games, scenarios and settings are kept.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open `port` in the firewall.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        OH_DISCORD_PRESENCE = "0";
      };
      description = "More environment for the server.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.open-historia = {
      description = "Open Historia game server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      environment = {
        OH_DATA_DIR = cfg.dataDir;
        PORT = toString cfg.port;
        HOME = cfg.dataDir;
      }
      // lib.optionalAttrs (cfg.host != null) { OH_HOST = cfg.host; }
      // cfg.environment;
      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = lib.mkIf (cfg.dataDir == "/var/lib/open-historia") "open-historia";
        Restart = "on-failure";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ cfg.dataDir ];
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
