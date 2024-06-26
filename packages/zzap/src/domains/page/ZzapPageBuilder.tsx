import yaml from "js-yaml";
import kebabCase from "lodash/kebabCase";
import markdownit from "markdown-it";
import type { ZzapConfigType } from "../config/zzapConfigSchema";

const md = markdownit({
  html: true,
  linkify: true,
  langPrefix: "",
});

export const PageBuilder = {
  fromMarkdown(props: {
    config: ZzapConfigType;
    path: string;
    markdown: string;
    explode?: boolean;
  }): Array<ZzapPageProps> {
    const frontmatterRegex = /---\n(.*?)\n---/s;
    const frontMatter = props.markdown.match(frontmatterRegex)?.[1];
    const data: {
      title?: string;
      description?: string;
      [key: string]: any;
    } = yaml.load(frontMatter || "") || {};
    const {
      title: frontmatterTitle,
      description: frontmatterDescription,
      layout: frontmatterLayout,
      ...rest
    } = data;
    const markdown = props.markdown.replace(frontmatterRegex, "");

    const pages: Array<ZzapPageProps> = [];
    const documents: Array<DocumentType> = [];

    if (!props.explode) {
      documents.push({
        path: props.path,
        markdown: markdown,
      });
    } else {
      const lines = markdown.split("\n");

      const idCounter: Record<string, number> = {};

      let currentDocument: DocumentType | null = null;
      for (const line of lines) {
        if (line.startsWith("# ")) {
          if (currentDocument) {
            documents.push(currentDocument);
          }

          const title = `${line}`.replace("# ", "");
          let id = kebabCase(title);
          const count = idCounter[id] || 0;
          const newCount = count + 1;
          idCounter[id] = newCount;

          if (count !== 0) {
            id = `${id}-${count}`;
          }

          const pathWithoutLastPart = props.path
            .split("/")
            .slice(0, -1)
            .join("/");
          const path = `${pathWithoutLastPart}/${id}`;
          currentDocument = {
            path: path,
            markdown: line,
          };
        } else {
          if (currentDocument) {
            const lineToAdd = line;
            currentDocument.markdown += lineToAdd + "\n";
          }
        }
      }

      // last document
      if (currentDocument) {
        documents.push(currentDocument);
      }
    }

    const renderedDocuments: Array<RenderedDocumentType> = documents.map(
      (document) => {
        const html = md.render(document.markdown);

        const firstH1 = html.match(/<h1>(.*?)<\/h1>/)?.[1] || "";
        const firstP = html.match(/<p>(.*?)<\/p>/)?.[1] || "";

        const title = frontmatterTitle || firstH1 || "";
        const description = frontmatterDescription || firstP || "";
        return {
          ...rest,
          title,
          description,
          html,
          path: document.path,
          layout: frontmatterLayout || "default",
        };
      },
    );

    renderedDocuments.forEach((renderedDocument) => {
      const page: ZzapPageProps = {
        ...rest,
        title: renderedDocument.title,
        description: renderedDocument.description,
        path: renderedDocument.path,
        layout: renderedDocument.layout,
        markdown: {
          html: renderedDocument.html,
        },
      };

      pages.push(page);
    });

    return pages;
  },
};

type DocumentType = {
  path: string;
  markdown: string;
};

type RenderedDocumentType = {
  path: string;
  html: string;
  title: string;
  description: string;
  layout: string | "default";
};

export type ZzapPageProps<T = {}> = {
  title?: string;
  description?: string;
  path: string;
  layout: string | "default";
  markdown?: {
    html: string;
  };
} & T;

export type SitemapItemType = {
  title?: string;
  path: string;
};
