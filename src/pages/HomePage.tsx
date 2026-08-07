import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus } from 'lucide-react'
import { openAppTab } from '../app/app-tabs'
import { generateDesign } from '../features/ai/api'
import { useEditorStore } from '../features/editor/store/editor-store'
import {
  DEFAULT_ARTBOARD_HEIGHT,
  DEFAULT_ARTBOARD_WIDTH,
} from '../features/editor/constants'
import type { GenerateRequest } from '../features/ai/types'
import { PromptComposer } from '../components/ui/PromptComposer'

const quickStarts = [
  {
    title: '中式茶饮品牌 VI 设计',
    image:
      'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=760&q=80',
  },
  {
    title: 'IP 潮玩人物设定及表情包',
    image:
      'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=760&q=80',
  },
  {
    title: '宇宙迷航短片分镜',
    image:
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=760&q=80',
  },
  {
    title: '香水产品系列海报',
    image:
      'https://images.unsplash.com/photo-1594035910387-fea47794261f?auto=format&fit=crop&w=760&q=80',
  },
  {
    title: '治愈系插画故事绘本',
    image:
      'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=760&q=80',
  },
  {
    title: '超现实梦境 MV 概念分镜',
    image:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=760&q=80',
  },
]

export function HomePage() {
  const navigate = useNavigate()
  const setDocument = useEditorStore((state) => state.setDocument)
  const [loading, setLoading] = useState(false)
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [form, setForm] = useState<GenerateRequest>({
    prompt: '',
    type: 'landing-page',
    size: { width: DEFAULT_ARTBOARD_WIDTH, height: DEFAULT_ARTBOARD_HEIGHT },
    style: '自动',
    industry: '',
    referenceImages: [],
  })

  async function onSubmit() {
    if (loading) return

    setLoading(true)
    try {
      const result = await generateDesign({
        ...form,
        prompt:
          form.prompt.trim() ||
          '根据参考图和当前趋势生成一套可编辑的活动页设计稿',
        referenceImages,
      })
      setDocument(result.document)
      if (window.aiCampaignElectron) {
        openAppTab({ path: `/editor/${result.projectId}`, title: result.document.title })
      } else {
        navigate(`/editor/${result.projectId}`)
      }
    } finally {
      setLoading(false)
    }
  }

  function applyQuickStart(title: string) {
    setForm((current) => ({
      ...current,
      prompt: `参考「${title}」的方向，生成一个适合品牌传播的活动页设计稿`,
    }))
  }

  return (
    <div className="studio-home">
      <section className="prompt-hero">
        <h1>今天想在无限画布创作什么？</h1>
        <PromptComposer
          className="prompt-card"
          ariaLabel="设计需求"
          value={form.prompt}
          images={referenceImages}
          loading={loading}
          placeholder="上传参考图、输入文字或 @ 主体，创意无限可能"
          onChange={(prompt) => setForm({ ...form, prompt })}
          onImagesChange={setReferenceImages}
          onSubmit={onSubmit}
        />
      </section>

      <section className="workspace-section">
        <h2>快速开始</h2>
        <div className="quick-row">
          {quickStarts.map((item) => (
            <button
              key={item.title}
              className="quick-card"
              type="button"
              onClick={() => applyQuickStart(item.title)}
            >
              <img src={item.image} alt="" />
              <span>{item.title} →</span>
            </button>
          ))}
        </div>
      </section>

      <section className="workspace-section">
        <h2>最近项目</h2>
        <div className="recent-grid">
          <button
            className="new-project-card"
            type="button"
            onClick={() => openAppTab({ path: `/editor/new-${Date.now()}`, title: '新建画布' })}
          >
            <ImagePlus size={28} />
            <span>新建项目</span>
          </button>
          <button
            className="recent-card"
            type="button"
            onClick={() => openAppTab({
              path: '/editor/recent-qinglan-packaging',
              title: '青岚品牌包装',
            })}
          >
            <img
              src="https://images.unsplash.com/photo-1584305574647-0cc949a2bb9f?auto=format&fit=crop&w=760&q=80"
              alt=""
            />
            <strong>青岚品牌包装物料图生成</strong>
            <span>画布 · 1 分钟前修改</span>
          </button>
        </div>
      </section>
    </div>
  )
}
