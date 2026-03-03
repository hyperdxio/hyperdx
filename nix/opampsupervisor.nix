# Fetch the pre-built opampsupervisor binary from GitHub releases
# Building from source is complex due to the monorepo structure,
# so we fetch the pre-built Linux binary instead.
{ pkgs }:

let
  version = "0.144.0";

  # Platform-specific binary selection
  binary = {
    x86_64-linux = {
      url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2Fv${version}/opampsupervisor_${version}_linux_amd64";
      hash = "sha256-9t8q/7EXM/PtZjaWrwtTQDXgX0Rrol5IPnX2GcKHe2Q=";
    };
    aarch64-linux = {
      url = "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/cmd%2Fopampsupervisor%2Fv${version}/opampsupervisor_${version}_linux_arm64";
      hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    };
  }.${pkgs.stdenv.hostPlatform.system} or (throw "Unsupported platform: ${pkgs.stdenv.hostPlatform.system}");

in
pkgs.stdenv.mkDerivation {
  pname = "opampsupervisor";
  inherit version;

  src = pkgs.fetchurl {
    inherit (binary) url hash;
  };

  dontUnpack = true;

  installPhase = ''
    mkdir -p $out/bin
    cp $src $out/bin/opampsupervisor
    chmod +x $out/bin/opampsupervisor
  '';

  meta = with pkgs.lib; {
    description = "OpenTelemetry OpAMP Supervisor";
    homepage = "https://github.com/open-telemetry/opentelemetry-collector-contrib";
    license = licenses.asl20;
    platforms = [ "x86_64-linux" "aarch64-linux" ];
  };
}
