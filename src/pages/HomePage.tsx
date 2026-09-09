import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ImagePlus, Trash2, WandSparkles } from 'lucide-react'
import { openAppTab } from '../app/app-tabs'
import { generateDesign } from '../features/ai/api'
import { useEditorStore } from '../features/editor/store/editor-store'
import { DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../features/editor/constants'
import type { GenerateRequest } from '../features/ai/types'
import { PromptComposer } from '../components/ui/PromptComposer'
import type { ComposerMention } from '../features/ai/composer-draft'
import { useRuntimeSettings } from '../features/ai/runtime-settings'
import { ComposerRuntimeControls } from '../features/editor/components/ComposerRuntimeControls'
import { VisualOptimizationDialog } from '../features/editor/components/VisualOptimizationDialog'
import {
  compileVisualDirectionPrompt,
  type VisualRedesignBrief,
} from '../features/editor/utils/visual-brief'

const quickStarts = [
  {
    title: '中式茶饮品牌 VI 设计',
    image: '/assets/home/tea.jpg',
  },
  {
    title: 'IP 潮玩人物设定及表情包',
    image: '/assets/home/toy.jpg',
  },
  {
    title: '宇宙迷航短片分镜',
    image: '/assets/home/space.jpg',
  },
  {
    title: '香水产品系列海报',
    image: '/assets/home/perfume.jpg',
  },
  {
    title: '治愈系插画故事绘本',
    image: '/assets/home/story.jpg',
  },
  {
    title: '超现实梦境 MV 概念分镜',
    image: '/assets/home/dream.jpg',
  },
]

interface ProjectSummary {
  projectId: string
  title: string
  artboardCount: number
  updatedAt: string
}

export function HomePage() {
  const navigate = useNavigate()
  const setDocument = useEditorStore((state) => state.setDocument)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsLoading, setProjectsLoading] = useState(Boolean(window.aiCampaignProjects))
  const [projectsError, setProjectsError] = useState<string>()
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [mentions, setMentions] = useState<ComposerMention[]>([])
  const [visualDirectionOpen, setVisualDirectionOpen] = useState(false)
  const { runtimeModel, imageModel, stylePackId, setRuntimeModel, setImageModel, setStylePackId } =
    useRuntimeSettings()
  const [form, setForm] = useState<GenerateRequest>({
    prompt: '',
    type: 'landing-page',
    size: { width: DEFAULT_ARTBOARD_WIDTH, height: DEFAULT_ARTBOARD_HEIGHT },
    style: '自动',
    industry: '',
    referenceImages: [],
  })

  async function loadProjects() {
    if (!window.aiCampaignProjects) {
      setProjectsLoading(false)
      return
    }
    setProjectsLoading(true)
    setProjectsError(undefined)
    try {
      setProjects(
        (await window.aiCampaignProjects.list()).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      )
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : '项目列表加载失败。')
    } finally {
      setProjectsLoading(false)
    }
  }

  useEffect(() => {
    void loadProjects()
  }, [])

  async function onSubmit() {
    if (loading) return

    setLoading(true)
    try {
      const prompt = form.prompt.trim() || '根据参考图和当前趋势生成一套活动页设计'
      const result = await generateDesign({
        ...form,
        prompt,
        referenceImages,
      })
      setDocument(result.document)
      if (window.aiCampaignElectron) {
        openAppTab({
          path: `/editor/${result.projectId}`,
          title: result.document.title,
          initialPrompt: prompt,
        })
      } else {
        navigate(`/editor/${result.projectId}`, { state: { initialPrompt: prompt } })
      }
    } finally {
      setLoading(false)
    }
  }

  async function deleteProject(project: ProjectSummary) {
    if (!window.aiCampaignProjects) return
    if (!window.confirm(`确定删除项目“${project.title}”吗？此操作不可撤销。`)) return
    try {
      await window.aiCampaignProjects.delete(project.projectId)
      setProjects((current) => current.filter((item) => item.projectId !== project.projectId))
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : '项目删除失败。')
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
          mentions={mentions}
          loading={loading}
          placeholder="上传参考图、输入文字或 @ 主体，创意无限可能"
          actionSlot={
            <>
              <button
                type="button"
                className="prompt-action-button visual-direction-action"
                title="视觉方向"
                aria-label="视觉方向"
                onClick={() => setVisualDirectionOpen(true)}
              >
                <WandSparkles size={17} />
              </button>
              <ComposerRuntimeControls
                runtimeModel={runtimeModel}
                imageModel={imageModel}
                stylePackId={stylePackId}
                onRuntimeModelChange={setRuntimeModel}
                onImageModelChange={setImageModel}
                onStylePackChange={setStylePackId}
              />
            </>
          }
          onChange={(prompt) => setForm({ ...form, prompt })}
          onMentionsChange={setMentions}
          onImagesChange={setReferenceImages}
          onSubmit={onSubmit}
        />
      </section>

      {visualDirectionOpen ? (
        <VisualOptimizationDialog
          onClose={() => setVisualDirectionOpen(false)}
          onNormalize={() => 0}
          onCreateVariant={(brief: VisualRedesignBrief) => {
            setForm((current) => ({
              ...current,
              prompt: [compileVisualDirectionPrompt(brief), current.prompt.trim()]
                .filter(Boolean)
                .join('\n\n'),
            }))
            setVisualDirectionOpen(false)
          }}
        />
      ) : null}

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
              <img
                src={item.image}
                alt=""
                onError={(event) => {
                  event.currentTarget.src = '/assets/home/fallback.svg'
                }}
              />
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
            onClick={() =>
              openAppTab({ path: `/editor/new-${crypto.randomUUID()}`, title: '新建画布' })
            }
          >
            <ImagePlus size={28} />
            <span>新建项目</span>
          </button>
          {projectsLoading ? <div className="recent-empty">正在加载项目…</div> : null}
          {!projectsLoading && projectsError ? (
            <div className="recent-empty recent-error">
              <span>{projectsError}</span>
              <button type="button" onClick={() => void loadProjects()}>
                重试
              </button>
            </div>
          ) : null}
          {!projectsLoading && !projectsError && !projects.length ? (
            <div className="recent-empty">暂无最近项目</div>
          ) : null}
          {!projectsLoading && !projectsError
            ? projects.map((project) => (
                <article key={project.projectId} className="recent-card">
                  <button
                    className="recent-card-open"
                    type="button"
                    onClick={() =>
                      openAppTab({
                        path: `/editor/${encodeURIComponent(project.projectId)}`,
                        title: project.title,
                      })
                    }
                  >
                    <img src="/assets/home/project.svg" alt="" />
                    <strong>{project.title}</strong>
                    <span>
                      {project.artboardCount} 个画板 · {formatRelativeTime(project.updatedAt)}
                    </span>
                  </button>
                  <button
                    className="recent-card-delete"
                    type="button"
                    title="删除项目"
                    aria-label={`删除项目 ${project.title}`}
                    onClick={() => void deleteProject(project)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))
            : null}
        </div>
      </section>
    </div>
  )
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '时间未知'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return '刚刚修改'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前修改`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前修改`
  return `${Math.floor(seconds / 86400)} 天前修改`
}
