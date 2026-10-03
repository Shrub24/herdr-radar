{
  description = "Herdr Radar: vendor logos, lifecycle-state glyphs and workspace grouping for the Herdr sidebar";

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
      forSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forSystems (pkgs: {
        # The plugin root: what `herdr plugin link` registers.
        default = pkgs.callPackage ./package.nix { };
        herdr-anchor = pkgs.callPackage ./nix/herdr-anchor.nix { };
      });

      checks = forSystems (pkgs: {
        smoke = self.packages.${pkgs.stdenv.hostPlatform.system}.default.tests.smoke;
        hm-module = pkgs.callPackage ./nix/hm-module-check.nix { inherit self; };
      });

      homeManagerModules.default = import ./nix/hm-module.nix { inherit self; };
    };
}
