import { ElementRenderer } from '../features/editor/components/ElementRenderer'
import type { Artboard, DesignBlock, DesignSpec } from '../features/editor/types'
import { compileResponsivePreviews } from '../features/editor/utils/responsive-preview'

const fixtureSpec: DesignSpec = {
  version: 1,
  surfaceKind: 'desktop-admin',
  title: '响应式订单工作台',
  viewport: { width: 1440, height: 900 },
  theme: {
    mode: 'light',
    colors: ['#ffffff', '#f3f5f8', '#172033', '#2563eb', '#d9dee8'],
    radius: 8,
    density: 'compact',
  },
  blocks: [
    block('sidebar', '主导航', { items: ['概览', '订单', '客户', '设置'] }),
    block('header', '顶部导航', { title: '订单工作台', actions: ['导出', '新建订单'] }),
    block('stats', '关键指标', {
      items: ['订单总数 1284', '今日新增 36', '处理中 18', '完成率 92%'],
    }),
    block('filter-bar', '筛选条件', {
      fields: ['订单号', '状态', '创建时间'],
      actions: ['重置', '查询'],
    }),
    block('data-table', '订单列表', {
      columns: ['编号', '客户', '负责人', '状态', '更新时间', '操作'],
      rows: [
        ['#1024', '星海科技', '张三', '处理中', '今天 10:24', '查看'],
        ['#1023', '云端互动', '李四', '已完成', '昨天 18:10', '查看'],
        ['#1022', '光年网络', '王五', '待处理', '昨天 15:32', '查看'],
      ],
    }),
    block('content-grid', '快捷入口', { items: ['批量导入', '客户管理', '数据报表'] }),
    block('pagination', '分页', { items: ['共 128 条', '上一页', '1', '2', '3', '下一页'] }),
  ],
  responsive: {
    strategy: 'fluid',
    breakpoints: [
      {
        id: 'mobile',
        label: '移动端',
        viewport: { width: 375, height: 812 },
        overrides: { layout: { sidebarMode: 'collapsed', contentPadding: 16, blockGap: 12 } },
      },
      {
        id: 'tablet',
        label: '平板',
        viewport: { width: 768, height: 900 },
        overrides: { layout: { sidebarMode: 'collapsed', contentPadding: 20, blockGap: 14 } },
      },
      {
        id: 'desktop',
        label: '桌面端',
        viewport: { width: 1440, height: 900 },
        overrides: { layout: { sidebarMode: 'expanded', contentPadding: 24, blockGap: 16 } },
      },
    ],
  },
}

const fixtureArtboard: Artboard = {
  id: 'responsive-visual-fixture',
  name: fixtureSpec.title,
  x: 0,
  y: 0,
  width: 1440,
  height: 900,
  background: '#f3f5f8',
  overflow: 'hidden',
  designSpec: fixtureSpec,
}

export function ResponsiveVisualFixturePage() {
  const previews = compileResponsivePreviews(fixtureSpec, fixtureArtboard)
  return (
    <main className="responsive-visual-fixture" data-visual-fixture="responsive-design-spec-v1">
      {previews.map((preview) => (
        <section key={preview.breakpoint.id}>
          <header>
            <strong>{preview.breakpoint.label}</strong>
            <span>
              {preview.schema.viewport.width}×{preview.schema.viewport.height}
            </span>
          </header>
          <div
            className="responsive-fixture-artboard"
            data-breakpoint={preview.breakpoint.id}
            data-fingerprint={preview.fingerprint}
            style={{ width: preview.schema.viewport.width, height: preview.contentHeight }}
          >
            {preview.elements
              .slice()
              .sort((a, b) => a.zIndex - b.zIndex)
              .map((element) => (
                <ElementRenderer
                  key={element.id}
                  element={element}
                  selected={false}
                  editing={false}
                  onPointerDown={() => undefined}
                  onEditStart={() => undefined}
                  onTextChange={() => undefined}
                  onTextEditEnd={() => undefined}
                />
              ))}
          </div>
        </section>
      ))}
    </main>
  )
}

function block(
  kind: DesignBlock['kind'],
  label: string,
  values: Partial<DesignBlock> = {},
): DesignBlock {
  return {
    id: kind,
    kind,
    label,
    items: [],
    fields: [],
    actions: [],
    columns: [],
    rows: [],
    ...values,
  }
}
