/**
 * Agent 项目经理 STAR 案例模拟器
 *
 * 运行：node demos/agent-basics/04-star-cases.mjs
 *
 * 说明：
 * 这里使用确定性函数模拟项目现场，目的是练习“场景—行动—结果—复盘”的面试表达。
 * 代码不调用真实模型，也不代表线上业务数据；它对应当前项目中的 Agent、Workflow、
 * Checkpoint、质量门禁和 ACK 等工程机制。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function header(title) {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

// 案例一：需求范围冲突。设计希望整页视觉图，前端要求可编辑组件。
async function caseScopeConflict() {
  header('案例一：需求范围冲突——视觉效果与可编辑性如何取舍');
  console.log('S（场景）：设计希望用整图保证效果，前端担心无法修改和复用。');
  console.log('T（目标）：在不牺牲首版视觉质量的前提下，保住可编辑和开发交付。');

  // 项目经理先把争论拆成可验证的交付目标，而不是让双方继续讨论偏好。
  const acceptance = {
    visual: '页面主题与 KV 一致',
    editable: '标题、按钮、组件 Props 可单独修改',
    delivery: '至少导出 HTML/CSS 与结构化配置',
  };
  console.log('定义共同验收标准：', acceptance);

  // 用分层交付解决冲突：页面背景允许 Raster，业务组件必须由原生节点组成。
  const decision = {
    pageShell: '允许使用页面级 Raster/视觉外壳',
    component: '使用原生 Scene 节点，不生成覆盖组件的整图',
    imageSlot: '仅为明确的 Props 图片 Slot 单独生图',
  };
  console.log('方案取舍：', decision);
  await sleep(20);

  // 结果必须同时对应三项验收，而不是只说“大家同意了”。
  const result = { visualPassed: true, editablePassed: true, exportPassed: true };
  console.log('R（结果）：', result);
  console.log('A（复盘）：将视觉、结构和字段拆开，后续新增组件时可复用同一套边界。');
}

// 案例二：Provider 失败。用 Checkpoint 证明不会整条链路重跑。
async function caseProviderFailure() {
  header('案例二：Provider 失败——如何恢复而不是整页重跑');
  console.log('S：页面包含 Page Shell、Lottery 组件和 Tasklist 组件，生成 Lottery 时 Provider 超时。');
  console.log('T：保留已完成结果，用户点击“继续”后只恢复失败步骤。');

  const checkpoints = new Map();
  const steps = ['page.generate-shell', 'component.lottery', 'component.tasklist', 'page.review'];
  let failedOnce = false;

  async function execute(step) {
    console.log(`执行 Step：${step}`);
    if (step === 'component.lottery' && !failedOnce) {
      failedOnce = true;
      throw new Error('IMAGE_PROVIDER_TIMEOUT');
    }
    await sleep(15);
    checkpoints.set(step, { status: 'completed', outputHash: `hash_${step}` });
  }

  async function run() {
    for (const step of steps) {
      // 已经有 Checkpoint 的步骤直接跳过，体现精确恢复。
      if (checkpoints.has(step)) {
        console.log(`跳过：${step}（已有 Checkpoint）`);
        continue;
      }
      try {
        await execute(step);
      } catch (error) {
        console.log(`失败：${step}，错误码=${error.message}`);
        return false;
      }
    }
    return true;
  }

  console.log('第一次运行：');
  await run();
  console.log('用户选择继续：');
  const completed = await run();
  console.log('R（结果）：', { completed, checkpoints: [...checkpoints.keys()] });
  console.log('A（复盘）：错误码、Step 状态和输出哈希让恢复行为可观察、可审计。');
}

// 案例三：跨团队延期。用接口和 Fixture 让非阻塞链路先行。
async function caseScheduleDelay() {
  header('案例三：算法/组件延期——如何保住主链路');
  console.log('S：真实业务组件 Bundle 延期，前端画布和导出团队无法等待。');
  console.log('T：不伪装成真实能力，同时先验收协议、画布事务和导出主链。');

  // 这里把“能力”拆成接口契约，真实 Provider 晚到时使用明确标记的 Fixture。
  const dependency = { name: 'EraLottery Runtime Bundle', status: 'delayed' };
  const fixture = { name: 'EraLottery Fixture', status: 'mock-only', supports: ['schema', 'props', 'ack'] };
  console.log('依赖状态：', dependency);
  console.log('临时替代：', fixture);

  const milestones = [
    { name: 'DesignDocument + Scene Graph', status: 'passed' },
    { name: 'Canvas Transaction + ACK', status: 'passed' },
    { name: 'Code IR + HTML/CSS 导出', status: 'passed' },
    { name: '真实 Bundle Runtime 验证', status: 'blocked-by-external-dependency' },
  ];
  console.table(milestones);
  console.log('R：核心链路按期可演示，真实 Bundle 能力明确标记为外部依赖。');
  console.log('A：以后遇到延期，优先拆分可独立验收的接口和里程碑，避免所有工作被单点依赖阻塞。');
}

// 案例四：假成功。模拟 Tool 返回成功但 Renderer 没有正确写入。
async function caseFalseSuccess() {
  header('案例四：质量问题——阻止“模型说成功但画布没写入”');
  console.log('S：Tool 返回 success，但 Renderer 实际写入的节点数与预期不一致。');
  console.log('T：建立 Canvas ACK 后置条件，未通过就不能完成 Run。');

  const expected = { targetId: 'section-lottery', elementCount: 18 };
  const actual = { targetId: 'section-lottery', elementCount: 12 };
  const ack = expected.targetId === actual.targetId && expected.elementCount === actual.elementCount;
  console.log('预期：', expected, '实际：', actual, 'ACK：', ack);

  if (!ack) {
    console.log('拦截成功状态：CANVAS_POSTCONDITION_FAILED');
    console.log('触发 Repair：仅重试 section-lottery，不重建整页。');
  }
  console.log('R：避免错误成功提示和重复写入。');
  console.log('A：任何有副作用的 Agent Tool 都必须有可验证后置条件。');
}

// 案例五：错误决策复盘。模拟把咨询误判成执行后的纠偏。
async function caseWrongDecision() {
  header('案例五：判断失误——把咨询误判为执行如何纠正');
  console.log('S：用户说“怎么优化这个页面”，系统误判为执行，准备修改画布。');
  console.log('T：立即停止写操作，修正意图路由，并补充回归用例。');

  const input = '怎么优化这个页面';
  const before = { intent: 'revise-page', sideEffect: 'will-write-canvas' };
  const after = { intent: 'consultation', sideEffect: 'none', reply: '提供优化建议并等待明确执行指令' };
  console.log('错误判断：', before);
  console.log('纠正结果：', after);

  // 用测试样例固化语义边界，防止依赖个人记忆。
  const regression = [
    ['怎么优化这个页面', 'consultation'],
    ['优化一下这个页面', 'revise-page'],
    ['先给我方案', 'consultation'],
    ['按建议修改', 'revise-page'],
  ];
  console.table(regression.map(([text, expectedIntent]) => ({ text, expectedIntent })));
  console.log('R：避免咨询请求产生画布副作用。');
  console.log('A：把一次错误判断转成路由规则、自动化测试和产品提示，而不是只口头复盘。');
}

await caseScopeConflict();
await caseProviderFailure();
await caseScheduleDelay();
await caseFalseSuccess();
await caseWrongDecision();

console.log('\n全部 STAR 案例模拟完成。面试表达顺序：先讲事实，再讲决策，最后讲结果和复盘。');
