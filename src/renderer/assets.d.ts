/**
 * Tipos dos imports que o empacotador resolve, e o TypeScript sozinho não.
 *
 * Sem `import`/`export` no topo de propósito: um arquivo de declaração só vale
 * como ambiente global enquanto não vira módulo, e é justamente disso que uma
 * declaração curinga como a de baixo precisa.
 */

/**
 * Import com `?url`: em vez do conteúdo, vem o caminho do arquivo já emitido.
 *
 * É como o processador do AudioWorklet chega até aqui — ele não faz parte do
 * grafo de módulos do app, é buscado por URL pelo próprio motor de áudio.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
