{ lib, stdenv, nodejs_24, pnpm_12, fetchPnpmDeps, pnpmConfigHook, makeWrapper, makeDesktopItem, copyDesktopItems, electron_44 }:
stdenv.mkDerivation (finalAttrs: {
  pname = "inlark";
  version = (builtins.fromJSON (builtins.readFile ../apps/desktop/package.json)).version;
  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type: !(builtins.elem (baseNameOf path) [ "node_modules" ".pnpm-store" ".turbo" ".astro" ".wrangler" "out" "dist" "release" ".git" ".test-data" "result" "test-results" ]);
  };
  nativeBuildInputs = [ nodejs_24 pnpm_12 pnpmConfigHook makeWrapper copyDesktopItems ];
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm_12;
    fetcherVersion = 4;
    postPatch = "sed -i /storeDir:/d pnpm-workspace.yaml";
    hash = "sha256-kiMyRCAMA0fc+2n3rXDOaGRshL6EJGvxxSQbLnlloXc=";
  };
  postPatch = "sed -i /storeDir:/d pnpm-workspace.yaml";
  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
  buildPhase = ''
    runHook preBuild
    pnpm typecheck
    pnpm test
    pnpm --filter @inlark/desktop build
    runHook postBuild
  '';
  desktopItems = [ (makeDesktopItem {
    name = "inlark";
    desktopName = "inlark";
    genericName = "Email client";
    exec = "inlark %U";
    icon = "inlark";
    categories = [ "Network" "Email" ];
    mimeTypes = [ "x-scheme-handler/mailto" ];
    startupWMClass = "inlark";
  }) ];
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/inlark $out/share/icons/hicolor/512x512/apps
    cp -r apps/desktop/out apps/desktop/resources $out/share/inlark/
    cp apps/desktop/package.json $out/share/inlark/
    cp apps/desktop/resources/icon.png $out/share/icons/hicolor/512x512/apps/inlark.png
    makeWrapper ${electron_44}/bin/electron $out/bin/inlark \
      --add-flags "$out/share/inlark" \
      --set-default ELECTRON_OZONE_PLATFORM_HINT auto
    mkdir -p $out/share/inlark/mcp
    cp packages/mcp/bin/*.mjs $out/share/inlark/mcp/
    makeWrapper ${electron_44}/bin/electron $out/bin/inlark-mcp \
      --set ELECTRON_RUN_AS_NODE 1 \
      --add-flags "$out/share/inlark/mcp/inlark-mcp.mjs"
    runHook postInstall
  '';
  meta = {
    description = "Keyboard-friendly JMAP and IMAP email client";
    license = lib.licenses.agpl3Only;
    mainProgram = "inlark";
    platforms = lib.platforms.linux;
  };
})
