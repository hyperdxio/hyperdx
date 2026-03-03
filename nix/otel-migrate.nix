# Build the custom Go migrate tool from packages/otel-collector/
# This tool runs ClickHouse schema migrations using goose with TLS support
{ pkgs }:

pkgs.buildGoModule {
  pname = "hdx-otel-migrate";
  version = "0.1.0";

  src = ../packages/otel-collector;

  vendorHash = "sha256-SuTbQWfJEJIgvxbJYdO0+VFeYx3vq0VuGAHilxIrswY=";

  subPackages = [ "cmd/migrate" ];

  meta = with pkgs.lib; {
    description = "HyperDX OTel Collector ClickHouse migration tool";
    license = licenses.mit;
  };
}
