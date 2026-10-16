import { useEffect, useState } from 'react'
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
export function ProviderDialog({ open, onClose, provider }: { open: boolean; onClose(): void; provider?: ProviderConfig }) {
  const saveProvider = useChat((s) => s.saveProvider)
  const deleteProvider = useChat((s) => s.deleteProvider)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'openai' | 'anthropic'>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [testModel, setTestModel] = useState('')
  const [errors, setErrors] = useState<{ name?: string; baseUrl?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setTest(null)
    setConfirmDelete(false)
    setKey('')
    setTestModel('')
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

  const payload = () => ({ id: provider?.id ?? '', name: name.trim(), kind, baseUrl: baseUrl.trim(), key: key.trim(), testModel: testModel.trim() || undefined })

  const runTest = async () => {
    setTest(null)
    setTesting(true)
    try {
      const ms = await backend.testProvider(payload())
      setTest({ ok: true, text: `连接正常 · 用时 ${ms} ms` })
    } catch (e) {
      setTest({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    const errs: typeof errors = {}
    if (!name.trim()) errs.name = '给服务起个名字'
    if (!baseUrl.trim()) errs.baseUrl = '请填写服务地址'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSubmitting(true)
    try {
      await saveProvider(payload())
      onClose()
    } catch (e) {
      setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async () => {
    if (!provider) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setSubmitting(true)
    try {
      await deleteProvider(provider.id)
      onClose()
    } catch (e) {
      setErrors({ name: e instanceof Error ? e.message : String(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={provider ? `编辑「${provider.name}」` : '新建模型服务'}
      description="成员通过这里配置的服务与模型说话。API Key 只保存在系统钥匙串，界面不会回显。"
      width={540}
      footer={
        <>
          {provider && (
            <Button variant="quiet" className={confirmDelete ? styles.bad : undefined} onClick={() => void remove()} disabled={submitting}>
              {confirmDelete ? '再点一次确认删除' : '删除服务'}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={submitting}>
            {provider ? '保存' : '创建'}
          </Button>
        </>
      }
    >
      <Field label="名称" error={errors.name}>
        {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：DeepSeek" autoFocus maxLength={24} />}
      </Field>
      <Field label="类型" hint="OpenAI 兼容覆盖绝大多数服务；Anthropic 用官方接口。">
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
      <Field label="服务地址" error={errors.baseUrl}>
        {(id) => (
          <>
            <TextInput id={id} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…" />
            <div className={styles.presets}>
              {PRESETS.map((p) => (
                <Button
                  key={p.name}
                  variant="quiet"
                  size="sm"
                  onClick={() => {
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
      <Field label="API Key" hint={provider?.hasKey ? '已保存，留空则不修改。' : '只写入系统钥匙串，不会进入数据库。'}>
        {(id) => <TextInput id={id} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider?.hasKey ? '已保存，留空则不修改' : '粘贴 API Key'} autoComplete="off" />}
      </Field>
      <Field label="测试连接" hint="用一个极小请求验证服务可用。测试用的模型名可留空，按类型取默认。">
        {(id) => (
          <>
            <div className={styles.actionsRow}>
              <TextInput id={id} value={testModel} onChange={(e) => setTestModel(e.target.value)} placeholder="留空按类型默认" style={{ flex: 1 }} />
              <Button variant="ghost" onClick={() => void runTest()} disabled={testing}>
                {testing ? '测试中…' : '测试连接'}
              </Button>
            </div>
            {test && <p className={`${styles.testLine} ${test.ok ? styles.ok : styles.bad}`} role="status" style={{ marginTop: 6 }}>{test.text}</p>}
          </>
        )}
      </Field>
    </Dialog>
  )
}
