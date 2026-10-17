import { validateDocument } from './attachments'

// Vite emits every resource locally; PDF documents cannot select arbitrary fetch URLs.
const localResources = import.meta.glob<string>(['../../node_modules/pdfjs-dist/cmaps/*.bcmap', '../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf,otf}'], {query:'?url',import:'default',eager:true})
class LocalPDFDataFactory {
 async fetch({kind,filename}:{kind:string;filename:string}):Promise<Uint8Array> {
  const folder=kind==='cMapUrl'?'cmaps':kind==='standardFontDataUrl'?'standard_fonts':''
  const url=localResources[`../../node_modules/pdfjs-dist/${folder}/${filename}`]
  if(!folder||!url) throw new Error('PDF 所需本地字体资源不存在')
  const response=await fetch(url)
  if(!response.ok) throw new Error('无法读取 PDF 本地字体资源')
  return new Uint8Array(await response.arrayBuffer())
 }
}

type MapWithInsert = Map<unknown, unknown> & {
 getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown
}
// pdf.js 6 会把 Map#getOrInsertComputed 当作已内置能力；较旧的 WKWebView 尚未提供，
// 这里补上等价的惰性写入语义，避免导入 PDF 时在 getTextContent 崩掉。
function ensureMapInsert() {
 const proto = Map.prototype as MapWithInsert
 if (typeof proto.getOrInsertComputed === 'function') return
 Object.defineProperty(proto, 'getOrInsertComputed', {
  configurable: true,
  writable: true,
  value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown) {
   if (this.has(key)) return this.get(key)
   const value = callback(key)
   this.set(key, value)
   return value
  },
 })
}

async function* readAll<T>(stream: ReadableStream<T>) {
 const reader = stream.getReader()
 try {
  while (true) {
   const {done,value} = await reader.read()
   if (done) return
   yield value
  }
 } finally { reader.releaseLock() }
}
// pdf.js 通过 for await 读取 ReadableStream；旧 WebKit 还没有这个异步迭代器。
function ensureStreamIterator() {
 if (typeof ReadableStream === 'undefined') return
 const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>
 if (typeof proto[Symbol.asyncIterator] === 'function') return
 Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, {
  configurable: true,
  writable: true,
  value(this: ReadableStream<unknown>) { return readAll(this) },
 })
}

/** worker 从打包资源读取，再转同源 Blob，适配桌面的自定义协议；不使用假 worker。 */
export async function extractPDF(bytes: Uint8Array, signal?:AbortSignal): Promise<{text:string;pageCount:number}> {
 ensureMapInsert()
 ensureStreamIterator()
 const [{getDocument,PDFWorker}, {default:workerUrl}] = await Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
 signal?.throwIfAborted()
 const response=await fetch(workerUrl,{signal})
 if(!response.ok) throw new Error('无法加载本地 PDF 解析器，请重新安装应用')
 signal?.throwIfAborted()
 const workerPolyfill=`if(typeof Map.prototype.getOrInsertComputed!=='function'){Object.defineProperty(Map.prototype,'getOrInsertComputed',{configurable:true,writable:true,value:function(key,callback){if(this.has(key))return this.get(key);const value=callback(key);this.set(key,value);return value}})}
if(typeof ReadableStream!=='undefined'&&typeof ReadableStream.prototype[Symbol.asyncIterator]!=='function'){Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,{configurable:true,writable:true,value:function(){const reader=this.getReader();return{next:()=>reader.read().then(r=>r.done?{done:true,value:undefined}:{done:false,value:r.value}),return:()=>{try{reader.releaseLock()}catch{}return Promise.resolve({done:true,value:undefined})},[Symbol.asyncIterator](){return this}}}})}
`
 const localUrl=URL.createObjectURL(new Blob([workerPolyfill,await response.text()],{type:'text/javascript'}))
 let port: Worker | undefined
 let worker: InstanceType<typeof PDFWorker> | undefined
 let task: ReturnType<typeof getDocument> | undefined
 let timer: ReturnType<typeof setTimeout> | undefined
 let cancel: (()=>void) | undefined
 try {
  port=new Worker(localUrl,{type:'module'})
  worker=PDFWorker.create({port})
  task=getDocument({data:bytes.slice(),worker,BinaryDataFactory:LocalPDFDataFactory,useSystemFonts:false,disableFontFace:true,enableXfa:false,useWasm:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,disableRange:true,stopAtErrors:true})
  const interrupted=new Promise<never>((_,reject)=>{
   cancel=()=>reject(new DOMException('附件读取已取消','AbortError'))
   signal?.addEventListener('abort',cancel,{once:true})
   if(signal?.aborted) cancel()
   timer=setTimeout(()=>reject(new Error('PDF 解析超过 30 秒，请拆分文件或重新添加')),30000)
   port!.onerror=()=>reject(new Error('本地 PDF 解析器无法启动，请重新安装应用后重试'))
  })
  const parse=async()=>{
   const doc=await task!.promise
   if(doc.numPages > 100) throw new Error('PDF 不能超过 100 页')
   const pages:string[]=[]
   let hasText=false
   let total=0
   for(let n=1;n<=doc.numPages;n++) {
    signal?.throwIfAborted()
    const page=await doc.getPage(n)
    const content=await page.getTextContent()
    const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim()
    hasText ||= !!text
    total+=Array.from(text).length
    if(total>100000) throw new Error('文档文本不能超过 10 万字符，请拆分后添加')
    pages.push(`第 ${n} 页\n${text}`)
    page.cleanup()
   }
   if(!hasText) throw new Error('PDF 没有可提取的文本；扫描版 PDF 暂不支持 OCR')
   const text=pages.join('\n\n')
   validateDocument(text,doc.numPages)
   return {text,pageCount:doc.numPages}
  }
  return await Promise.race([parse(),interrupted])
 } catch(error) {
   if(error instanceof Error && /password|encrypted/i.test(error.name+' '+error.message)) throw new Error('暂不支持加密 PDF，请先解密后添加')
  if(error instanceof Error && /invalidpdf|invalid pdf|missingpdf|unexpected server|formaterror/i.test(error.name+' '+error.message)) throw new Error('PDF 已损坏或格式无效，请更换文件')
  throw error
 } finally {
  clearTimeout(timer)
  if(cancel) signal?.removeEventListener('abort',cancel)
  // worker 销毁不能掩盖原本的解析/取消错误。
  void task?.destroy().catch(()=>{})
  try {worker?.destroy()} catch { /* 已被任务释放 */ }
  port?.terminate();URL.revokeObjectURL(localUrl)
 }
}
