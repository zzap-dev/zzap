import Bun, { $ } from "bun";
import path from "path";
import type { ZzapConfigType } from "../config/zzapConfigSchema";
import { getLogger } from "../logging/getLogger";
import {
  PageBuilder,
  type SitemapItemType,
  type ZzapPageProps,
} from "../page/ZzapPageBuilder";
import type { ZzapPluginType } from "../plugin/definePlugin";
import type { RouteHandlerContextType } from "../route/defineRoute";
import { WebPath } from "../web-path/WebPath";
import { zzapPluginCommands } from "./core-plugins/zzapPluginCommands";
import { zzapPluginHeads } from "./core-plugins/zzapPluginHeads";
import { zzapPluginPageRenderer } from "./core-plugins/zzapPluginPageRenderer";
import { zzapPluginPublicDir } from "./core-plugins/zzapPluginPublicDir";
import { zzapPluginPublicFiles } from "./core-plugins/zzapPluginPublicFiles";
import { zzapPluginScripts } from "./core-plugins/zzapPluginScripts";
import { zzapPluginSitemapRenderer } from "./core-plugins/zzapPluginSitemapRenderer";

const logger = getLogger();

export const ZzapBundler = {
  async setupBuild(props: { config: ZzapConfigType }) {
    await runPluginsWithLifecycle({
      config: props.config,
      loggerPrefix: "setup",
      async onRun({ plugin, logger }) {
        if (plugin.onSetup) {
          await plugin.onSetup?.({
            $,
            Bun,
            logger: logger,
            config: props.config,
          });
          return true;
        }
      },
    });
  },
  async build(props: { config: ZzapConfigType; paths: string | undefined }) {
    const timetamp = Date.now();
    const pathFromProps = props.paths?.split(",").map((path) => path.trim());

    if (!pathFromProps) {
      logger.log(`Building...`);
    } else {
      logger.log(`Rebuilding... (${props.paths})`);
    }
    const heads: Array<JSX.Element> = [];
    const scripts: Array<JSX.Element> = [];

    await runPluginsWithLifecycle({
      config: props.config,
      loggerPrefix: "build",
      async onRun({ logger, plugin }) {
        if (plugin.onBuild) {
          const result = await plugin.onBuild?.({
            $,
            Bun,
            logger: logger,
            config: props.config,
          });
          if (result) {
            heads.push(...(result.heads || []));
            scripts.push(...(result.scripts || []));
          }
          return true;
        }
      },
    });

    const paths =
      pathFromProps ||
      (await getPaths({
        config: props.config,
      }));

    const { pages, sitemap } = await getPagesAndSitemap({
      paths: paths,
      config: props.config,
    });

    await runPluginsWithLifecycle({
      config: props.config,
      loggerPrefix: "render",
      async onRun({ plugin, logger }) {
        if (plugin.onRender) {
          await plugin.onRender({
            $,
            Bun,
            logger: logger,
            config: props.config,
            heads: heads,
            scripts: scripts,
            pages: Array.from(pages.values()),
            sitemap: sitemap,
          });
          return true;
        }
      },
    });

    logger.log(
      `Finished in ${Date.now() - timetamp}ms. Rendered ${pages.size} pages.`,
    );
  },
};

async function getPagesAndSitemap(props: {
  paths: string[];
  config: ZzapConfigType;
}) {
  const pages = new Map<string, ZzapPageProps>();

  const ctx: RouteHandlerContextType = {
    $,
    Bun,
    logger,
    config: props.config,
    markdownToPage(handlerProps: { markdown: string; explode?: boolean }) {
      return PageBuilder.fromMarkdown({
        config: props.config,
        path: "",
        markdown: handlerProps.markdown,
        explode: handlerProps.explode,
      });
    },
  };

  const promises = props.paths.map(async (webPath) => {
    // DYNAMIC ROUTES
    for (const route of props.config.routes) {
      const pathSegments = webPath.split("/");
      const routeSegments = route.path.split("/");

      if (pathSegments.length !== routeSegments.length) {
        continue;
      }

      const match = routeSegments.every((routeSegment, i) => {
        if (routeSegment.startsWith("$")) return true;
        return routeSegment === pathSegments[i];
      });

      if (match) {
        const params: Record<string, string> = {};
        const segmentsWithInjectedParams: Array<string> = [];

        for (const segment of routeSegments) {
          if (segment.startsWith("$")) {
            const key = segment.replace("$", "");
            const value = pathSegments[routeSegments.indexOf(segment)];

            params[key] = value;
            segmentsWithInjectedParams.push(value);
          } else {
            segmentsWithInjectedParams.push(segment);
          }
        }

        try {
          const pathWithInjectedParams = WebPath.join(
            segmentsWithInjectedParams.join("/"),
          );
          const routePage = await route.getPage(
            { params: params, path: pathWithInjectedParams },
            ctx,
          );

          if (routePage) {
            pages.set(pathWithInjectedParams, {
              ...routePage,
              path: pathWithInjectedParams,
            });
          }
        } catch (error) {
          logger.error(`while getting page for route ${route.path}`, {
            error,
          });
        }
      }
    }

    // MARKDOWN
    // check index.md
    let filePath = path.join(props.config.routesDir, webPath, "index.md");
    let file = Bun.file(filePath);
    let exists = await file.exists();

    if (!exists) {
      // check [segment].md
      filePath = path.join(props.config.routesDir, webPath) + ".md";
      file = Bun.file(filePath);
      exists = await file.exists();
    }

    if (!exists) {
      // check !index.md
      const pathForExploded = webPath.split("/").slice(0, -1).join("/");
      filePath = path.join(
        props.config.routesDir,
        pathForExploded,
        "!index.md",
      );

      file = Bun.file(filePath);
      exists = await file.exists();
    }

    if (!exists) {
      return;
    }

    const pageMarkdown = await file.text();

    const fileName = filePath.split("/").pop();
    const shouldExplode = fileName === "!index.md";

    const markdownPages = PageBuilder.fromMarkdown({
      config: props.config as any,
      path: webPath,
      explode: shouldExplode,
      markdown: pageMarkdown,
    });

    markdownPages.forEach((page) => {
      pages.set(page.path, page);
    });
  });
  await Promise.all(promises);

  const siteMap: Array<SitemapItemType> = Array.from(pages)
    .map(([_path, page]) => {
      return {
        path: page.path,
        title: page.title,
      };
    })
    .sort((a, b) => {
      const numberOfSlugsA = a.path.split("/").length;
      const numberOfSlugsB = b.path.split("/").length;

      if (numberOfSlugsA < numberOfSlugsB) return -1;
      if (numberOfSlugsA > numberOfSlugsB) return 1;

      return 0;
    });

  return { pages, sitemap: siteMap };
}

async function getPaths(props: { config: ZzapConfigType }) {
  const paths: Array<string> = [];
  const ctx: RouteHandlerContextType = {
    $,
    Bun,
    logger,
    config: props.config,
    markdownToPage(handlerProps: { markdown: string; explode?: boolean }) {
      return PageBuilder.fromMarkdown({
        config: props.config,
        path: "",
        markdown: handlerProps.markdown,
        explode: handlerProps.explode,
      });
    },
  };

  // DYNAMIC
  const routesPromises = props.config.routes.map(async (route) => {
    try {
      const pathParamsConfigs = await route.getPathParams?.(ctx);
      if (!pathParamsConfigs) {
        const path = WebPath.join(route.path);
        paths.push(path);
      } else {
        for (const pathParamsConfig of pathParamsConfigs || []) {
          let pathToAdd = route.path;

          for (const [key, value] of Object.entries(pathParamsConfig.params)) {
            pathToAdd = pathToAdd.replace(`$${key}`, value);
          }

          const path = WebPath.join(pathToAdd);
          paths.push(path);
        }
      }
    } catch (error) {
      logger.error(`while getting path params for route ${route.path}`, {
        error,
      });
    }
  });
  await Promise.all(routesPromises);

  // MARKDOWN
  const globPatterns = ["**/*.md", "**/*.mdx"];
  for (const pattern of globPatterns) {
    const glob = new Bun.Glob(props.config.routesDir + "/" + pattern);
    const filesIterator = glob.scan({
      cwd: ".",
      onlyFiles: true,
    });

    for await (const filePath of filesIterator) {
      const cleanedFilePath = filePath
        .replace(props.config.routesDir, "")
        .replace(/\.mdx?$/, "")
        .replace(/\.md?$/, "")
        .replace(/\/index$/, "");

      const path = WebPath.join(cleanedFilePath);

      paths.push(path);
    }
  }

  return paths;
}

async function runPluginsWithLifecycle(props: {
  config: ZzapConfigType;
  loggerPrefix: string;
  onRun(props: {
    plugin: ZzapPluginType;
    logger: ReturnType<typeof getLogger>;
  }): Promise<true | undefined>;
}) {
  const allPlugins = [
    zzapPluginHeads(),
    zzapPluginScripts(),
    zzapPluginCommands(),
    zzapPluginPublicDir(),
    zzapPluginPublicFiles(),
    zzapPluginSitemapRenderer(),
    zzapPluginPageRenderer(),
    ...props.config.plugins,
  ];
  const pluginDoneLogs: Array<{ name: string; log: () => void }> = [];

  const pluginPromises = allPlugins.map(async (plugin) => {
    const timestamp = Date.now();
    const pluginLogger = getLogger(`[${props.loggerPrefix}] ▶ ${plugin.name}`);

    const ran = await props.onRun({ plugin, logger });
    if (ran) {
      const doneTimestamp = Date.now() - timestamp;
      pluginDoneLogs.push({
        name: plugin.name,
        log: () => {
          pluginLogger.debug(`Done in ${doneTimestamp}ms.`);
        },
      });
    }
  });

  await Promise.all(pluginPromises);

  pluginDoneLogs.sort((a, b) => {
    if (a.name.startsWith("core-") && b.name.startsWith("core-"))
      return a.name.localeCompare(b.name);

    if (a.name.startsWith("core-")) return -1;
    if (b.name.startsWith("core-")) return 1;
    return a.name.localeCompare(b.name);
  });

  pluginDoneLogs.forEach(({ log }) => {
    log();
  });
}
