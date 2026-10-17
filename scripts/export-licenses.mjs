import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {execFileSync, spawnSync} from 'node:child_process'

const root = process.cwd(), out = path.join(root, 'docs/licenses')
const officialURL='https://www.apache.org/licenses/LICENSE-2.0.txt'
const officialResponse=await fetch(officialURL)
if(!officialResponse.ok)throw Error(`Official Apache license fetch failed: ${officialResponse.status}`)
const officialBytes=Buffer.from(await officialResponse.arrayBuffer())
if(!officialBytes.equals(fs.readFileSync(path.join(root,'LICENSE'))))throw Error('LICENSE differs from official apache.org bytes; preserve the original official text.')
const tools = process.env.LICENSE_TOOLS_DIR || path.join(os.tmpdir(), 'aidochat-license-tools')
const temp = path.join(tools, 'export')
fs.mkdirSync(temp, {recursive:true})
fs.rmSync(out, {recursive:true,force:true})
fs.mkdirSync(path.join(out, 'raw'), {recursive:true})
const run=(bin,args,opts={})=>execFileSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,...opts})
const goEnv=JSON.parse(run('go',['env','-json','GOROOT','GOMODCACHE','GOVERSION','GOOS','GOARCH']))
const replacements=[[root,'<REPOSITORY>'],[goEnv.GOMODCACHE,'<GOMODCACHE>'],[goEnv.GOROOT,'<GOROOT>'],[tools,'<LICENSE_TOOLS_DIR>'],[os.homedir(),'<HOME>']].sort((a,b)=>b[0].length-a[0].length)
const clean=s=>replacements.reduce((v,[from,to])=>v.split(from).join(to),s)
const rel=p=>path.relative(root,p).split(path.sep).join('/')
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s)}
const json=(p,v)=>write(p,JSON.stringify(v,null,2)+'\n')
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
const parseStream=s=>{const items=[];let depth=0,start=0,inString=false,escape=false;for(let i=0;i<s.length;i++){const c=s[i];if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;continue}if(c==='"')inString=true;else if(c==='{'){if(depth++===0)start=i}else if(c==='}'&&--depth===0)items.push(JSON.parse(s.slice(start,i+1)))}return items}
const sourceFiles=[]
function copy(src,dest,origin){if(dest.endsWith('.go'))dest+='.txt';const b=fs.readFileSync(src);write(dest,b);sourceFiles.push({file:rel(dest),source:origin,sha256:hash(b),bytes:b.length});return rel(dest)}
const licenseName=n=>/(^|[-_. ])(licen[sc]e|copying|copyright|notice|patents|ofl)([-_. ]|$)/i.test(n)||/^licen[sc]e/i.test(n)
function walk(dir,fn){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,fn);else if(e.isFile())fn(p)}}
function copyLicenses(dir,dest,origin){const files=[];walk(dir,p=>{if(licenseName(path.basename(p))&&!/\.(pdf|png|jpg)$/i.test(p)){const r=path.relative(dir,p);files.push(copy(p,path.join(dest,r),origin+'/'+r.split(path.sep).join('/')))}});return files.sort()}
const commands=[]
function capture(bin,args,file,opts={}){commands.push({command:[bin,...args].map(clean),cwd:clean(opts.cwd||root),env:opts.env?{GOROOT:clean(opts.env.GOROOT||''),GOOS:opts.env.GOOS,GOARCH:opts.env.GOARCH,CGO_ENABLED:opts.env.CGO_ENABLED,GOFLAGS:clean(opts.env.GOFLAGS||'')}:undefined});const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,...opts});write(path.join(out,'raw',file),clean(r.stdout||''));write(path.join(out,'raw',file+'.stderr.txt'),clean(r.stderr||''));if(r.status!==0)throw Error(`${bin} ${args.join(' ')} exited ${r.status}: ${r.stderr}`);return r.stdout}
const scanner=path.join(tools,'node_modules/.bin/license-checker-rseidelsohn')
for(const [file,flags] of [['frontend-all.json',[]],['frontend-production.json',['--production']]])capture(scanner,['--json','--relativeLicensePath','--relativeModulePath','--excludePrivatePackages',...flags],file,{cwd:path.join(root,'frontend')})
const scanned=JSON.parse(fs.readFileSync(path.join(out,'raw/frontend-all.json')))
const production=JSON.parse(fs.readFileSync(path.join(out,'raw/frontend-production.json')))
const lockBytes=fs.readFileSync(path.join(root,'frontend/package-lock.json')),lock=JSON.parse(lockBytes)
const frontend=[]
for(const [installPath,entry] of Object.entries(lock.packages)){if(!installPath)continue;const name=entry.name||installPath.split('node_modules/').at(-1),id=name+'@'+entry.version;const local=path.join(root,'frontend',installPath);const dest=path.join(out,'texts/frontend',id.replaceAll('/','__'));const installed=fs.existsSync(path.join(local,'package.json'));const record={name,version:entry.version,installPath,dev:!!entry.dev,optional:!!entry.optional,os:entry.os,cpu:entry.cpu,license:scanned[id]?.licenses||entry.license||'UNKNOWN',installed,productionGraph:!!production[id],resolved:entry.resolved,integrity:entry.integrity,licenseFiles:[]};if(installed)record.licenseFiles=copyLicenses(local,dest,`npm:${id}`);frontend.push(record)}
// 锁文件也包含当前平台没有安装的可选包；取原始 tarball、校验 integrity，仅保留许可文本。
const missing=frontend.filter(p=>!p.installed)
let cursor=0
await Promise.all(Array.from({length:4},async()=>{while(cursor<missing.length){const p=missing[cursor++];if(!p.resolved?.startsWith('https://registry.npmjs.org/'))throw Error(`Unsupported package URL ${p.name}`);const tar=path.join(temp,p.name.replaceAll('/','__')+'-'+p.version+'.tgz');if(!fs.existsSync(tar)){const response=await fetch(p.resolved);if(!response.ok)throw Error(`${p.resolved}: ${response.status}`);fs.writeFileSync(tar,Buffer.from(await response.arrayBuffer()))}const bytes=fs.readFileSync(tar);const [algo,want]=p.integrity.split('-');const got=crypto.createHash(algo).update(bytes).digest('base64');if(got!==want)throw Error(`Integrity mismatch ${p.name}`);const entries=run('tar',['-tzf',tar]).trim().split('\n').filter(n=>licenseName(path.basename(n))&&!/\.(pdf|png|jpg)$/i.test(n)&&!n.endsWith('/'));const unpack=path.join(temp,'unpacked',p.name.replaceAll('/','__')+'@'+p.version);fs.mkdirSync(unpack,{recursive:true});if(entries.length)run('tar',['-xzf',tar,'-C',unpack,...entries]);p.licenseFiles=entries.map(n=>copy(path.join(unpack,n),path.join(out,'texts/frontend',p.name.replaceAll('/','__')+'@'+p.version,n.replace(/^package\//,'')),`npm:${p.name}@${p.version}/${n.replace(/^package\//,'')}`));}}))
for(const p of frontend){
  p.licenseSource=scanned[p.name+'@'+p.version]?'installed-package scanner':'package-lock.json metadata'
  if(!p.licenseFiles.length){
    const parent=p.name.startsWith('@napi-rs/canvas-')?'@napi-rs/canvas':p.name.startsWith('@rolldown/binding-')?'rolldown':null
    if(parent){p.relatedParentPackage=parent;p.relatedLicenseFiles=frontend.find(q=>q.name===parent)?.licenseFiles||[];p.relatedLicenseBasis='Same upstream repository parent package notices; this does not verify all native binary internals or cure the missing platform-package license file.'}
  }
}
json(path.join(out,'frontend-inventory.json'),frontend)
const temporaryModfile=path.join(temp,'go-export.mod')
fs.copyFileSync(path.join(root,'go.mod'),temporaryModfile)
fs.copyFileSync(path.join(root,'go.sum'),temporaryModfile.replace(/\.mod$/,'.sum'))
const env={...process.env,GOROOT:goEnv.GOROOT,GOCACHE:path.join(tools,'go-cache'),GOFLAGS:(process.env.GOFLAGS||'')+' '+JSON.stringify('-modfile='+temporaryModfile)}
capture('go',['mod','download','all'],'go-download.txt',{env})
const modules=parseStream(capture('go',['list','-m','-json','all'],'go-modules.json',{env})).filter(m=>!m.Main)
const platforms=[['darwin','amd64'],['windows','amd64'],['linux','amd64']]
const runtime=new Map(),runtimeSources=new Map()
for(const [GOOS,GOARCH] of platforms){const e={...env,GOOS,GOARCH,CGO_ENABLED:'1'};const raw=capture('go',['list','-e','-deps','-json=ImportPath,Standard,Dir,GoFiles,CgoFiles,CFiles,CXXFiles,HFiles,MFiles,SFiles,EmbedFiles,Module,Error,DepsErrors','.'],`go-packages-${GOOS}.json`,{env:e});for(const p of parseStream(raw)){if(p.Module&&!p.Module.Main){const v=runtime.get(p.Module.Path)||new Set();v.add(GOOS);runtime.set(p.Module.Path,v)
for(const name of ['GoFiles','CgoFiles','CFiles','CXXFiles','HFiles','MFiles','SFiles','EmbedFiles'].flatMap(k=>p[k]||[])){
 const src=path.join(p.Dir,name)
 if(/\.(go|[cmhs]|mm|cc|cpp|hpp|js|ts|html|css)$/i.test(src)&&fs.existsSync(src))runtimeSources.set(src,{module:p.Module.Path,version:p.Module.Version,relative:path.relative(p.Module.Dir,src)})
}
}}}
// 源文件内嵌的第三方版权/许可注释也按原始字节范围保留，避免只看根 LICENSE 漏掉原作者。
const inline=[]
for(const [src,meta] of runtimeSources){
 const bytes=fs.readFileSync(src),text=bytes.toString('utf8');let index=0
 for(const match of text.matchAll(/\/\*[\s\S]*?\*\/|(?:^[ \t]*\/\/[^\n]*(?:\n|$))+/gm)){
  if(!/copyright|\(c\)|©|licensed under|permission is hereby granted|redistribution and use|SPDX-License-Identifier/i.test(match[0]))continue
  const start=Buffer.byteLength(text.slice(0,match.index)),end=start+Buffer.byteLength(match[0]),b=bytes.subarray(start,end)
  const dest=path.join(out,'texts/go-inline-notices',hash(b)+'.txt')
  write(dest,b)
  const record={file:rel(dest),source:`go:${meta.module}@${meta.version}/${meta.relative}`,sha256:hash(b),bytes:b.length,sourceFileSha256:hash(bytes),sourceByteRange:[start,end]}
  sourceFiles.push(record);inline.push(record)
 }
}
json(path.join(out,'go-inline-notices.json'),inline)
// go/packages 自身会用 GO111MODULE=off 查询工具链版本，不能继承 -modfile。
// 给 go-licenses 独立的精确源码/manifest 副本，避免它触碰应用 go.sum。
const goScanRoot=path.join(temp,'go-scan-root');fs.rmSync(goScanRoot,{recursive:true,force:true});fs.mkdirSync(goScanRoot,{recursive:true})
const goScanSources=[]
for(const name of ['app','desktop','internal'])fs.cpSync(path.join(root,name),path.join(goScanRoot,name),{recursive:true})
for(const e of fs.readdirSync(root,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.go'))fs.copyFileSync(path.join(root,e.name),path.join(goScanRoot,e.name))
fs.copyFileSync(temporaryModfile,path.join(goScanRoot,'go.mod'))
fs.copyFileSync(temporaryModfile.replace(/\.mod$/,'.sum'),path.join(goScanRoot,'go.sum'))
walk(goScanRoot,p=>goScanSources.push({file:path.relative(goScanRoot,p),sha256:hash(fs.readFileSync(p))}))
const licenseScanEnv={...env,GOFLAGS:''}
capture(path.join(tools,'bin/go-licenses'),['report','./...','--ignore','ai-group-chat'],'go-report.csv',{env:licenseScanEnv,cwd:goScanRoot})
// 保存工具原生 save 结果，另外收集全模块图中嵌套的原始许可/NOTICE。
const saved=path.join(temp,'go-save');fs.rmSync(saved,{recursive:true,force:true})
capture(path.join(tools,'bin/go-licenses'),['save','./...','--ignore','ai-group-chat','--save_path='+saved],'go-save.stdout.txt',{env:licenseScanEnv,cwd:goScanRoot})
walk(saved,p=>copy(p,path.join(out,'texts/go-runtime',path.relative(saved,p)),'go-licenses save/'+path.relative(saved,p)))
const go=[]
for(const m of modules){const p=m.Replace||m;const dest=path.join(out,'texts/go-modules',m.Path+'@'+m.Version);go.push({module:m.Path,version:m.Version,indirect:!!m.Indirect,scope:runtime.has(m.Path)?'runtime-import-graph':'module-graph-only (build/tool/test/transitive; not proven shipped)',runtimePlatforms:[...(runtime.get(m.Path)||[])].sort(),licenseFiles:copyLicenses(p.Dir,dest,`go:${m.Path}@${m.Version}`)})}
copy(path.join(goEnv.GOROOT,'LICENSE'),path.join(out,'texts/go-standard-library/LICENSE'),`Go ${goEnv.GOVERSION}/LICENSE`)
copy(path.join(goEnv.GOROOT,'PATENTS'),path.join(out,'texts/go-standard-library/PATENTS'),`Go ${goEnv.GOVERSION}/PATENTS`)
json(path.join(out,'go-inventory.json'),go)
// pdf.js 把字体、CMaps、wasm 等第三方原文放在子目录，顶层 Apache 标签不能替代它们。
const pdf=frontend.find(p=>p.name==='pdfjs-dist')
json(path.join(out,'bundled-assets.json'),{fonts:frontend.filter(p=>p.name.startsWith('@fontsource-variable/')).map(p=>({name:p.name,version:p.version,license:p.license,licenseFiles:p.licenseFiles})),pdfjs:{version:pdf.version,licenseFiles:pdf.licenseFiles,distributedResourcePatterns:['cmaps/*.bcmap','standard_fonts/*.{pfb,ttf,otf}'],usage:'frontend/src/lib/pdf.ts',reviewRequired:'standard_fonts/LICENSE_LIBERATION: GPL v2 with font exceptions; distribution compatibility NOT approved'}})
const classifier=path.join(tools,'bin/identify_license')
capture(classifier,['-tasks','8','-json',path.join(out,'raw/license-classifier.json'),path.join(out,'texts/go-modules'),path.join(out,'texts/frontend/pdfjs-dist@'+pdf.version)],'license-classifier.stdout.txt',{env})
write(path.join(out,'raw/license-classifier.json'),clean(fs.readFileSync(path.join(out,'raw/license-classifier.json'),'utf8')))
const classifications=JSON.parse(fs.readFileSync(path.join(out,'raw/license-classifier.json')))
capture(classifier,['-headers','-tasks','8','-json',path.join(out,'raw/inline-license-classifier.json'),path.join(out,'texts/go-inline-notices')],'inline-license-classifier.stdout.txt',{env})
write(path.join(out,'raw/inline-license-classifier.json'),clean(fs.readFileSync(path.join(out,'raw/inline-license-classifier.json'),'utf8')))
const inlineClassifications=JSON.parse(fs.readFileSync(path.join(out,'raw/inline-license-classifier.json')))
for(const m of go){
 const files=new Set(inline.filter(r=>r.source.startsWith(`go:${m.module}@${m.version}/`)).map(r=>r.file))
 m.inlineDetectedLicenses=[...new Set(inlineClassifications.filter(c=>[...files].some(f=>c.Filepath.endsWith(f))).flatMap(c=>c.Classifications.map(v=>v.Name)).filter(n=>n!=='Copyright'))].sort()
}
// 补充内嵌头引用的完整许可参考文本；不把其误写为上游模块已附的 LICENSE。
const supplemental=[]
for(const id of ['LGPL-2.1','APSL-1.1','APSL-2.0']){
 const source=path.join(goEnv.GOMODCACHE,'github.com/google/licenseclassifier/v2@v2.0.0/assets/License',id,'license.txt')
 const dest=path.join(out,'texts/supplemental-reference',id+'.txt')
 const file=copy(source,dest,`github.com/google/licenseclassifier/v2@v2.0.0/assets/License/${id}/license.txt`)
 supplemental.push(sourceFiles.at(-1))
}
json(path.join(out,'supplemental-reference-texts.json'),supplemental)
capture('go',['version','-m',path.join(tools,'bin/go-licenses')],'go-licenses-build-info.txt',{env})
capture('go',['version','-m',classifier],'license-classifier-build-info.txt',{env})
for(const m of go)m.detectedLicenses=[...new Set(classifications.filter(c=>m.licenseFiles.some(f=>c.Filepath.endsWith(f))).flatMap(c=>c.Classifications.map(v=>v.Name)))].sort()
json(path.join(out,'go-inventory.json'),go)
json(path.join(out,'provenance.json'),{generatedAt:new Date().toISOString(),node:process.version,npm:run('npm',['--version']).trim(),go:goEnv.GOVERSION,host:goEnv.GOOS+'/'+goEnv.GOARCH,officialLicense:{url:officialURL,sha256:hash(officialBytes),bytes:officialBytes.length,verifiedByteForByte:true},tools:{'license-checker-rseidelsohn':JSON.parse(fs.readFileSync(path.join(tools,'node_modules/license-checker-rseidelsohn/package.json'))).version,'go-licenses':'github.com/google/go-licenses/v2@v2.0.1','identify_license':'github.com/google/licenseclassifier/v2@v2.0.0'},inputs:{'frontend/package-lock.json':hash(lockBytes),'go.mod':hash(fs.readFileSync('go.mod')),'go.sum':hash(fs.readFileSync('go.sum'))},goLicensesScan:'Temporary exact source copy, with temporary expanded go.sum, because x/tools go/packages queries Go version with GO111MODULE=off and cannot inherit -modfile. Original project go.mod/go.sum are never written.',goScanSources,normalization:'Machine outputs only replace absolute repository/cache/home prefixes with placeholders; original license text bytes are unchanged. License-named Go source containers use .go.txt so go ./... cannot treat documentation as application packages.',commands})
json(path.join(out,'text-sources.json'),sourceFiles.sort((a,b)=>a.file.localeCompare(b.file)))
const table=(head,rows)=>'| '+head.join(' | ')+' |\n| '+head.map(()=>'---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(x=>String(x).replaceAll('|','\\|')).join(' | ')+' |').join('\n')+'\n'
write(path.join(out,'frontend-inventory.md'),'# Frontend lockfile inventory (generated)\n\n'+table(['Package','License','Scope','Original texts'],frontend.map(p=>[p.name+'@'+p.version,p.license,p.dev?'development':p.optional?'optional':'production',p.licenseFiles.map(f=>`[${path.basename(f)}](${path.relative(out,path.join(root,f))})`).join(', ')||'NO LICENSE FILE IN PACKAGE — review metadata'+(p.relatedLicenseFiles?.length?'; related parent notices: '+p.relatedLicenseFiles.map(f=>`[${path.basename(f)}](${path.relative(out,path.join(root,f))})`).join(', '):'')])))
write(path.join(out,'go-inventory.md'),'# Go module graph inventory (generated)\n\n'+table(['Module','Detected licenses','Scope / platforms','Original texts'],go.map(m=>[m.module+'@'+m.version,(m.detectedLicenses.join(', ')||'UNKNOWN')+(m.inlineDetectedLicenses.length?'; inline: '+m.inlineDetectedLicenses.join(', '):''),m.scope+'; '+m.runtimePlatforms.join(', '),m.licenseFiles.map(f=>`[${path.basename(f)}](${path.relative(out,path.join(root,f))})`).join(', ')||'NONE — review required'])))
const flags=[...classifications,...inlineClassifications].flatMap(c=>c.Classifications.filter(v=>/(^|[- ])(A?GPL|LGPL)/i.test(v.Name)).map(v=>({file:c.Filepath,license:v.Name,confidence:v.Confidence,sources:inline.filter(r=>c.Filepath.endsWith(r.file)).map(r=>r.source),context:c.Filepath.includes('/testdata/')?'upstream module test fixture; not evidence of linked runtime code license':c.Filepath.includes('/standard_fonts/')?'font resource included by frontend/src/lib/pdf.ts glob':'review scope in inventory'})))
json(path.join(out,'review-required.json'),{status:'NOT LEGAL CLEARANCE',copyleftDetections:flags,nativeHeaderReview:go.filter(m=>m.inlineDetectedLicenses.some(l=>/APSL|BSD-4|LGPL|GPL/i.test(l))).map(m=>({module:m.module,platforms:m.runtimePlatforms,rootAndNestedLicenseFiles:m.detectedLicenses,inlineLicenses:m.inlineDetectedLicenses,noticeIndex:'docs/licenses/go-inline-notices.json'})),otherCopyleftMetadata:frontend.filter(p=>/MPL|EPL|CDDL/i.test(p.license)).map(p=>({package:p.name+'@'+p.version,license:p.license,dev:p.dev,optional:p.optional})),unclassifiedGo:go.filter(m=>!m.detectedLicenses.length).map(m=>({module:m.module,scope:m.scope})),missingFrontendLicenseFiles:frontend.filter(p=>!p.licenseFiles.length).map(p=>p.name+'@'+p.version),missingGoLicenseFiles:go.filter(m=>!m.licenseFiles.length).map(m=>m.module),notes:['pdfjs-dist standard_fonts/LICENSE_LIBERATION requires owner/legal review; no compatibility approval inferred from exceptions.','Go classifier also covers module-graph-only tool/test/template files; see go-inventory for runtime distinction.','Non-Go code warnings are preserved; package graph does not prove every bundled native dependency notice.']})
const summary={frontendPackages:frontend.length,frontendOptionalTarballs:missing.length,goModules:go.length,runtimeGoModules:go.filter(m=>m.scope==='runtime-import-graph').length,uniqueOriginalTextFiles:new Set(sourceFiles.map(r=>r.file)).size,originalTextSourceRecords:sourceFiles.length,inlineNoticeSources:inline.length,uniqueInlineNotices:new Set(inline.map(r=>r.sha256)).size,compatibilityStatus:'REVIEW REQUIRED; not legal clearance'}
json(path.join(out,'summary.json'),summary)
console.log(JSON.stringify(summary,null,2))
