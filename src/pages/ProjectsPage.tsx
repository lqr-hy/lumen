import { FolderKanban } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface ProjectSummary {
  projectId: string
  title: string
  artboardCount: number
  updatedAt: string
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])

  useEffect(() => {
    void window.aiCampaignProjects?.list().then(setProjects)
  }, [])

  return (
    <div className="page compact-page">
      <h1>项目列表</h1>
      {projects.length ? (
        <div className="utility-list">
          {projects.map((project) => (
            <Link
              key={project.projectId}
              to={`/editor/${project.projectId}`}
              className="utility-list-item"
            >
              <FolderKanban size={20} />
              <span>{project.title}</span>
              <small>
                {project.artboardCount} 个画板 · {new Date(project.updatedAt).toLocaleString()}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <FolderKanban size={32} />
          <h2>暂无已保存项目</h2>
        </div>
      )}
    </div>
  )
}
