export const zzapClient = {
  async registerRoot(RootComponent: any) {
    const ReactDOMClient = await import("react-dom/client");
    const hydrateRoot = ReactDOMClient.hydrateRoot;

    const root = document.querySelector("#zzap-root");

    if (root) {
      hydrateRoot(root, <RootComponent {...window.__zzap.props} />);
    }
  },

  async shiki(props?: {
    /**
     * Theme id from https://shiki.matsu.io/themes
     */
    theme: string;
  }) {
    const zzapRoot = document.querySelector("#zzap-root");
    zzapRoot?.setAttribute("data-zzap-shiki", "false");

    const shikiCDN = "https://esm.sh/shiki@1.0.0";
    const { codeToHtml } = await import(shikiCDN);
    const nodes = document.querySelectorAll("pre");
    const promises: Promise<void>[] = [];
    nodes.forEach((node) => {
      promises.push(colorize(node));
    });

    Promise.all(promises);
    zzapRoot?.setAttribute("data-zzap-shiki", "true");

    async function colorize(node: HTMLPreElement) {
      const lang = node.querySelector("code")?.className;
      const nodeText = node.textContent;
      node.outerHTML = await codeToHtml(nodeText, {
        lang: lang,
        theme: props?.theme || "github-dark",
      });
    }
  },
};

declare global {
  interface Window {
    __zzap: {
      props: any;
    };
  }
}