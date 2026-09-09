import { Download, FolderKanban, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

interface ProjectSummary {
  projectId: string
  title: string
  artboardCount: number
  updatedAt: string
}

interface ProjectVersion {
  id: string
  documentVersion: number
  updatedAt: string
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [message, setMessage] = useState<string>()
  const [versions, setVersions] = useState<Record<string, ProjectVersion[]>>({})

  useEffect(() => {
    if (!window.lumenProjects) return
    void window.lumenProjects
      .list()
      .then(setProjects)
      .catch((error) => setMessage(error instanceof Error ? error.message : '项目列表加载失败。'))
  }, [])

  async function importProject() {
    try {
      const imported = await window.lumenProjects?.import()
      if (!imported) return
      setProjects((current) => [
        imported,
        ...current.filter((item) => item.projectId !== imported.projectId),
      ])
      navigate(`/editor/${encodeURIComponent(imported.projectId)}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目导入失败。')
    }
  }

  async function exportProject(projectId: string) {
    try {
      await window.lumenProjects?.export(projectId)
      setMessage('项目已导出。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目导出失败。')
    }
  }

  async function loadVersions(projectId: string) {
    if (!window.lumenProjects) return
    try {
      const result = await window.lumenProjects.listVersions(projectId)
      setVersions((current) => ({ ...current, [projectId]: result }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '版本列表加载失败。')
    }
  }

  async function restoreVersion(projectId: string, versionId: string) {
    if (!window.lumenProjects) return
    try {
      const snapshot = await window.lumenProjects.loadVersion(projectId, versionId)
      if (!snapshot) throw new Error('版本不存在。')
      await window.lumenProjects.save(snapshot)
      setMessage('版本已恢复。')
      setProjects(await window.lumenProjects.list())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '版本恢复失败。')
    }
  }

  async function deleteProject(project: ProjectSummary) {
    if (!window.lumenProjects) return
    if (!window.confirm(`确定删除项目“${project.title}”吗？此操作不可撤销。`)) return
    try {
      await window.lumenProjects.delete(project.projectId)
      setProjects((current) => current.filter((item) => item.projectId !== project.projectId))
      setVersions((current) => {
        const next = { ...current }
        delete next[project.projectId]
        return next
      })
      setMessage('项目已删除。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目删除失败。')
    }
  }

  return (
    <div className="page compact-page">
      <div className="utility-page-header">
        <h1>项目列表</h1>
        {window.lumenProjects ? (
          <button
            type="button"
            className="utility-action-button"
            onClick={() => void importProject()}
          >
            <Upload size={16} /> 导入项目
          </button>
        ) : null}
      </div>
      {message ? <div className="utility-message">{message}</div> : null}
      {projects.length ? (
        <div className="utility-list">
          {projects.map((project) => (
            <div key={project.projectId} className="utility-list-item">
              <FolderKanban size={20} />
              <Link
                to={`/editor/${encodeURIComponent(project.projectId)}`}
                className="utility-project-link"
              >
                <span>{project.title}</span>
                <small>
                  {project.artboardCount} 个画板 · {new Date(project.updatedAt).toLocaleString()}
                </small>
              </Link>
              {window.lumenProjects ? (
                <button
                  type="button"
                  className="utility-inline-action"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void exportProject(project.projectId)
                  }}
                >
                  <Download size={14} /> 导出
                </button>
              ) : null}
              {window.lumenProjects ? (
                <button
                  type="button"
                  className="utility-inline-action utility-danger-action"
                  title="删除项目"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void deleteProject(project)
                  }}
                >
                  <Trash2 size={14} /> 删除
                </button>
              ) : null}
              {window.lumenProjects ? (
                <details
                  className="utility-versions"
                  onToggle={(event) => {
                    if (
                      (event.currentTarget as HTMLDetailsElement).open &&
                      !versions[project.projectId]
                    ) {
                      void loadVersions(project.projectId)
                    }
                  }}
                >
                  <summary>版本</summary>
                  {(versions[project.projectId] ?? []).map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void restoreVersion(project.projectId, version.id)
                      }}
                    >
                      v{version.documentVersion} · {new Date(version.updatedAt).toLocaleString()}
                    </button>
                  ))}
                </details>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FolderKanban size={32} />
          <h2>暂无已保存项目</h2>
          {!window.lumenProjects ? <p>项目持久化仅支持 Electron 桌面版。</p> : null}
        </div>
      )}
    </div>
  )
}
