declare module 'pagedjs' {
  export class Previewer {
    chunker: { destroy(): void };
    polisher: { destroy(): void };
    preview(content: HTMLElement | DocumentFragment, stylesheets: string[], renderTo: HTMLElement): Promise<{ total: number }>;
  }
}
