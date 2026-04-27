declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    window: {
      DOMParser: typeof DOMParser
    }
  }
}
