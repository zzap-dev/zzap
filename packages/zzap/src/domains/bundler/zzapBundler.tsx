import Bun, { $, Glob } from "bun";
import fs from "fs/promises";
import markdownit from "markdown-it";

import { logger } from "../../cli";
import { zaapConfig } from "../config/zzapConfig";

export const zzapBundler = {
  async generate() {
    const config = await zaapConfig.get();
    logger.log(`Building ${config.title}...`);
    const buildStartTimestamp = Date.now();

    // Clean output folder
    await fs.rm(config.outputDir, { recursive: true, force: true });

    const md = markdownit({
      html: true,
      linkify: true,
    });

    logger.debug("Waiting for tasks...");
    await Promise.all([
      publicDirTask(),
      publicFilesTask(),
      commandsTask(),
      buildClientTask(),
      buildPages(),
    ]);

    // Render Pages with Glob
    // if (config.dynamic) {
    //   await config.dynamic({
    //     addPage(props) {
    //       dynamicPages.push(props);
    //     },
    //   });

    //   for (const page of dynamicPages) {
    //     const jsx = config.document({
    //       head: head,
    //       children: page.children,
    //       scripts: scripts,
    //     });
    //     const html = config.deps.Server.renderToString(jsx);
    //     Bun.write(`${config.outputDir}/${page.path}/index.html`, html);
    //   }
    // }

    const timeDiff = Date.now() - buildStartTimestamp;
    logger.log(`Site built in ${timeDiff}ms.`);

    async function buildPages() {
      let globFileCount = 0;
      const head = <></>;
      const entryPointFileNames = config.entryPoints.map(
        (entry) => entry.path.split("/").pop() as string,
      );
      const scripts = (
        <>
          {entryPointFileNames.map((fileName, i) => {
            const [fileNameWithoutExtension] = fileName.split(".");
            return (
              <script
                key={i}
                src={`/__zzap-scripts/${fileNameWithoutExtension}.js`}
              ></script>
            );
          })}
        </>
      );

      const globPatterns = ["**/*.mdx", "**/*.md"];
      for (const pattern of globPatterns) {
        const glob = new Glob(config.contentDir + "/" + pattern);

        const filesIterator = glob.scan({
          cwd: ".",
          onlyFiles: true,
        });

        for await (const filePath of filesIterator) {
          const pageMarkdown = await Bun.file(filePath).text();

          const path = filePath
            .replace(config.contentDir, "")
            .replace(/\.mdx?$/, "")
            .replace(/\.md?$/, "")
            .replace(/\/index$/, "");

          const pageHTML = md.render(pageMarkdown);
          function DefaultRootComponent(props: { content: JSX.Element }) {
            return (
              <div
                dangerouslySetInnerHTML={{
                  __html: props.content,
                }}
              ></div>
            );
          }
          const RootComponent = config.RootComponent || DefaultRootComponent;
          const content = <RootComponent content={pageHTML}></RootComponent>;

          const root = <div id="zzap-root">{content}</div>;

          const jsx = config.document({
            head: head,
            children: root,
            scripts: (
              <>
                <script
                  dangerouslySetInnerHTML={{
                    __html: `
window.__zzap = ${JSON.stringify({
                      props: content.props,
                    })};`,
                  }}
                ></script>
                {scripts}
              </>
            ),
          });
          const html = config.deps["react-dom/server"].renderToString(jsx);
          Bun.write(`${config.outputDir}/${path}/index.html`, html);
          globFileCount++;
        }
      }

      // Render dynamic pages
      const dynamicPages: Array<{ path: string; children: JSX.Element }> = [];
      return { globFileCount, dynamicPages };
    }

    async function buildClientTask() {
      const entryPoints = config.entryPoints.map((entry) => entry.path);

      await Bun.build({
        entrypoints: entryPoints,
        target: "browser",
        format: "esm",
        outdir: config.outputDir + "/__zzap-scripts",
      });

      logger.debug(`buildClientTask`);
    }

    async function publicDirTask() {
      const publicDirectoryExist = await fs
        .access(config.publicDir)
        .then(() => true)
        .catch(() => false);

      if (publicDirectoryExist) {
        await fs.cp(config.publicDir, config.outputDir, { recursive: true });
      }
      logger.debug(`publicDirTask`);
    }
    async function commandsTask() {
      const commandPromises = config.commands.map(async (commandProps) => {
        logger.log(`Running command: ${commandProps.command}`);
        if (commandProps.silent) {
          const { exitCode } =
            await $`${{ raw: commandProps.command }}`.quiet();

          if (exitCode !== 0) {
            await $`${{ raw: commandProps.command }}`;
          }
        } else {
          await $`${{ raw: commandProps.command }}`;
        }
      });

      await Promise.all(commandPromises);
      logger.debug(`commandsTask`);
    }
    async function publicFilesTask() {
      const promises = config.publicFiles.map(async (file) => {
        await fs.cp(file.path, `${config.outputDir}/${file.name}`);
      });
      await Promise.all(promises);
      logger.debug(`publicFilesTask`);
    }
  },
};
