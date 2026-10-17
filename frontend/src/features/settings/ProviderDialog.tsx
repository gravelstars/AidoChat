import { isDemo } from '../../demo/storage'
import { useEffect, useRef, useState } from 'react'
import type { ProviderConfig } from '../../backend'
import { backend } from '../../backend'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'
import { Field, TextInput } from '../../components/Field'
import { Segmented } from '../../components/Segmented'
import { useChat } from '../../state/store'
import styles from './SettingsView.module.css'

/** 常见服务的默认地址（TASK-008）。点一下即可填入。 */
const PRESETS: { name: string; kind: 'openai' | 'anthropic'; url: string }[] = [
  { name: 'OpenAI', kind: 'openai', url: 'https://api.openai.com/v1' },
  { name: 'Anthropic', kind: 'anthropic', url: 'https://api.anthropic.com' },
  { name: 'DeepSeek', kind: 'openai', url: 'https://api.deepseek.com' },
  { name: '通义千问', kind: 'openai', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: 'Kimi', kind: 'openai', url: 'https://api.moonshot.cn/v1' },
  { name: '智谱', kind: 'openai', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: 'Ollama', kind: 'openai', url: 'http://localhost:11434/v1' },
]

/**
 * 模型服务的新建与编辑（TASK-008）。Key 只写入系统钥匙串，界面不回显。
 */
export function ProviderDialog({ open, onClose, provider, onSaved, suggestedModel }: { open: boolean; onClose(): void; provider?: ProviderConfig; onSaved?(provider: ProviderConfig, testModel: string): void; suggestedModel?: string }) {
  const members = useChat((s) => s.members)
  const retiredIds = useChat((s) => s.retiredIds)
  const testRequest = useRef(0)
  const saveProvider = useChat((s) => s.saveProvider)
  const deleteProvider = useChat((s) => s.deleteProvider)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'openai' | 'anthropic'>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [testModel, setTestModel] = useState('')
  const [errors, setErrors] = useState<{ name?: string; baseUrl?: string; testModel?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    testRequest.current += 1
    setTesting(false)
    setSubmitting(false)
    if (!open) return
    setErrors({})
    setTest(null)
    setConfirmDelete(false)
    setKey('')
    setTestModel(suggestedModel?.trim() || Object.values(members).find((m) => provider && m.providerId === provider.id && !retiredIds.includes(m.id))?.model || '')
    setName(provider?.name ?? '')
    setKind(provider?.kind ?? 'openai')
    setBaseUrl(provider?.baseUrl ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  useEffect(() => { setTest(null) }, [kind, baseUrl, key, testModel])

  const dismiss = () => { testRequest.current += 1; onClose() }

  const payload = () => ({ id: provider?.id ?? '', name: name.trim(), kind, baseUrl: baseUrl.trim(), key: key.trim(), testModel: testModel.trim() || undefined })

  const runTest = async () => {
    setTest(null)
    if (!testModel.trim()) { setErrors((e) => ({ ...e, testModel: '填入这个服务实际可用的模型名，再测试连接' })); return }
    setErrors((e) => ({ ...e, testModel: undefined }))
    const request = ++testRequest.current
    setTesting(true)
    try {
      const ms = await backend.testProvider(payload())
      if (request === testRequest.current) setTest({ ok: true, text: `连接正常 · 用时 ${ms} ms` })
    } catch (e) {
      if (request === testRequest.current) setTest({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      if (request === testRequest.current) setTesting(false)
    }
  }

  const submit = async () => {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = '给服务起个名字'
    if (!baseUrl.trim()) errs.baseUrl = '请填写服务地址'
    setErrors(errs)
    if (Object.keys(errs).length) return
    const request = testRequest.current
    setSubmitting(true)
    try {
      const saved = await saveProvider(payload())
      if (request !== testRequest.current) return
      onSaved?.(saved, testModel.trim())
      dismiss()
    } catch (e) {
      if (request === testRequest.current) setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      if (request === testRequest.current) setSubmitting(false)
    }
  }

  const remove = async () => {
    if (!provider) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const request = testRequest.current
    setSubmitting(true)
    try {
      await deleteProvider(provider.id)
      if (request === testRequest.current) dismiss()
    } catch (e) {
      if (request === testRequest.current) setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      if (request === testRequest.current) setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title={provider ? `编辑「${provider.name}」` : '新建模型服务'}
      description={isDemo ? "演示版只保存服务名称与模型配置，不接收 API Key，不连接任何模型服务。" : "成员通过这里配置的服务与模型说话。API Key 只保存在系统钥匙串，界面不会回显。"}
      width={540}
      footer={
        <>
          {provider && (
            <Button variant="quiet" className={confirmDelete ? styles.bad : undefined} onClick={() => void remove()} disabled={submitting || testing}>
              {confirmDelete ? '再点一次确认删除' : '删除服务'}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={dismiss}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={submitting || testing}>
            {provider ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <fieldset className={styles.providerFields} disabled={testing || submitting}>
      <Field label="名称" error={errors.name}>
        {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：DeepSeek" autoFocus maxLength={24} />}
      </Field>
      <Field label="类型" hint={isDemo ? "演示配置不会建立真实连接，可自由切换体验表单。" : "按服务商的接口协议选择；其他兼容 OpenAI 的服务也可使用。Anthropic 选官方接口。"}>
        {() => (
          <Segmented
            label="服务类型"
            value={kind}
            onChange={(v: 'openai' | 'anthropic') => setKind(v)}
            options={[
              { value: 'openai', label: 'OpenAI 兼容' },
              { value: 'anthropic', label: 'Anthropic' },
            ]}
          />
        )}
      </Field>
      <Field label="服务地址" error={errors.baseUrl} hint={isDemo ? "只保存地址文本，不发起网络请求。请勿输入 API Key。" : "常用服务按钮仅供快捷填入。列表里没有的服务，也可手动填写名称和 API 地址，并选择对应的接口类型。"}>
        {(id) => (
          <>
            <TextInput id={id} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
            <div className={styles.presets} role="group" aria-label="常用服务快捷填入">
              {PRESETS.map((p) => (
                <Button
                  key={p.name}
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    if (baseUrl !== p.url) setTestModel('')
                    setBaseUrl(p.url)
                    setKind(p.kind)
                    if (!name.trim()) setName(p.name)
                  }}
                >
                  {p.name}
                </Button>
              ))}
            </div>
          </>
        )}
      </Field>
      {!isDemo && <Field label="API Key" hint={provider?.hasKey ? '已保存，留空则不修改。' : '只写入系统钥匙串，不会进入数据库。'}>
        {(id) => <TextInput id={id} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider?.hasKey ? '已保存，留空则不修改' : '粘贴 API Key'} autoComplete="off" />}
      </Field>}
      {!isDemo && <Field label="测试连接" error={errors.testModel} hint="测试前填写此服务实际可用的模型名；测试会发送一个极小请求。">
        {(id) => (
          <>
            <div className={styles.actionsRow}>
              <TextInput id={id} value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="例如：deepseek-chat" style={{ flex: 1 }} />
              <Button variant="ghost" onClick={() => void runTest()} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
            {test && <p className={`${styles.testLine} ${test.ok ? styles.ok : styles.bad}`} role="status" style={{ marginTop: 6 }}>{test.text}</p>}
          </>
        )}
      </Field>}
      </fieldset>
    </Dialog>
  )
}
