# Container image factory for building OCI images
{ lib, pkgs }:
let
  # Common OCI labels for all images
  commonLabels = {
    "org.opencontainers.image.vendor" = "hyperdx";
    "org.opencontainers.image.licenses" = "MIT";
  };

  # Common packages needed for TLS and timezone support
  tlsPackages = [ pkgs.cacert ];
  tzPackages = [ pkgs.tzdata ];
  shellPackages = [ pkgs.bashInteractive pkgs.coreutils ];

  # Standard environment variables for TLS and timezone
  standardEnv = [
    "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
    "TZDIR=/share/zoneinfo"
  ];

  # Build an OCI image with common defaults
  # Arguments:
  #   name: Image name
  #   tag: Image tag (default: "latest")
  #   packages: List of packages to include
  #   pathsToLink: Paths to symlink in the image (default: [ "/bin" "/etc" "/share" ])
  #   extraDirs: Extra directories to create (list of paths without leading /)
  #   entrypoint: Container entrypoint (list of strings)
  #   cmd: Container command (list of strings, optional)
  #   env: Environment variables (list of "KEY=value" strings)
  #   exposedPorts: Ports to expose (list of integers)
  #   volumes: Volumes to declare (list of paths)
  #   workingDir: Working directory (optional)
  #   description: Image description for OCI label
  #   includeTls: Include TLS certificates (default: true)
  #   includeTz: Include timezone data (default: true)
  #   includeShell: Include bash and coreutils (default: false)
  mkImage =
    { name
    , tag ? "latest"
    , packages
    , pathsToLink ? [ "/bin" "/etc" "/share" ]
    , extraDirs ? [ ]
    , entrypoint
    , cmd ? null
    , env ? [ ]
    , exposedPorts ? [ ]
    , volumes ? [ ]
    , workingDir ? null
    , description
    , includeTls ? true
    , includeTz ? true
    , includeShell ? false
    ,
    }:
    pkgs.dockerTools.buildImage {
      inherit name tag;

      copyToRoot = pkgs.buildEnv {
        name = "${name}-root";
        paths = packages
          ++ lib.optionals includeTls tlsPackages
          ++ lib.optionals includeTz tzPackages
          ++ lib.optionals includeShell shellPackages;
        inherit pathsToLink;
      };

      extraCommands = lib.optionalString (extraDirs != [ ]) ''
        mkdir -p ${lib.concatStringsSep " " extraDirs}
      '';

      config = {
        Entrypoint = entrypoint;
        Cmd = cmd;
        WorkingDir = workingDir;

        Env = (lib.optionals includeTls [ "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt" ])
          ++ (lib.optionals includeTz [ "TZDIR=/share/zoneinfo" ])
          ++ env;

        ExposedPorts = lib.genAttrs
          (map (p: "${toString p}/tcp") exposedPorts)
          (_: { });

        Volumes = lib.genAttrs volumes (_: { });

        Labels = commonLabels // {
          "org.opencontainers.image.title" = name;
          "org.opencontainers.image.description" = description;
        };
      };
    };

in
{
  inherit commonLabels tlsPackages tzPackages shellPackages standardEnv;
  inherit mkImage;
}
