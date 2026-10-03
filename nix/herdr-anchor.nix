# The anchor wrapper as its own package, apart from the plugin: it runs inside a
# pane's shell, not inside Herdr's plugin host, so it belongs on PATH rather than
# in the plugin root. `jq` is how it reads the workspace's name; without it the
# wrapper falls back to the repository or directory name.
{
  lib,
  stdenvNoCC,
  makeWrapper,
  jq,
}:

stdenvNoCC.mkDerivation {
  pname = "herdr-anchor";
  version = (lib.importJSON ../package.json).version;

  src = ../contrib/herdr-anchor;
  dontUnpack = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall
    install -Dm755 $src $out/bin/herdr-anchor
    patchShebangs $out/bin/herdr-anchor
    wrapProgram $out/bin/herdr-anchor --prefix PATH : ${lib.makeBinPath [ jq ]}
    runHook postInstall
  '';

  meta = {
    description = "Declares a Herdr pane as its workspace's anchor entry, then runs a command in it";
    license = lib.licenses.mit;
    mainProgram = "herdr-anchor";
    platforms = lib.platforms.unix;
  };
}
