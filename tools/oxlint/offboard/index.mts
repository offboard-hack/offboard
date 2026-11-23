import { dirname, resolve } from "node:path";
import { defineRule, eslintCompatPlugin, type ESTree } from "@oxlint/plugins";

const webLayers = ["shared", "entities", "features", "app"];

function checkImport(filename: string, specifier: string) {
  const match = /^(.*\/apps\/(web|api)\/src\/)(.+)$/.exec(resolve(filename));

  if (!match) return;
  const [, root, app, source] = match;

  if (app === "web" && /^@offboard\/(api|db)(\/|$)/.test(specifier)) {
    return "Access the API through @offboard/api-client. Keep database imports on the server.";
  }

  const resolved =
    app === "web" && specifier.startsWith("@/")
      ? resolve(root, specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(filename), specifier)
        : null;

  if (!resolved?.startsWith(root)) return;
  const target = resolved.slice(root.length);
  const [sourceLayer, sourceSlice] = source.split("/");
  const [targetLayer, targetSlice] = target.split("/");

  if (app === "web") {
    const from = webLayers.indexOf(sourceLayer);
    const to = webLayers.indexOf(targetLayer);

    if (from !== -1 && to > from) {
      return "Import down the web layers. Compose workflows in app.";
    }
    if (sourceLayer === "features" && targetLayer === "features" && sourceSlice !== targetSlice) {
      return "Keep web features independent. Compose them in app or share a domain module.";
    }
  } else {
    if (sourceLayer === "shared" && targetLayer !== "shared") {
      return "Keep API shared modules independent of features and composition.";
    }
    if (sourceLayer === "features") {
      if (targetLayer === "shared" || (targetLayer === "features" && sourceSlice === targetSlice)) {
        return;
      }
      if (/\.test\.[cm]?tsx?$/.test(source) && /^repositories\.[cm]?[jt]s$/.test(target)) {
        return;
      }

      return "Inject API dependencies through app composition. Import within this feature or shared.";
    }
  }
}

const importBoundaries = defineRule({
  meta: {
    type: "problem",
    messages: { boundary: "{{reason}}" },
  },
  createOnce(context) {
    function check(node: ESTree.Expression | null) {
      if (node?.type !== "Literal" || typeof node.value !== "string") return;

      const reason = checkImport(context.filename, node.value);

      if (reason) context.report({ node, messageId: "boundary", data: { reason } });
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
    };
  },
});

export default eslintCompatPlugin({
  meta: { name: "offboard" },
  rules: { "import-boundaries": importBoundaries },
});
