import {
  FolderPlus,
  ImagePlus,
  Upload,
  WandSparkles,
} from 'lucide-react'

export function CanvasStartPrompt() {
  return (
    <div className="canvas-start">
      <div className="canvas-start-copy">
        <h2>这次创作想从哪里开始？</h2>
        <div className="start-option">
          <div className="start-asset-icon">
            <ImagePlus size={26} />
          </div>
          <div>
            <span>使用已有素材开启创作</span>
            <button type="button">
              <Upload size={15} />
              本地上传
            </button>
            <button type="button">
              <FolderPlus size={15} />
              选择资产
            </button>
          </div>
        </div>
        <div className="start-option">
          <div className="start-chat-icon">
            <WandSparkles size={16} />
          </div>
          <p>没有好创意？先和 Agent 聊聊，或者搜一搜站内灵感吧！</p>
        </div>
      </div>
    </div>
  )
}
